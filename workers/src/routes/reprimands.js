import { Hono } from 'hono';
import { requireAdmin } from '../middleware/auth.js';

const router = new Hono();

// Список выговоров виден только администраторам/владельцу — это раздел
// внутренней дисциплины отдела.
router.get('/', requireAdmin, async (c) => {
  const db = c.get('db');
  const { rows } = await db.query(
    `SELECT rp.id, rp.reason, rp.created_at,
            u.id AS user_id, u.nickname AS user_nickname,
            iu.nickname AS issued_by_nickname
     FROM reprimands rp
     JOIN users u ON u.id = rp.user_id
     LEFT JOIN users iu ON iu.id = rp.issued_by
     ORDER BY rp.created_at DESC`
  );
  return c.json({ reprimands: rows });
});

router.post('/', requireAdmin, async (c) => {
  const db = c.get('db');
  const body = await c.req.json().catch(() => ({}));
  const userId = body.userId;
  const reason = (body.reason || '').trim();
  if (!userId || !reason) {
    return c.json({ error: 'Укажите участника и причину выговора.' }, 400);
  }
  const user = c.get('user');
  await db.query(
    `INSERT INTO reprimands (user_id, reason, issued_by) VALUES ($1, $2, $3)`,
    [userId, reason, user.id]
  );
  return c.json({ ok: true });
});

router.delete('/:id', requireAdmin, async (c) => {
  const db = c.get('db');
  await db.query('DELETE FROM reprimands WHERE id = $1', [c.req.param('id')]);
  return c.json({ ok: true });
});

export default router;
