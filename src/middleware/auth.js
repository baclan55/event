const pool = require('../db/pool');
const { userHasAnyRole, userHasRoleIn } = require('../utils/roleAccess');

// Подгружает текущего пользователя (если есть активная сессия) в req.user.
// Вызывается на каждый запрос — до роутов.
async function attachUser(req, res, next) {
  try {
    if (!req.session || !req.session.userId) {
      req.user = null;
      return next();
    }
    const { rows } = await pool.query(
      `SELECT u.id, u.nickname, u.discord_id, u.discord_username,
              u.avatar_image_id, u.avatar_url, u.avatar_public_id,
              u.is_owner, u.is_admin, u.weekly_events, u.note,
              u.role_id, r.name AS role_name, r.priority AS role_priority
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1`,
      [req.session.userId]
    );
    req.user = rows[0] || null;
    next();
  } catch (err) {
    next(err);
  }
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Требуется вход в личный кабинет.' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !(req.user.is_admin || req.user.is_owner)) {
    return res.status(403).json({ error: 'Недостаточно прав. Требуется роль администратора.' });
  }
  next();
}

function requireOwner(req, res, next) {
  if (!req.user || !req.user.is_owner) {
    return res.status(403).json({ error: 'Недостаточно прав. Требуется роль владельца.' });
  }
  next();
}

// Личный кабинет целиком закрыт для сотрудников без роли (см.
// src/utils/roleAccess.js) — им доступ откроется, как только администратор
// назначит роль в «Составе».
function requireAnyRole(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Требуется вход в личный кабинет.' });
  if (!userHasAnyRole(req.user)) {
    return res.status(403).json({ error: 'Личный кабинет станет доступен после того, как вам назначат роль.' });
  }
  next();
}

// Раздел доступен только сотрудникам с одной из перечисленных ролей (плюс
// владельцу — см. userHasRoleIn). Используется для узких разделов вроде
// выговоров, заявок и панели владельца.
function requireRoleIn(roles) {
  return function (req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Требуется вход в личный кабинет.' });
    if (!userHasRoleIn(req.user, roles)) {
      return res.status(403).json({ error: 'Недостаточно прав для доступа к этому разделу.' });
    }
    next();
  };
}

module.exports = { attachUser, requireAuth, requireAdmin, requireOwner, requireAnyRole, requireRoleIn };
