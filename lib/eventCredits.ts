/**
 * Доначисление МП за календарную неделю (пн–вс) по леджеру event_bot_credits.
 * Нужно, когда участник был в Discord-сборе до появления в users —
 * после регистрации/привязки Discord ID старые completed-сборы текущей
 * недели попадают в weekly_events.
 */

import { sqlInCurrentWeek, weekTimeZone, type SqlQuery } from '@/lib/weekBounds';

export type { SqlQuery };

export async function reconcileWeeklyEventCredits(
  query: SqlQuery,
  discordId: string,
  tz = weekTimeZone(),
): Promise<{ userId: number | null; weeklyEvents: number; creditCount: number }> {
  const id = String(discordId || '').trim();
  if (!/^\d{17,20}$/.test(id)) {
    return { userId: null, weeklyEvents: 0, creditCount: 0 };
  }

  const credits = await query(
    `SELECT COUNT(*)::text AS count
     FROM event_bot_credits c
     JOIN discord_gather_events e ON e.message_id = c.message_id
     WHERE c.discord_id = $1
       AND e.status = 'completed'
       AND ${sqlInCurrentWeek('COALESCE(e.completed_at, e.message_created_at)', 2)}`,
    [id, tz],
  );
  const creditCount = Number(credits.rows[0]?.count || 0);

  // Точное значение за текущую календарную неделю (не «последние 7 дней»).
  const updated = await query(
    `UPDATE users
     SET weekly_events = $2
     WHERE discord_id = $1
     RETURNING id, weekly_events`,
    [id, creditCount],
  );

  const row = updated.rows[0];
  return {
    userId: row?.id != null ? Number(row.id) : null,
    weeklyEvents: row?.weekly_events != null ? Number(row.weekly_events) : 0,
    creditCount,
  };
}
