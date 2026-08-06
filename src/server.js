require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

const pool = require('./db/pool');
const { attachUser } = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const contentRoutes = require('./routes/content');
const rulesRoutes = require('./routes/rules');
const rosterRoutes = require('./routes/roster');
const reprimandsRoutes = require('./routes/reprimands');
const applicationsRoutes = require('./routes/applications');
const ownerRoutes = require('./routes/owner');
const mediaRoutes = require('./routes/media');

const app = express();
app.set('trust proxy', 1); // Render стоит за прокси — нужно для secure-cookie

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 дней
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    },
  })
);

app.use(attachUser);

// --- API -------------------------------------------------------------------
app.use('/api/auth', authRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/rules', rulesRoutes);
app.use('/api/roster', rosterRoutes);
app.use('/api/reprimands', reprimandsRoutes);
app.use('/api/applications', applicationsRoutes);
app.use('/api/owner', ownerRoutes);
app.use('/media', mediaRoutes);

app.get('/api/config', (req, res) => {
  res.json({
    appTitle: process.env.APP_TITLE || 'Events Denver',
    appSubtitle: process.env.APP_SUBTITLE || 'Ивент-отдел сервера',
    weeklyEventsTarget: parseInt(process.env.WEEKLY_EVENTS_TARGET, 10) || 5,
    discordEnabled: Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET),
  });
});

// Любой не найденный /api/* маршрут должен вернуть JSON-404, а не HTML
// приложения (иначе неверный путь к API молча отдаёт index.html).
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Такого API-маршрута не существует.' });
});

// --- статика + одностраничное приложение -----------------------------------
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// --- обработка ошибок -------------------------------------------------------
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  if (err.message && err.message.includes('Разрешены только изображения')) {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: 'Внутренняя ошибка сервера.' });
});

const PORT = process.env.PORT || 3000;

// Схема идемпотентна (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS),
// поэтому безопасно применять её на каждом старте сервера — это защищает от
// ситуации "задеплоили новый код, но забыли прогнать npm run db:migrate",
// из-за которой раньше отваливались, например, выговоры (не было колонки type).
async function applySchema() {
  const fs = require('fs');
  const schemaPath = path.join(__dirname, 'db', 'schema.sql');
  try {
    await pool.query(fs.readFileSync(schemaPath, 'utf8'));
    console.log('[server] Схема базы данных проверена/обновлена.');
  } catch (err) {
    console.error('[server] Не удалось применить схему БД при старте:', err.message);
  }
}

applySchema().then(() => {
  app.listen(PORT, () => {
    console.log(`[server] Event Department Portal запущен на порту ${PORT}`);
  });
});
