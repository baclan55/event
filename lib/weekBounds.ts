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

/**
 * Условие SQL: момент `expr` попадает в календарную неделю со смещением `offsetWeeks`
 * назад от текущей (0 = текущая неделя, 1 = прошлая неделя и т.д.).
 * `offsetWeeks` подставляется как литерал — вызывается только с константами из кода,
 * не с пользовательским вводом.
 */
export function sqlInWeekOffset(expr: string, tzParam: number, offsetWeeks: number): string {
  const n = Math.max(0, Math.floor(offsetWeeks));
  const shift = `- interval '7 days' * ${n}`;
  return (
    `(${expr} AT TIME ZONE $${tzParam}) >= date_trunc('week', now() AT TIME ZONE $${tzParam}) ${shift}`
    + ` AND (${expr} AT TIME ZONE $${tzParam}) < date_trunc('week', now() AT TIME ZONE $${tzParam}) ${shift} + interval '7 days'`
  );
}

/**
 * Число уникальных проведённых сборов МП за календарную неделю со смещением offsetWeeks
 * назад от текущей (1 = прошлая, уже завершившаяся неделя). Считается напрямую по
 * discord_gather_events — той же логикой, что и текущая неделя, — независимо от того,
 * сформирована ли уже выплата за эту неделю.
 */
export async function countMpForUserInWeekOffset(
  query: SqlQuery,
  userId: number,
  offsetWeeks: number,
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
       AND ${sqlInWeekOffset('e.message_created_at', 2, offsetWeeks)}`,
    [userId, tz],
  );
  return Number(result.rows[0]?.count || 0);
}

/** Календарные границы (даты пн и вс) недели со смещением offsetWeeks назад от текущей. */
export async function weekOffsetDateRange(
  query: SqlQuery,
  offsetWeeks: number,
  tz = weekTimeZone(),
): Promise<{ start: string; end: string }> {
  const n = Math.max(0, Math.floor(offsetWeeks));
  const result = await query(
    `SELECT
       (date_trunc('week', now() AT TIME ZONE $1) - interval '7 days' * $2)::date::text AS start,
       (date_trunc('week', now() AT TIME ZONE $1) - interval '7 days' * $2 + interval '6 days')::date::text AS "end"`,
    [tz, n],
  );
  return {
    start: String(result.rows[0]?.start || ''),
    end: String(result.rows[0]?.end || ''),
  };
}
