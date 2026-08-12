import { Hono } from 'hono';

const router = new Hono();

router.get('/:id', async (c) => {
  const db = c.get('db');
  const { rows } = await db.query('SELECT mime_type, data FROM images WHERE id = $1', [c.req.param('id')]);
  if (!rows.length) return c.body(null, 404);
  const row = rows[0];
  // row.data — Buffer/Uint8Array из драйвера БД
  // копируем в чистый ArrayBuffer для тела ответа.
  const bytes = new Uint8Array(row.data);
  return c.body(bytes.buffer, 200, {
    'Content-Type': row.mime_type,
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
});

export default router;
