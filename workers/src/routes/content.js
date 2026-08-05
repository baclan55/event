import { Hono } from 'hono';
import { requireAdmin } from '../middleware/auth.js';
import { saveImage } from '../db.js';
import { getImageFile } from '../upload.js';

const router = new Hono();
const ALLOWED_SECTIONS = new Set(['faq', 'regulations', 'first_steps']);
const ALLOWED_AUDIENCE = new Set(['helper', 'administrator', 'general']);

async function checkSection(c, next) {
  if (!ALLOWED_SECTIONS.has(c.req.param('section'))) {
    return c.json({ error: 'Неизвестный раздел.' }, 404);
  }
  await next();
}

router.get('/:section', checkSection, async (c) => {
  const db = c.get('db');
  const section = c.req.param('section');
  const { rows } = await db.query(
    `SELECT c.audience, c.body, c.image_id, c.updated_at, u.nickname AS updated_by_name
     FROM content_blocks c
     LEFT JOIN users u ON u.id = c.updated_by
     WHERE c.section = $1`,
    [section]
  );
  const blocks = {};
  for (const row of rows) {
    blocks[row.audience] = {
      body: row.body,
      imageId: row.image_id,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by_name,
    };
  }
  return c.json({ section, blocks });
});

router.put('/:section', checkSection, requireAdmin, async (c) => {
  const db = c.get('db');
  const body = await c.req.json().catch(() => ({}));
  const audience = ALLOWED_AUDIENCE.has(body.audience) ? body.audience : 'general';
  const text = typeof body.body === 'string' ? body.body : '';
  const user = c.get('user');
  await db.query(
    `INSERT INTO content_blocks (section, audience, body, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (section, audience)
     DO UPDATE SET body = EXCLUDED.body, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [c.req.param('section'), audience, text, user.id]
  );
  return c.json({ ok: true });
});

router.post('/:section/image', checkSection, requireAdmin, async (c) => {
  const db = c.get('db');
  const form = await c.req.formData();
  const { file, error } = getImageFile(form);
  if (error) return c.json({ error }, 400);
  const audience = ALLOWED_AUDIENCE.has(form.get('audience')) ? form.get('audience') : 'general';
  const imageId = await saveImage(db, file);
  const user = c.get('user');
  await db.query(
    `INSERT INTO content_blocks (section, audience, body, image_id, updated_by, updated_at)
     VALUES ($1, $2, '', $3, $4, now())
     ON CONFLICT (section, audience)
     DO UPDATE SET image_id = EXCLUDED.image_id, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [c.req.param('section'), audience, imageId, user.id]
  );
  return c.json({ ok: true, imageId });
});

router.delete('/:section/image', checkSection, requireAdmin, async (c) => {
  const db = c.get('db');
  const audienceParam = c.req.query('audience');
  const audience = ALLOWED_AUDIENCE.has(audienceParam) ? audienceParam : 'general';
  const user = c.get('user');
  await db.query(
    `UPDATE content_blocks SET image_id = NULL, updated_by = $3, updated_at = now()
     WHERE section = $1 AND audience = $2`,
    [c.req.param('section'), audience, user.id]
  );
  return c.json({ ok: true });
});

export default router;
