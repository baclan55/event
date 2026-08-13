/**
 * Синхронизация МП за календарную неделю (пн–вс) после входа / привязки Discord.
 * Считаем уникальные completed-сборы по message_created_at — не по completed_at
 * и не по сырому числу строк в event_bot_credits (там могут быть старые записи
 * после пересборки).
 */

import { countWeeklyMpForUser, weekTimeZone, type SqlQuery } from '@/lib/weekBounds';

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

  const found = await query(
    'SELECT id FROM users WHERE discord_id = $1',
    [id],
  );
  const userId = found.rows[0]?.id != null ? Number(found.rows[0].id) : null;
  if (userId == null) {
    return { userId: null, weeklyEvents: 0, creditCount: 0 };
  }

  const creditCount = await countWeeklyMpForUser(query, userId, tz);
  const updated = await query(
    `UPDATE users
     SET weekly_events = $2
     WHERE id = $1
     RETURNING id, weekly_events`,
    [userId, creditCount],
  );

  const row = updated.rows[0];
  return {
    userId: row?.id != null ? Number(row.id) : null,
    weeklyEvents: row?.weekly_events != null ? Number(row.weekly_events) : creditCount,
    creditCount,
  };
}
