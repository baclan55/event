const pool = require('../db/pool');
const { userHasAnyRole, userHasRoleIn } = require('../utils/roleAccess');
const { syncBlockStatus } = require('../utils/reprimandRules');

const BLOCKED_MESSAGE =
  'Учётная запись заблокирована за превышение лимита выговоров. Обратитесь к руководству отдела для разблокировки.';

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
              u.is_blocked, u.blocked_at,
              u.role_id, r.name AS role_name, r.priority AS role_priority
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1`,
      [req.session.userId]
    );
    req.user = rows[0] || null;

    // Уже заблокированного пользователя лениво пере-проверяем при каждом
    // входе — актуально для баллов администраторов, которые сгорают через
    // ADMIN_POINT_DECAY_DAYS дней и могут снять блокировку автоматически
    // (см. src/utils/reprimandRules.js). Для не заблокированных лишний
    // запрос не делаем, чтобы не нагружать каждый вызов API.
    if (req.user && req.user.is_blocked) {
      const status = await syncBlockStatus(req.user.id);
      if (status) {
        req.user.is_blocked = status.blocked;
        if (!status.blocked) req.user.blocked_at = null;
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Требуется вход в личный кабинет.' });
  if (req.user.is_blocked) return res.status(403).json({ error: BLOCKED_MESSAGE, blocked: true });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !(req.user.is_admin || req.user.is_owner)) {
    return res.status(403).json({ error: 'Недостаточно прав. Требуется роль администратора.' });
  }
  if (req.user.is_blocked) return res.status(403).json({ error: BLOCKED_MESSAGE, blocked: true });
  next();
}

function requireOwner(req, res, next) {
  if (!req.user || !req.user.is_owner) {
    return res.status(403).json({ error: 'Недостаточно прав. Требуется роль владельца.' });
  }
  if (req.user.is_blocked) return res.status(403).json({ error: BLOCKED_MESSAGE, blocked: true });
  next();
}

// Личный кабинет целиком закрыт для сотрудников без роли (см.
// src/utils/roleAccess.js) — им доступ откроется, как только администратор
// назначит роль в «Составе». Заблокированным (см. users.is_blocked) кабинет
// тоже закрыт целиком — их аккаунт и история при этом никуда не деваются.
function requireAnyRole(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Требуется вход в личный кабинет.' });
  if (req.user.is_blocked) return res.status(403).json({ error: BLOCKED_MESSAGE, blocked: true });
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
    if (req.user.is_blocked) return res.status(403).json({ error: BLOCKED_MESSAGE, blocked: true });
    if (!userHasRoleIn(req.user, roles)) {
      return res.status(403).json({ error: 'Недостаточно прав для доступа к этому разделу.' });
    }
    next();
  };
}

module.exports = { attachUser, requireAuth, requireAdmin, requireOwner, requireAnyRole, requireRoleIn };
