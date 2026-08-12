import { pool } from '@/lib/db';

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

export async function replaceUserRoles(userId: number, roleIds: number[]) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
    const unique = [...new Set(roleIds.map(Number).filter((id) => Number.isFinite(id)))];
    for (const roleId of unique) {
      await client.query(
        `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [userId, roleId]
      );
    }
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
      `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [userId, rows[0].id]
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
