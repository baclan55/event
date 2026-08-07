const pool = require('../db/pool');

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
              u.avatar_image_id, u.is_owner, u.is_admin, u.weekly_events, u.note,
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

// Раздел доступен только сотрудникам с назначенной ролью — сотрудники
// "без роли" (кандидаты, только что вошедшие через Discord и ещё не
// назначенные) не видят в личном кабинете вообще ничего.
function requireAnyRole(req, res, next) {
  if (!req.user || !req.user.role_id) {
    return res.status(403).json({ error: 'Раздел доступен только сотрудникам с назначенной ролью.' });
  }
  next();
}

// Раздел доступен только сотрудникам с одной из перечисленных ролей
// (см. src/utils/access.js) — используется для разделов, доступ к которым
// настроен по конкретным должностям, а не флагам is_admin/is_owner.
function requireRole(allowedRoleNames) {
  return function (req, res, next) {
    if (!req.user || !req.user.role_name || !allowedRoleNames.includes(req.user.role_name)) {
      return res.status(403).json({ error: 'Недостаточно прав для этого раздела.' });
    }
    next();
  };
}

module.exports = { attachUser, requireAuth, requireAdmin, requireOwner, requireAnyRole, requireRole };
