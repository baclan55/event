import { Hono } from 'hono';
import { requireAdmin } from '../middleware/auth.js';
import { saveImage } from '../db.js';
import { getImageFile } from '../upload.js';

const router = new Hono();

router.get('/', async (c) => {
  const db = c.get('db');
  const { rows } = await db.query(
    `SELECT id, position, title, body, image_id, updated_at
     FROM rules ORDER BY position ASC, id ASC`
  );
  return c.json({ rules: rows });
});

router.post('/', requireAdmin, async (c) => {
  const db = c.get('db');
  const body = await c.req.json().catch(() => ({}));
  const title = (body.title || '').trim();
  const text = body.body || '';
  if (!title) return c.json({ error: 'Укажите заголовок правила.' }, 400);
  const maxPos = await db.query('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM rules');
  const { rows } = await db.query(
    `INSERT INTO rules (position, title, body) VALUES ($1, $2, $3) RETURNING id`,
    [maxPos.rows[0].next, title, text]
  );
  return c.json({ ok: true, id: rows[0].id });
});

// Регистрируем /reorder ДО /:id — иначе Hono отдаст "reorder" за id.
router.put('/reorder', requireAdmin, async (c) => {
  const db = c.get('db');
  const body = await c.req.json().catch(() => ({}));
  const { order } = body || {};
  if (!Array.isArray(order)) return c.json({ error: 'order должен быть массивом id.' }, 400);
  for (let i = 0; i < order.length; i++) {
    await db.query('UPDATE rules SET position = $1 WHERE id = $2', [i, order[i]]);
  }
  return c.json({ ok: true });
});

router.put('/:id', requireAdmin, async (c) => {
  const db = c.get('db');
  const body = await c.req.json().catch(() => ({}));
  const title = (body.title || '').trim();
  const text = body.body || '';
  if (!title) return c.json({ error: 'Укажите заголовок правила.' }, 400);
  await db.query(
    `UPDATE rules SET title = $1, body = $2, updated_at = now() WHERE id = $3`,
    [title, text, c.req.param('id')]
  );
  return c.json({ ok: true });
});

router.post('/:id/image', requireAdmin, async (c) => {
  const db = c.get('db');
  const form = await c.req.formData();
  const { file, error } = getImageFile(form);
  if (error) return c.json({ error }, 400);
  const imageId = await saveImage(db, file);
  await db.query('UPDATE rules SET image_id = $1, updated_at = now() WHERE id = $2', [imageId, c.req.param('id')]);
  return c.json({ ok: true, imageId });
});

router.delete('/:id/image', requireAdmin, async (c) => {
  const db = c.get('db');
  await db.query('UPDATE rules SET image_id = NULL, updated_at = now() WHERE id = $1', [c.req.param('id')]);
  return c.json({ ok: true });
});

router.delete('/:id', requireAdmin, async (c) => {
  const db = c.get('db');
  await db.query('DELETE FROM rules WHERE id = $1', [c.req.param('id')]);
  return c.json({ ok: true });
});

export default router;
