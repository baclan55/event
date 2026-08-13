import { runtimeEnv } from '@/lib/runtimeEnv';

/** TZ для календарной недели (пн 00:00 → вс 23:59). */
export function weekTimeZone(): string {
  return runtimeEnv('WEEKLY_RESET_TZ') || 'Europe/Moscow';
}

/**
 * Условие SQL: момент `expr` попадает в текущую календарную неделю (пн–вс) в TZ.
 * `$N` — параметр с именем таймзоны (Europe/Moscow и т.п.).
 *
 * Для МП используем message_created_at (когда был сбор), а не completed_at:
 * при «Пересобрать МП» completed_at может стать «сейчас» и раздуть счётчик.
 */
export function sqlInCurrentWeek(expr: string, tzParam: number): string {
  return (
    `(${expr} AT TIME ZONE $${tzParam}) >= date_trunc('week', now() AT TIME ZONE $${tzParam})`
    + ` AND (${expr} AT TIME ZONE $${tzParam}) < date_trunc('week', now() AT TIME ZONE $${tzParam}) + interval '7 days'`
  );
}

/** Условие SQL: момент `expr` попадает в текущий календарный день в TZ. */
export function sqlInCurrentDay(expr: string, tzParam: number): string {
  return `(${expr} AT TIME ZONE $${tzParam})::date = (now() AT TIME ZONE $${tzParam})::date`;
}

/** Подзапрос COUNT уникальных completed-МП по discord_id за текущую неделю. */
export function sqlCountWeeklyMpSubquery(discordIdExpr: string, tzParam: number): string {
  const week = sqlInCurrentWeek('e.message_created_at', tzParam);
  return `(
    SELECT COUNT(DISTINCT e.message_id)::int
    FROM discord_gather_participants p
    JOIN discord_gather_events e ON e.message_id = p.message_id
    WHERE p.discord_id = ${discordIdExpr}
      AND e.status = 'completed'
      AND ${week}
  )`;
}

export type SqlQuery = (
  text: string,
  params?: unknown[],
) => Promise<{ rows: Array<Record<string, unknown>> }>;

/**
 * Число уникальных проведённых сборов МП за текущую календарную неделю
 * (по дате сообщения сбора, без дублей).
 */
export async function countWeeklyMpForUser(
  query: SqlQuery,
  userId: number,
  tz = weekTimeZone(),
): Promise<number> {
  const result = await query(
    `SELECT COUNT(DISTINCT e.message_id)::text AS count
     FROM discord_gather_participants p
     JOIN discord_gather_events e ON e.message_id = p.message_id
     JOIN users u ON u.discord_id = p.discord_id
     WHERE u.id = $1
       AND u.discord_id IS NOT NULL
       AND e.status = 'completed'
       AND ${sqlInCurrentWeek('e.message_created_at', 2)}`,
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
