const express = require('express');
const pool = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Список выговоров виден только администраторам/владельцу — это раздел
// внутренней дисциплины отдела.
router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT rp.id, rp.reason, rp.created_at,
              u.id AS user_id, u.nickname AS user_nickname,
              iu.nickname AS issued_by_nickname
       FROM reprimands rp
       JOIN users u ON u.id = rp.user_id
       LEFT JOIN users iu ON iu.id = rp.issued_by
       ORDER BY rp.created_at DESC`
    );
    res.json({ reprimands: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const userId = req.body.userId;
    const reason = (req.body.reason || '').trim();
    if (!userId || !reason) {
      return res.status(400).json({ error: 'Укажите участника и причину выговора.' });
    }
    await pool.query(
      `INSERT INTO reprimands (user_id, reason, issued_by) VALUES ($1, $2, $3)`,
      [userId, reason, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM reprimands WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
