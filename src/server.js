require('dotenv').config();
// Прокси до Discord — до fetch/пула/бота (см. DISCORD_PROXY в compose).
require('./utils/outboundProxy').applyOutboundProxy();

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

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
app.set('trust proxy', 1);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

const APP_DOMAIN = (process.env.APP_DOMAIN || '').trim().toLowerCase();
const isLocalHealth = (req) => {
  const host = String(req.headers.host || '').split(':')[0].toLowerCase();
  return (req.path === '/api/health' || req.path === '/api/health/live')
    && (host === '127.0.0.1' || host === 'localhost');
};

if (APP_DOMAIN && process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    const host = String(req.headers.host || '').split(':')[0].toLowerCase();
    if (host === APP_DOMAIN || isLocalHealth(req)) return next();
    res.status(404).type('text/plain').send('Not Found');
  });

  app.use((req, res, next) => {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || '')
      .split(',')[0].trim().toLowerCase();
    if (proto === 'https' || req.path === '/api/health' || req.path === '/api/health/live') {
      return next();
    }
    return res.redirect(301, `https://${APP_DOMAIN}${req.originalUrl || '/'}`);
  });
}

// Liveness — без БД (Docker HEALTHCHECK не валит контейнер из‑за Neon sleep).
app.get('/api/health/live', (req, res) => {
  res.json({ ok: true });
});

// Readiness — с проверкой БД (мониторинг / ручная диагностика).
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    console.error('[health]', err.message);
    res.status(503).json({ ok: false, error: 'База данных недоступна.' });
  }
});

// Публичный конфиг — до session (без Postgres).
app.get('/api/config', (req, res) => {
  res.json({
    appTitle: process.env.APP_TITLE || 'Events Denver',
    appSubtitle: process.env.APP_SUBTITLE || 'Ивент-отдел сервера',
    weeklyEventsTarget: parseInt(process.env.WEEKLY_EVENTS_TARGET, 10) || 5,
    discordEnabled: Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET),
  });
});

// Публичный статус заявок — до session.
app.get('/api/applications/status', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT is_open FROM applications_settings WHERE id = 1');
    res.json({ isOpen: rows.length ? rows[0].is_open : true });
  } catch (err) {
    next(err);
  }
});

app.use(express.static(PUBLIC_DIR, {
  index: false,
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
}));

const sessionMiddleware = session({
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  },
});

app.use('/api', sessionMiddleware, attachUser);

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

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Такого API-маршрута не существует.' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  if (res.headersSent) return next(err);
  if (err.message && err.message.includes('Разрешены только изображения')) {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: 'Внутренняя ошибка сервера.' });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

async function applySchema() {
  if (process.env.APPLY_SCHEMA_ON_START === '0' || process.env.APPLY_SCHEMA_ON_START === 'false') {
    console.log('[server] APPLY_SCHEMA_ON_START=false — схему не применяем (npm run db:migrate).');
    return;
  }
  await new Promise((r) => setTimeout(r, 3000));
  const fs = require('fs');
  const schemaPath = path.join(__dirname, 'db', 'schema.sql');
  const client = await pool.connect();
  try {
    // Один инстанс за раз применяет schema (несколько реплик / быстрый restart).
    const locked = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [87201401]);
    if (!locked.rows[0].ok) {
      console.log('[server] Схема уже применяется другим процессом — пропускаем.');
      return;
    }
    try {
      await client.query(fs.readFileSync(schemaPath, 'utf8'));
      console.log('[server] Схема базы данных проверена/обновлена.');
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [87201401]);
    }
  } catch (err) {
    console.error('[server] Не удалось применить схему БД при старте:', err.message);
  } finally {
    client.release();
  }
}

app.listen(PORT, HOST, () => {
  console.log(`[server] Event Department Portal: http://${HOST}:${PORT}` +
    (APP_DOMAIN ? ` (домен ${APP_DOMAIN})` : ''));
});

applySchema();

const embedBot = !['1', 'true', 'yes'].includes(
  String(process.env.DISABLE_EMBEDDED_BOT || '').toLowerCase()
);
if (embedBot) {
  setTimeout(() => startEventAttendanceBot(pool), 5000);
} else {
  console.log('[server] DISABLE_EMBEDDED_BOT — Discord-бот в этом процессе не запускается.');
}
startWeeklyResetScheduler(pool);
