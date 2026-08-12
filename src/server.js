require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

const pool = require('./db/pool');
const { attachUser } = require('./middleware/auth');
const { startEventAttendanceBot } = require('./bot/eventAttendanceBot');
const { startWeeklyResetScheduler } = require('./utils/weeklyReset');

const authRoutes = require('./routes/auth');
const contentRoutes = require('./routes/content');
const rulesRoutes = require('./routes/rules');
const rosterRoutes = require('./routes/roster');
const reprimandsRoutes = require('./routes/reprimands');
const applicationsRoutes = require('./routes/applications');
const vacationsRoutes = require('./routes/vacations');
const ownerRoutes = require('./routes/owner');
const mediaRoutes = require('./routes/media');
const markdownPreviewRoutes = require('./routes/markdownPreview');

const app = express();
// Caddy (и любой reverse-proxy) терминирует TLS — нужно для secure-cookie.
app.set('trust proxy', 1);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// В проде принимаем только канонический хост (APP_DOMAIN). Запросы на IP:порт
// или со старым Host отсекаются даже если порт приложения случайно открыт.
const APP_DOMAIN = (process.env.APP_DOMAIN || '').trim().toLowerCase();
if (APP_DOMAIN && process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    const host = String(req.headers.host || '').split(':')[0].toLowerCase();
    if (host === APP_DOMAIN) return next();
    // health из docker-сети (wget 127.0.0.1) — без проверки Host.
    if (req.path === '/api/health' && (host === '127.0.0.1' || host === 'localhost')) {
      return next();
    }
    res.status(404).type('text/plain').send('Not Found');
  });
}

// Лёгкий health-check ДО session/auth (Docker HEALTHCHECK / мониторинг).
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    console.error('[health]', err.message);
    res.status(503).json({ ok: false, error: 'База данных недоступна.' });
  }
});

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
app.use('/api/vacations', vacationsRoutes);
app.use('/api/owner', ownerRoutes);
app.use('/media', mediaRoutes);
app.use('/api/markdown', markdownPreviewRoutes);

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
  // Если ответ уже ушёл (например, сессия/pg упали после начала стрима) —
  // повторный res.json даёт ERR_HTTP_HEADERS_SENT.
  if (res.headersSent) return next(err);
  if (err.message && err.message.includes('Разрешены только изображения')) {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: 'Внутренняя ошибка сервера.' });
});

const PORT = process.env.PORT || 3000;
// В Docker слушаем 0.0.0.0 (Caddy ходит на app:3000 по сети compose).
// Порт наружу не публикуется — см. docker-compose.yml.
const HOST = process.env.HOST || '0.0.0.0';

// Схема идемпотентна (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS),
// поэтому безопасно применять её на каждом старте сервера — это защищает от
// ситуации "задеплоили новый код, но забыли прогнать npm run db:migrate".
// listen не ждём applySchema — иначе старт блокируется на DDL.
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

app.listen(PORT, HOST, () => {
  console.log(`[server] Event Department Portal: http://${HOST}:${PORT}` +
    (APP_DOMAIN ? ` (домен ${APP_DOMAIN})` : ''));
});
applySchema();
// Бот учёта посещаемости мероприятий (см. src/bot/eventAttendanceBot.js).
// Запускается в этом же процессе; если DISCORD_BOT_TOKEN не задан — просто
// ничего не делает.
startEventAttendanceBot(pool);
// Еженедельный сброс счётчика "МП в неделю" по понедельникам в 00:00
// (см. src/utils/weeklyReset.js).
startWeeklyResetScheduler(pool);
