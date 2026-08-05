const express = require('express');
const pool = require('../db/pool');
const upload = require('../middleware/upload');
const { saveImage } = require('../db/images');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

const TARGET = parseInt(process.env.WEEKLY_EVENTS_TARGET, 10) || 5;

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.nickname, u.discord_username, u.avatar_image_id,
              u.weekly_events, u.note, u.role_id,
              r.name AS role_name, r.priority AS role_priority
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       ORDER BY COALESCE(r.priority, 999) ASC, u.nickname ASC`
    );
    res.json({ members: rows, target: TARGET });
  } catch (err) {
    next(err);
  }
});

router.get('/roles', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT id, name, priority FROM roles ORDER BY priority ASC');
    res.json({ roles: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const nickname = (req.body.nickname || '').trim();
    if (!nickname) return res.status(400).json({ error: 'Укажите никнейм участника.' });
    const roleId = req.body.roleId || null;
    const weeklyEvents = parseInt(req.body.weeklyEvents, 10) || 0;
    const note = req.body.note || '';
    const { rows } = await pool.query(
      `INSERT INTO users (nickname, role_id, weekly_events, note)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [nickname, roleId, weeklyEvents, note]
    );
    res.json({ ok: true, id: rows[0].id });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const nickname = (req.body.nickname || '').trim();
    if (!nickname) return res.status(400).json({ error: 'Укажите никнейм участника.' });
    const roleId = req.body.roleId || null;
    const weeklyEvents = parseInt(req.body.weeklyEvents, 10) || 0;
    const note = req.body.note || '';
    await pool.query(
      `UPDATE users SET nickname = $1, role_id = $2, weekly_events = $3, note = $4 WHERE id = $5`,
      [nickname, roleId, weeklyEvents, note, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/avatar', requireAdmin, upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не получен.' });
    const imageId = await saveImage(req.file);
    await pool.query('UPDATE users SET avatar_image_id = $1 WHERE id = $2', [imageId, req.params.id]);
    res.json({ ok: true, imageId });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    // Не даём удалить владельца случайно через этот роут
    const check = await pool.query('SELECT is_owner FROM users WHERE id = $1', [req.params.id]);
    if (check.rows[0]?.is_owner) {
      return res.status(400).json({ error: 'Нельзя удалить владельца из состава.' });
    }
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
