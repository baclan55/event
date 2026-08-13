import { runtimeEnv } from '@/lib/runtimeEnv';

/** TZ для календарной недели (пн 00:00 → вс 23:59). */
export function weekTimeZone(): string {
  return runtimeEnv('WEEKLY_RESET_TZ') || 'Europe/Moscow';
}

/**
 * Условие SQL: момент `expr` попадает в текущую календарную неделю (пн–вс) в TZ.
 * `$N` — параметр с именем таймзоны (Europe/Moscow и т.п.).
 */
export function sqlInCurrentWeek(expr: string, tzParam: number): string {
  return (
    `(${expr} AT TIME ZONE $${tzParam}) >= date_trunc('week', now() AT TIME ZONE $${tzParam})`
    + ` AND (${expr} AT TIME ZONE $${tzParam}) < date_trunc('week', now() AT TIME ZONE $${tzParam}) + interval '7 days'`
  );
}

export type SqlQuery = (
  text: string,
  params?: unknown[],
) => Promise<{ rows: Array<Record<string, unknown>> }>;

/** Число completed-сборов МП пользователя за текущую календарную неделю. */
export async function countWeeklyMpForUser(
  query: SqlQuery,
  userId: number,
  tz = weekTimeZone(),
): Promise<number> {
  const result = await query(
    `SELECT COUNT(*)::text AS count
     FROM event_bot_credits c
     JOIN discord_gather_events e ON e.message_id = c.message_id
     JOIN users u ON u.discord_id = c.discord_id
     WHERE u.id = $1
       AND e.status = 'completed'
       AND ${sqlInCurrentWeek('COALESCE(e.completed_at, e.message_created_at)', 2)}`,
    [userId, tz],
  );
  return Number(result.rows[0]?.count || 0);
}

/** Синхронизирует users.weekly_events с фактическим числом за текущую неделю. */
export async function syncWeeklyEventsForUser(
  query: SqlQuery,
  userId: number,
  tz = weekTimeZone(),
): Promise<number> {
  const count = await countWeeklyMpForUser(query, userId, tz);
  await query(
    'UPDATE users SET weekly_events = $2 WHERE id = $1',
    [userId, count],
  );
  return count;
}
