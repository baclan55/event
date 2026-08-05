import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { requireOwner } from '../middleware/auth.js';

const router = new Hono();

router.use('*', requireOwner);

router.get('/users', async (c) => {
  const db = c.get('db');
  const { rows } = await db.query(
    `SELECT u.id, u.login, u.nickname, u.discord_username, u.is_owner, u.is_admin,
            u.weekly_events, u.role_id, r.name AS role_name, u.created_at
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     ORDER BY u.created_at ASC`
  );
  return c.json({ users: rows });
});

router.put('/users/:id', async (c) => {
  const db = c.get('db');
  const body = await c.req.json().catch(() => ({}));
  const { nickname, roleId, isAdmin, isOwner } = body || {};
  const fields = [];
  const values = [];
  let i = 1;

  if (typeof nickname === 'string' && nickname.trim()) {
    fields.push(`nickname = $${i++}`);
    values.push(nickname.trim());
  }
  if (roleId !== undefined) {
    fields.push(`role_id = $${i++}`);
    values.push(roleId || null);
  }
  if (typeof isAdmin === 'boolean') {
    fields.push(`is_admin = $${i++}`);
    values.push(isAdmin);
  }
  if (typeof isOwner === 'boolean') {
    fields.push(`is_owner = $${i++}`);
    values.push(isOwner);
  }
  if (!fields.length) return c.json({ ok: true });

  values.push(c.req.param('id'));
  await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${i}`, values);
  return c.json({ ok: true });
});

router.put('/users/:id/password', async (c) => {
  const db = c.get('db');
  const body = await c.req.json().catch(() => ({}));
  const { password } = body || {};
  if (!password || String(password).length < 4) {
    return c.json({ error: 'Пароль должен быть не короче 4 символов.' }, 400);
  }
  const hash = await bcrypt.hash(password, 10);
  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, c.req.param('id')]);
  return c.json({ ok: true });
});

router.delete('/users/:id', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  if (String(user.id) === String(c.req.param('id'))) {
    return c.json({ error: 'Нельзя удалить самого себя.' }, 400);
  }
  await db.query('DELETE FROM users WHERE id = $1', [c.req.param('id')]);
  return c.json({ ok: true });
});

export default router;
