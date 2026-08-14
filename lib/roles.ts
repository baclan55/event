import { pool } from '@/lib/db';
import { findBlacklistMatch } from '@/lib/blacklist';
import { syncUserRoleHistory } from '@/lib/roleHistory';

export async function recomputeBestRole(client: { query: typeof pool.query }, userId: number) {
  const { rows } = await client.query<{ id: number }>(
    `SELECT r.id FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1
     ORDER BY r.priority ASC
     LIMIT 1`,
    [userId]
  );
  const roleId = rows[0]?.id ?? null;
  await client.query('UPDATE users SET role_id = $1 WHERE id = $2', [roleId, userId]);
}

async function assertUserNotBlacklisted(userId: number) {
  const target = await pool.query<{ discord_id: string | null; static_id: string | null }>(
    'SELECT discord_id, static_id FROM users WHERE id=$1',
    [userId],
  );
  const hit = await findBlacklistMatch({
    userId,
    discordId: target.rows[0]?.discord_id,
    staticId: target.rows[0]?.static_id,
  });
  if (hit) {
    throw new Error('Нельзя назначить роли: пользователь в чёрном списке.');
  }
}

export async function replaceUserRoles(userId: number, roleIds: number[]) {
  const unique = [...new Set(roleIds.map(Number).filter((id) => Number.isFinite(id)))];
  if (unique.length) await assertUserNotBlacklisted(userId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Не сбрасываем assigned_at у уже выданных ролей (нужно для достижений «N дней в рядах»).
    if (unique.length) {
      await client.query(
        'DELETE FROM user_roles WHERE user_id = $1 AND NOT (role_id = ANY($2::int[]))',
        [userId, unique],
      );
      for (const roleId of unique) {
        await client.query(
          `INSERT INTO user_roles (user_id, role_id, assigned_at) VALUES ($1, $2, now())
           ON CONFLICT DO NOTHING`,
          [userId, roleId],
        );
      }
    } else {
      await client.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
    }
    await syncUserRoleHistory(client, userId, unique);
    await recomputeBestRole(client, userId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function addUserRole(userId: number, roleName: string) {
  await assertUserNotBlacklisted(userId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: number }>(
      'SELECT id FROM roles WHERE name = $1 LIMIT 1',
      [roleName]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      throw new Error(`Роль "${roleName}" не найдена. Примените начальные данные базы.`);
    }
    await client.query(
      `INSERT INTO user_roles (user_id, role_id, assigned_at) VALUES ($1, $2, now())
       ON CONFLICT DO NOTHING`,
      [userId, rows[0].id]
    );
    const current = await client.query<{ role_id: number }>(
      'SELECT role_id FROM user_roles WHERE user_id = $1',
      [userId],
    );
    await syncUserRoleHistory(
      client,
      userId,
      current.rows.map((r) => r.role_id),
    );
    await recomputeBestRole(client, userId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getRolesForUsers(userIds: number[]) {
  const map = new Map<number, { id: number; name: string; priority: number }[]>();
  if (!userIds.length) return map;
  const { rows } = await pool.query<{
    user_id: number;
    id: number;
    name: string;
    priority: number;
  }>(
    `SELECT ur.user_id, r.id, r.name, r.priority
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ANY($1::int[])
     ORDER BY r.priority ASC`,
    [userIds]
  );
  for (const row of rows) {
    const list = map.get(row.user_id) || [];
    list.push({ id: row.id, name: row.name, priority: row.priority });
    map.set(row.user_id, list);
  }
  return map;
}
