// Отдельный процесс Discord-бота (не делит event loop / пул с HTTP).
// Запуск: node src/bot/standalone.js  или сервис event-bot в docker-compose.
require('dotenv').config();

if (!process.env.DATABASE_URL) {
  console.error('[event-bot] DATABASE_URL не задан.');
  process.exit(1);
}

const pool = require('../db/pool');
const { startEventAttendanceBot } = require('./eventAttendanceBot');

const client = startEventAttendanceBot(pool);
if (!client) {
  // Токена нет — exit 0; в compose у event-bot restart: on-failure (не зациклит).
  process.exit(0);
}

process.on('SIGTERM', async () => {
  console.log('[event-bot] SIGTERM — останавливаюсь.');
  try { await client.destroy(); } catch (_) { /* ignore */ }
  process.exit(0);
});
process.on('SIGINT', async () => {
  try { await client.destroy(); } catch (_) { /* ignore */ }
  process.exit(0);
});
