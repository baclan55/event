const express = require('express');
const { requireRoleIn } = require('../middleware/auth');
const { EDIT_ROLES } = require('../utils/roleAccess');
const { renderMarkdown } = require('../utils/richText');

const router = express.Router();

// Общий эндпоинт предпросмотра для markdown-редактора (FAQ/Регламент/
// Первые шаги — public/js/contentSection.js, Правила МП —
// public/js/sections/rules.js). Ничего не сохраняет, просто прогоняет
// присланный текст через тот же renderMarkdown, что и обычное отображение —
// это гарантирует, что предпросмотр в редакторе всегда 1-в-1 совпадает с
// тем, что увидят на странице после сохранения (включая обработку ссылок:
// не-Discord ссылки в предпросмотре тоже превратятся в обычный текст).
// Доступ ограничен ролями с правом редактирования — тем же, что и сама
// запись, чтобы не открывать рендер посторонним без необходимости.
router.post('/preview', requireRoleIn(EDIT_ROLES), (req, res) => {
  const source = typeof req.body.body === 'string' ? req.body.body : '';
  res.json({ html: renderMarkdown(source) });
});

module.exports = router;
