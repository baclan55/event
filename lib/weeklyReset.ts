import { pool } from '@/lib/db';
import { ensurePayoutWeek, sqlWeekStart } from '@/lib/payouts';

/** Сброс weekly_events + генерация выплат каждый понедельник (TZ из WEEKLY_RESET_TZ). */
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
        minute: '2-digit',
        hour12: false,
      });
      const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));

      // Перепроверка pending_events каждую минуту
      try {
        const pending = await pool.query<{ week_start: string }>(
          `SELECT week_start::text AS week_start FROM payout_weeks WHERE status = 'pending_events'`,
        );
        for (const row of pending.rows) {
          await ensurePayoutWeek(row.week_start, { forceRebuild: false });
        }
      } catch (err) {
        console.error('[payout-pending]', (err as Error).message);
      }

      if (parts.weekday !== 'Mon') return;
      const hour = Number(parts.hour);
      const minute = Number(parts.minute);
      // пн 00:01+ (первая минута после полуночи)
      if (hour !== 0 || minute < 1) return;

      const key = `${parts.year}-${parts.month}-${parts.day}`;
      if (key === lastKey) return;
      lastKey = key;

      await pool.query('UPDATE users SET weekly_events = 0');
      console.log(`[weekly-reset] Сброс weekly_events (${tz}) ${key}`);

      const prevWeek = await sqlWeekStart(1, tz);
      if (prevWeek) {
        const result = await ensurePayoutWeek(prevWeek, { actorId: null });
        console.log(`[payouts] Неделя ${prevWeek} → #${result.weekId} (${result.status})`);
      }
    } catch (err) {
      console.error('[weekly-reset]', (err as Error).message);
    }
  };

  setInterval(tick, 60_000).unref?.();
  void tick();
}
