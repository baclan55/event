import { pool } from '@/lib/db';

/** Сброс weekly_events каждый понедельник (TZ из WEEKLY_RESET_TZ). */
export function startWeeklyResetScheduler() {
  const tz = process.env.WEEKLY_RESET_TZ || 'Europe/Moscow';
  let lastKey = '';

  const tick = async () => {
    try {
      const now = new Date();
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        hour12: false,
      });
      const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
      if (parts.weekday !== 'Mon' || parts.hour !== '00') return;
      const key = `${parts.year}-${parts.month}-${parts.day}`;
      if (key === lastKey) return;
      lastKey = key;
      await pool.query('UPDATE users SET weekly_events = 0');
      console.log(`[weekly-reset] Сброс weekly_events (${tz}) ${key}`);
    } catch (err) {
      console.error('[weekly-reset]', (err as Error).message);
    }
  };

  setInterval(tick, 60_000).unref?.();
  void tick();
}
