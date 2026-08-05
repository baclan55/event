import { Hono } from 'hono';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = new Hono();

// Список заявок виден администраторам/владельцу.
router.get('/', requireAdmin, async (c) => {
  const db = c.get('db');
  const { rows } = await db.query(
    `SELECT a.id, a.applicant_name, a.contact, a.message, a.status, a.created_at,
            r.nickname AS reviewed_by_nickname
     FROM applications a
     LEFT JOIN users r ON r.id = a.reviewed_by
     ORDER BY a.created_at DESC`
  );
  return c.json({ applications: rows });
});

// Подать заявку может любой вошедший сотрудник.
router.post('/', requireAuth, async (c) => {
  const db = c.get('db');
  const body = await c.req.json().catch(() => ({}));
  const contact = (body.contact || '').trim();
  const message = (body.message || '').trim();
  if (!message) return c.json({ error: 'Опишите суть заявки.' }, 400);
  const user = c.get('user');
  await db.query(
    `INSERT INTO applications (applicant_id, applicant_name, contact, message)
     VALUES ($1, $2, $3, $4)`,
    [user.id, user.nickname, contact, message]
  );
  return c.json({ ok: true });
});

router.put('/:id', requireAdmin, async (c) => {
  const db = c.get('db');
  const body = await c.req.json().catch(() => ({}));
  const status = body.status;
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return c.json({ error: 'Некорректный статус.' }, 400);
  }
  const user = c.get('user');
  await db.query(
    'UPDATE applications SET status = $1, reviewed_by = $2 WHERE id = $3',
    [status, user.id, c.req.param('id')]
  );
  return c.json({ ok: true });
});

router.delete('/:id', requireAdmin, async (c) => {
  const db = c.get('db');
  await db.query('DELETE FROM applications WHERE id = $1', [c.req.param('id')]);
  return c.json({ ok: true });
});

export default router;
