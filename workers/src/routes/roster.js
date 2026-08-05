import { Hono } from 'hono';
import { requireAdmin } from '../middleware/auth.js';
import { saveImage } from '../db.js';
import { getImageFile } from '../upload.js';

const router = new Hono();

router.get('/', async (c) => {
  const db = c.get('db');
  const target = parseInt(c.env.WEEKLY_EVENTS_TARGET, 10) || 5;
  const { rows } = await db.query(
    `SELECT u.id, u.nickname, u.login, u.discord_username, u.avatar_image_id,
            u.weekly_events, u.note, u.role_id,
            r.name AS role_name, r.priority AS role_priority
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     ORDER BY COALESCE(r.priority, 999) ASC, u.nickname ASC`
  );
  return c.json({ members: rows, target });
});

// Регистрируем /roles ДО /:id — иначе Hono решит, что "roles" это id участника.
router.get('/roles', async (c) => {
  const db = c.get('db');
  const { rows } = await db.query('SELECT id, name, priority FROM roles ORDER BY priority ASC');
  return c.json({ roles: rows });
});

router.post('/', requireAdmin, async (c) => {
  const db = c.get('db');
  const body = await c.req.json().catch(() => ({}));
  const nickname = (body.nickname || '').trim();
  if (!nickname) return c.json({ error: 'Укажите никнейм участника.' }, 400);
  const roleId = body.roleId || null;
  const weeklyEvents = parseInt(body.weeklyEvents, 10) || 0;
  const note = body.note || '';
  const { rows } = await db.query(
    `INSERT INTO users (nickname, role_id, weekly_events, note)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [nickname, roleId, weeklyEvents, note]
  );
  return c.json({ ok: true, id: rows[0].id });
});

router.put('/:id', requireAdmin, async (c) => {
  const db = c.get('db');
  const body = await c.req.json().catch(() => ({}));
  const nickname = (body.nickname || '').trim();
  if (!nickname) return c.json({ error: 'Укажите никнейм участника.' }, 400);
  const roleId = body.roleId || null;
  const weeklyEvents = parseInt(body.weeklyEvents, 10) || 0;
  const note = body.note || '';
  await db.query(
    `UPDATE users SET nickname = $1, role_id = $2, weekly_events = $3, note = $4 WHERE id = $5`,
    [nickname, roleId, weeklyEvents, note, c.req.param('id')]
  );
  return c.json({ ok: true });
});

router.post('/:id/avatar', requireAdmin, async (c) => {
  const db = c.get('db');
  const form = await c.req.formData();
  const { file, error } = getImageFile(form);
  if (error) return c.json({ error }, 400);
  const imageId = await saveImage(db, file);
  await db.query('UPDATE users SET avatar_image_id = $1 WHERE id = $2', [imageId, c.req.param('id')]);
  return c.json({ ok: true, imageId });
});

router.delete('/:id', requireAdmin, async (c) => {
  const db = c.get('db');
  // Не даём удалить владельца случайно через этот роут
  const check = await db.query('SELECT is_owner FROM users WHERE id = $1', [c.req.param('id')]);
  if (check.rows[0]?.is_owner) {
    return c.json({ error: 'Нельзя удалить владельца из состава.' }, 400);
  }
  await db.query('DELETE FROM users WHERE id = $1', [c.req.param('id')]);
  return c.json({ ok: true });
});

export default router;
