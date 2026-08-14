import { pool, query } from '@/lib/db';

type DbClient = { query: typeof pool.query };

/** Закрыть открытые интервалы ролей, которых больше нет; открыть новые. */
export async function syncUserRoleHistory(
  client: DbClient,
  userId: number,
  nextRoleIds: number[],
  at: Date = new Date(),
) {
  const unique = [...new Set(nextRoleIds.map(Number).filter((id) => Number.isFinite(id)))];
  const open = await client.query<{ id: number; role_id: number }>(
    `SELECT id, role_id FROM user_role_history
     WHERE user_id = $1 AND ended_at IS NULL`,
    [userId],
  );
  const openByRole = new Map(open.rows.map((r) => [r.role_id, r.id]));
  const nextSet = new Set(unique);

  for (const row of open.rows) {
    if (!nextSet.has(row.role_id)) {
      await client.query(
        'UPDATE user_role_history SET ended_at = $2 WHERE id = $1 AND ended_at IS NULL',
        [row.id, at.toISOString()],
      );
    }
  }

  for (const roleId of unique) {
    if (!openByRole.has(roleId)) {
      await client.query(
        `INSERT INTO user_role_history (user_id, role_id, started_at, ended_at)
         VALUES ($1, $2, $3, NULL)`,
        [userId, roleId, at.toISOString()],
      );
    }
  }
}

type SimpleQuery = <T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params?: unknown[],
) => Promise<{ rows: T[] }>;

/** Helper-роль пользователя в момент `at` (лучший priority среди is_event_helper). */
export async function helperRoleAt(
  dbQuery: SimpleQuery,
  userId: number,
  at: Date | string,
): Promise<{ id: number; name: string; priority: number } | null> {
  const { rows } = await dbQuery<{ id: number; name: string; priority: number }>(
    `SELECT r.id, r.name, r.priority
     FROM user_role_history h
     JOIN roles r ON r.id = h.role_id
     WHERE h.user_id = $1
       AND r.is_event_helper = TRUE
       AND h.started_at <= $2::timestamptz
       AND (h.ended_at IS NULL OR h.ended_at > $2::timestamptz)
     ORDER BY r.priority ASC
     LIMIT 1`,
    [userId, typeof at === 'string' ? at : at.toISOString()],
  );
  if (rows[0]) return rows[0];

  const fallback = await dbQuery<{ id: number; name: string; priority: number }>(
    `SELECT r.id, r.name, r.priority
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1 AND r.is_event_helper = TRUE
     ORDER BY r.priority ASC
     LIMIT 1`,
    [userId],
  );
  return fallback.rows[0] || null;
}

export async function helperRoleAtNow(
  userId: number,
  at: Date | string,
): Promise<{ id: number; name: string; priority: number } | null> {
  return helperRoleAt(query as SimpleQuery, userId, at);
}
