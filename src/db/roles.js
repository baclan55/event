// ============================================================================
// Управление НАБОРОМ ролей пользователя (таблица user_roles, многие-ко-
// многим — см. src/db/schema.sql). users.role_id остаётся кэшем "основной"
// роли (той, что выше по приоритету среди назначенных, см. roles.priority)
// — используется для сортировки/группировки в «Составе» и определения тира
// (src/utils/tier.js). Он всегда пересчитывается здесь же, чтобы не
// рассинхронизироваться с user_roles. Реальный список ролей для проверки
// доступа к разделам (src/utils/roleAccess.js) — user_roles.
// ============================================================================
const pool = require('./pool');

// Пересчитывает и сохраняет users.role_id = роль с наивысшим приоритетом
// (наименьшее число priority) среди назначенных в user_roles, либо NULL,
// если ролей не осталось вовсе. Выполняется в переданном client — вызывающая
// сторона отвечает за транзакцию.
async function recomputeBestRole(client, userId) {
  const { rows } = await client.query(
    `SELECT r.id FROM user_roles ur JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1 ORDER BY r.priority ASC LIMIT 1`,
    [userId]
  );
  const bestId = rows.length ? rows[0].id : null;
  await client.query('UPDATE users SET role_id = $1 WHERE id = $2', [bestId, userId]);
  return bestId;
}

// Полностью заменяет набор ролей пользователя на переданный список ID
// (используется формами редактирования в «Составе» и «Панели владельца»,
// где администратор выбирает роли чекбоксами). Пустой/отсутствующий список
// оставляет пользователя без ролей.
async function replaceUserRoles(userId, roleIds) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
    const unique = [...new Set((roleIds || []).map((id) => parseInt(id, 10)).filter((id) => Number.isInteger(id)))];
    for (const roleId of unique) {
      await client.query(
        'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
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

// Добавляет ОДНУ роль, не трогая уже назначенные (например, выдача Mini
// Event Helper кандидату, прошедшему обзвон, — см. src/routes/applications.js).
async function addUserRole(userId, roleId) {
  if (roleId == null) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, roleId]
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

// Полный список ролей (id, name, priority) для набора пользователей одним
// запросом — используется, чтобы не делать по запросу на каждого в списке
// (см. GET /api/roster и GET /api/owner/users). Возвращает Map<userId, [...]>,
// роли внутри каждого списка отсортированы от высшей к низшей.
async function getRolesForUsers(userIds) {
  const map = new Map();
  if (!userIds || !userIds.length) return map;
  const { rows } = await pool.query(
    `SELECT ur.user_id, r.id, r.name, r.priority
     FROM user_roles ur JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ANY($1::int[])
     ORDER BY r.priority ASC`,
    [userIds]
  );
  for (const row of rows) {
    if (!map.has(row.user_id)) map.set(row.user_id, []);
    map.get(row.user_id).push({ id: row.id, name: row.name, priority: row.priority });
  }
  return map;
}

module.exports = { replaceUserRoles, addUserRole, getRolesForUsers, recomputeBestRole };
