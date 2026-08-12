// Отдельный процесс Discord-бота.
require('dotenv').config();
require('../utils/outboundProxy').applyOutboundProxy();

if (!process.env.DATABASE_URL) {
  console.error('[event-bot] DATABASE_URL не задан.');
  process.exit(1);
}

const pool = require('../db/pool');
const { startEventAttendanceBot } = require('./eventAttendanceBot');

const bot = startEventAttendanceBot(pool);
if (!bot) {
  process.exit(0);
}

async function shutdown() {
  console.log('[event-bot] Останавливаюсь…');
  try {
    if (typeof bot.destroy === 'function') await bot.destroy();
  } catch (_) { /* ignore */ }
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
