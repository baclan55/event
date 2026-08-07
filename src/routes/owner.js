const express = require('express');
const pool = require('../db/pool');
const { requireRoleIn } = require('../middleware/auth');
const { OWNER_PANEL_ROLES } = require('../utils/roleAccess');

const router = express.Router();

// Панель владельца доступна только ролям Chief Event / Dep.Chief Event
// (плюс аккаунту с флагом is_owner — см. src/utils/roleAccess.js).
router.use(requireRoleIn(OWNER_PANEL_ROLES));

router.get('/users', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.discord_id, u.nickname, u.discord_username, u.is_owner, u.is_admin,
              u.weekly_events, u.role_id, r.name AS role_name, u.created_at
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       ORDER BY u.created_at ASC`
    );
    res.json({ users: rows });
  } catch (err) {
    next(err);
  }
});

router.put('/users/:id', async (req, res, next) => {
  try {
    const { nickname, roleId, isAdmin, isOwner } = req.body || {};
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
    if (!fields.length) return res.json({ ok: true });

    values.push(req.params.id);
    await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${i}`, values);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/users/:id', async (req, res, next) => {
  try {
    if (String(req.user.id) === String(req.params.id)) {
      return res.status(400).json({ error: 'Нельзя удалить самого себя.' });
    }
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
