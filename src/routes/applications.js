const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Список заявок виден администраторам/владельцу.
router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.applicant_name, a.contact, a.message, a.status, a.created_at,
              r.nickname AS reviewed_by_nickname
       FROM applications a
       LEFT JOIN users r ON r.id = a.reviewed_by
       ORDER BY a.created_at DESC`
    );
    res.json({ applications: rows });
  } catch (err) {
    next(err);
  }
});

// Подать заявку может любой вошедший сотрудник.
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const contact = (req.body.contact || '').trim();
    const message = (req.body.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Опишите суть заявки.' });
    await pool.query(
      `INSERT INTO applications (applicant_id, applicant_name, contact, message)
       VALUES ($1, $2, $3, $4)`,
      [req.user.id, req.user.nickname, contact, message]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const status = req.body.status;
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Некорректный статус.' });
    }
    await pool.query(
      'UPDATE applications SET status = $1, reviewed_by = $2 WHERE id = $3',
      [status, req.user.id, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM applications WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
