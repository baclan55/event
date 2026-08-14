import { query } from '@/lib/db';
import { sqlCountWeeklyMpSubquery, weekTimeZone } from '@/lib/weekBounds';

export type TopStaffMember = {
  id: number;
  nickname: string;
  avatarUrl: string | null;
  weeklyEvents: number;
};

/**
 * Топ-N сотрудников (администраторы + хелперы вместе, без деления по фракциям
 * и без ролей на карточке) по количеству МП за текущую календарную неделю.
 * Используется на публичной главной странице сайта, поэтому запрос не требует
 * авторизации и отдаёт только минимально необходимые публичные поля.
 */
export async function getTopStaff(limit = 3): Promise<TopStaffMember[]> {
  const tz = weekTimeZone();
  const weekCountSql = sqlCountWeeklyMpSubquery('u.discord_id', 1);
  try {
    const result = await query<Record<string, unknown>>(
      `SELECT ranked.id, ranked.nickname, ranked.avatar_url, ranked.avatar_image_id, ranked.weekly_events
       FROM (
         SELECT u.id, u.nickname, u.avatar_url, u.avatar_image_id,
           CASE WHEN u.discord_id IS NULL THEN 0 ELSE COALESCE(${weekCountSql}, 0) END AS weekly_events
         FROM users u
         WHERE u.role_id IS NOT NULL
           AND u.is_blocked = FALSE
           AND u.status = 'member'
       ) ranked
       WHERE ranked.weekly_events > 0
       ORDER BY ranked.weekly_events DESC, ranked.nickname ASC
       LIMIT $2`,
      [tz, limit],
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      nickname: String(row.nickname || '—'),
      avatarUrl: (row.avatar_url as string | null) || (row.avatar_image_id ? `/media/${row.avatar_image_id}` : null),
      weeklyEvents: Number(row.weekly_events) || 0,
    }));
  } catch (err) {
    console.error('[topStaff] getTopStaff:', err);
    return [];
  }
}
