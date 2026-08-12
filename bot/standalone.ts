import 'dotenv/config';
import { applyOutboundProxy } from './outboundProxy';
import pool from '../lib/db';
import { startEventAttendanceBot } from './eventAttendanceBot';

applyOutboundProxy();

if (!process.env.DATABASE_URL) {
  console.error('[event-bot] DATABASE_URL не задан.');
  process.exit(1);
}

const bot = startEventAttendanceBot(pool);
if (!bot) process.exit(0);

async function shutdown() {
  console.log('[event-bot] Останавливаюсь…');
  try {
    if (typeof bot.destroy === 'function') await bot.destroy();
  } catch {
    /* ignore */
  }
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
