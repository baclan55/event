const express = require('express');
const pool = require('../db/pool');
const upload = require('../middleware/upload');
const { saveImage } = require('../db/images');
const { requireAnyRole, requireRoleIn } = require('../middleware/auth');
const { EDIT_ROLES } = require('../utils/roleAccess');
const { tierForPriority } = require('../utils/tier');
const { renderBody, rawBodyForEdit, normalizeMarkdownSource } = require('../utils/richText');

const router = express.Router();

const ALLOWED_SECTIONS = new Set(['faq', 'regulations', 'first_steps']);
const ALLOWED_AUDIENCE = new Set(['helper', 'administrator', 'general']);

function checkSection(req, res, next) {
  if (!ALLOWED_SECTIONS.has(req.params.section)) {
    return res.status(404).json({ error: 'Неизвестный раздел.' });
  }
  next();
}

// Возвращает все блоки раздела (обе аудитории для faq/regulations,
// одну "general" для first_steps), в виде { helper: {...}, administrator: {...} }
// Виден только сотрудникам с назначенной ролью (см. requireAnyRole).
router.get('/:section', checkSection, requireAnyRole, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.audience, c.body, c.image_id, c.updated_at, u.nickname AS updated_by_name
       FROM content_blocks c
       LEFT JOIN users u ON u.id = c.updated_by
       WHERE c.section = $1`,
      [req.params.section]
    );
    // Блок аудитории "administrator" (FAQ/Регламент) не отдаём сотрудникам
    // тира "хелперы" — они не должны видеть содержимое, предназначенное
    // администраторам, даже если на фронте вкладка переключения скрыта.
    // Владелец и тир "admin" (см. src/utils/tier.js) видят оба блока.
    const tier = tierForPriority(req.user.role_priority);
    const canSeeAdministrator = req.user.is_owner || tier === 'admin';

    const result = {};
    for (const row of rows) {
      if (row.audience === 'administrator' && !canSeeAdministrator) continue;
      result[row.audience] = {
        body: renderBody(row.body),
        // Исходный Markdown-текст — для предзаполнения редактора при
        // открытии на редактирование (см. public/js/markdownEditor.js).
        // Для отображения используется только body выше.
        bodyRaw: rawBodyForEdit(row.body),
        imageId: row.image_id,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by_name,
      };
    }
    res.json({ section: req.params.section, blocks: result });
  } catch (err) {
    next(err);
  }
});

router.put('/:section', checkSection, requireRoleIn(EDIT_ROLES), async (req, res, next) => {
  try {
    const audience = ALLOWED_AUDIENCE.has(req.body.audience) ? req.body.audience : 'general';
    const body = normalizeMarkdownSource(typeof req.body.body === 'string' ? req.body.body : '');
    await pool.query(
      `INSERT INTO content_blocks (section, audience, body, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (section, audience)
       DO UPDATE SET body = EXCLUDED.body, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [req.params.section, audience, body, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:section/image', checkSection, requireRoleIn(EDIT_ROLES), upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не получен.' });
    const audience = ALLOWED_AUDIENCE.has(req.body.audience) ? req.body.audience : 'general';
    const imageId = await saveImage(req.file);
    await pool.query(
      `INSERT INTO content_blocks (section, audience, body, image_id, updated_by, updated_at)
       VALUES ($1, $2, '', $3, $4, now())
       ON CONFLICT (section, audience)
       DO UPDATE SET image_id = EXCLUDED.image_id, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [req.params.section, audience, imageId, req.user.id]
    );
    res.json({ ok: true, imageId });
  } catch (err) {
    next(err);
  }
});

router.delete('/:section/image', checkSection, requireRoleIn(EDIT_ROLES), async (req, res, next) => {
  try {
    const audience = ALLOWED_AUDIENCE.has(req.query.audience) ? req.query.audience : 'general';
    await pool.query(
      `UPDATE content_blocks SET image_id = NULL, updated_by = $3, updated_at = now()
       WHERE section = $1 AND audience = $2`,
      [req.params.section, audience, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
