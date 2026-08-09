const express = require('express');
const pool = require('../db/pool');
const upload = require('../middleware/upload');
const { saveImage } = require('../db/images');
const cloudinary = require('../utils/cloudinary');
const { requireAnyRole, requireRoleIn } = require('../middleware/auth');
const { EDIT_ROLES } = require('../utils/roleAccess');
const { tierForPriority } = require('../utils/tier');

const router = express.Router();

const TARGET = parseInt(process.env.WEEKLY_EVENTS_TARGET, 10) || 5;

// Виден только сотрудникам с назначенной ролью (см. requireAnyRole).
router.get('/', requireAnyRole, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.nickname, u.discord_username, u.avatar_image_id, u.avatar_url,
              u.weekly_events, u.note, u.role_id, u.status, u.is_blocked, u.blocked_at,
              r.name AS role_name, r.priority AS role_priority
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       ORDER BY COALESCE(r.priority, 999) ASC, u.nickname ASC`
    );
    const members = rows.map((m) => ({ ...m, tier: tierForPriority(m.role_priority) }));
    res.json({ members, target: TARGET });
  } catch (err) {
    next(err);
  }
});

router.get('/roles', requireAnyRole, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT id, name, priority FROM roles ORDER BY priority ASC');
    res.json({ roles: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRoleIn(EDIT_ROLES), async (req, res, next) => {
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

router.put('/:id', requireRoleIn(EDIT_ROLES), async (req, res, next) => {
  try {
    const nickname = (req.body.nickname || '').trim();
    if (!nickname) return res.status(400).json({ error: 'Укажите никнейм участника.' });
    const roleId = req.body.roleId || null;
    // Если поле не пришло вовсе / пришло пустым / нечисловым — НЕ обнуляем
    // "Мероприятий за неделю" молча (COALESCE ниже оставит текущее значение
    // в базе как есть). Раньше parseInt(...) || 0 тихо сбрасывал счётчик в 0
    // при любой некорректной строке — в частности, если форму редактирования
    // открывали со устаревшими данными (например, вкладка "Состав" была
    // открыта ещё до того, как бот начислил новые МП) и сохраняли без
    // изменений — см. также фикс на фронтенде: перед открытием формы
    // редактирования теперь подтягиваются свежие данные из /api/roster.
    const rawWeeklyEvents = parseInt(req.body.weeklyEvents, 10);
    const weeklyEvents = Number.isFinite(rawWeeklyEvents) && rawWeeklyEvents >= 0 ? rawWeeklyEvents : null;
    const note = req.body.note || '';
    // Если роль назначают вручную (в том числе кандидату), он перестаёт
    // считаться кандидатом — иначе он бы завис одновременно и "с ролью", и
    // во вкладке "Кандидаты".
    await pool.query(
      `UPDATE users SET nickname = $1, role_id = $2::integer,
              weekly_events = COALESCE($3::integer, weekly_events), note = $4,
              status = CASE WHEN $2::integer IS NOT NULL THEN 'member' ELSE status END
       WHERE id = $5`,
      [nickname, roleId, weeklyEvents, note, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/avatar', requireRoleIn(EDIT_ROLES), upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не получен.' });

    if (cloudinary.isConfigured()) {
      const { url, publicId } = await cloudinary.uploadAvatar(req.file.buffer);
      const { rows } = await pool.query(
        'SELECT avatar_public_id FROM users WHERE id = $1',
        [req.params.id]
      );
      const oldPublicId = rows[0]?.avatar_public_id;
      await pool.query(
        'UPDATE users SET avatar_url = $1, avatar_public_id = $2, avatar_image_id = NULL WHERE id = $3',
        [url, publicId, req.params.id]
      );
      if (oldPublicId) cloudinary.deleteAvatar(oldPublicId);
      res.json({ ok: true, avatarUrl: url });
    } else {
      const imageId = await saveImage(req.file);
      await pool.query('UPDATE users SET avatar_image_id = $1 WHERE id = $2', [imageId, req.params.id]);
      res.json({ ok: true, imageId });
    }
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireRoleIn(EDIT_ROLES), async (req, res, next) => {
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
