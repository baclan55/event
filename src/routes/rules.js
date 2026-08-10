const express = require('express');
const pool = require('../db/pool');
const upload = require('../middleware/upload');
const { saveImage } = require('../db/images');
const { requireAnyRole, requireRoleIn } = require('../middleware/auth');
const { EDIT_ROLES } = require('../utils/roleAccess');
const { renderBody, rawBodyForEdit, normalizeMarkdownSource } = require('../utils/richText');

const router = express.Router();

// Виден только сотрудникам с назначенной ролью (см. requireAnyRole).
router.get('/', requireAnyRole, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, position, title, body, image_id, updated_at
       FROM rules ORDER BY position ASC, id ASC`
    );
    // bodyRaw — исходный Markdown-текст для предзаполнения редактора при
    // открытии правила на редактирование (см. public/js/markdownEditor.js).
    const rules = rows.map((r) => ({ ...r, body: renderBody(r.body), bodyRaw: rawBodyForEdit(r.body) }));
    res.json({ rules });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRoleIn(EDIT_ROLES), async (req, res, next) => {
  try {
    const title = (req.body.title || '').trim();
    const body = normalizeMarkdownSource(req.body.body || '');
    if (!title) return res.status(400).json({ error: 'Укажите заголовок правила.' });
    const maxPos = await pool.query('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM rules');
    const { rows } = await pool.query(
      `INSERT INTO rules (position, title, body) VALUES ($1, $2, $3) RETURNING id`,
      [maxPos.rows[0].next, title, body]
    );
    res.json({ ok: true, id: rows[0].id });
  } catch (err) {
    next(err);
  }
});

router.put('/reorder', requireRoleIn(EDIT_ROLES), express.json(), async (req, res, next) => {
  // не используется UI, но оставлено для удобства (перетаскивание порядка)
  try {
    const { order } = req.body || {};
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order должен быть массивом id.' });
    for (let i = 0; i < order.length; i++) {
      await pool.query('UPDATE rules SET position = $1 WHERE id = $2', [i, order[i]]);
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireRoleIn(EDIT_ROLES), async (req, res, next) => {
  try {
    const title = (req.body.title || '').trim();
    const body = normalizeMarkdownSource(req.body.body || '');
    if (!title) return res.status(400).json({ error: 'Укажите заголовок правила.' });
    await pool.query(
      `UPDATE rules SET title = $1, body = $2, updated_at = now() WHERE id = $3`,
      [title, body, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/image', requireRoleIn(EDIT_ROLES), upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не получен.' });
    const imageId = await saveImage(req.file);
    await pool.query('UPDATE rules SET image_id = $1, updated_at = now() WHERE id = $2', [imageId, req.params.id]);
    res.json({ ok: true, imageId });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/image', requireRoleIn(EDIT_ROLES), async (req, res, next) => {
  try {
    await pool.query('UPDATE rules SET image_id = NULL, updated_at = now() WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireRoleIn(EDIT_ROLES), async (req, res, next) => {
  try {
    await pool.query('DELETE FROM rules WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
