const pool = require('../db/pool');
const { userHasAnyRole, userHasRoleIn } = require('../utils/roleAccess');
const { syncBlockStatus } = require('../utils/reprimandRules');

const BLOCKED_MESSAGE =
  'Учётная запись заблокирована за превышение лимита выговоров. Обратитесь к руководству отдела для разблокировки.';

// Не чаще раза в N мс на пользователя — иначе каждый API-хит тянет лишние SQL.
const BLOCK_SYNC_TTL_MS = 60_000;
const blockSyncAt = new Map();

// Короткий кэш req.user: при переключении разделов не бить БД на каждый /api/*.
const USER_CACHE_TTL_MS = Number.parseInt(process.env.USER_CACHE_TTL_MS || '30000', 10);
const userCache = new Map();

function cloneCachedUser(user) {
  if (!user) return null;
  const roles = Array.isArray(user.roles) ? user.roles.map((r) => ({ ...r })) : [];
  return {
    ...user,
    roles,
    roleNames: roles.map((r) => r.name),
  };
}

function invalidateUserCache(userId) {
  if (userId == null) {
    userCache.clear();
    return;
  }
  userCache.delete(String(userId));
}

// Подгружает текущего пользователя (если есть активная сессия) в req.user.
async function attachUser(req, res, next) {
  try {
    if (!req.session || !req.session.userId) {
      req.user = null;
      return next();
    }

    const uid = String(req.session.userId);
    const cached = userCache.get(uid);
    if (cached && Date.now() - cached.at < USER_CACHE_TTL_MS) {
      req.user = cloneCachedUser(cached.user);
      return next();
    }

    // Один round-trip: пользователь + набор ролей (json_agg).
    const { rows } = await pool.query(
      `SELECT u.id, u.nickname, u.discord_id, u.discord_username,
              u.avatar_image_id, u.avatar_url, u.avatar_public_id,
              u.is_owner, u.is_admin, u.weekly_events, u.note,
              u.is_blocked, u.blocked_at,
              u.role_id, r.name AS role_name, r.priority AS role_priority,
              COALESCE(
                (SELECT json_agg(json_build_object('id', rr.id, 'name', rr.name, 'priority', rr.priority)
                                 ORDER BY rr.priority ASC)
                 FROM user_roles ur
                 JOIN roles rr ON rr.id = ur.role_id
                 WHERE ur.user_id = u.id),
                '[]'::json
              ) AS roles
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1`,
      [req.session.userId]
    );
    req.user = rows[0] || null;

    if (req.user) {
      const roles = Array.isArray(req.user.roles) ? req.user.roles : [];
      req.user.roles = roles;
      req.user.roleNames = roles.map((r) => r.name);
    }

    if (req.user && req.user.is_blocked) {
      const last = blockSyncAt.get(req.user.id) || 0;
      if (Date.now() - last >= BLOCK_SYNC_TTL_MS) {
        blockSyncAt.set(req.user.id, Date.now());
        const status = await syncBlockStatus(req.user.id);
        if (status) {
          req.user.is_blocked = status.blocked;
          if (!status.blocked) req.user.blocked_at = null;
        }
      }
    }

    if (req.user) {
      userCache.set(uid, { at: Date.now(), user: cloneCachedUser(req.user) });
    } else {
      userCache.delete(uid);
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

function requireAnyRole(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Требуется вход в личный кабинет.' });
  if (req.user.is_blocked) return res.status(403).json({ error: BLOCKED_MESSAGE, blocked: true });
  if (!userHasAnyRole(req.user)) {
    return res.status(403).json({ error: 'Личный кабинет станет доступен после того, как вам назначат роль.' });
  }
  next();
}

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

module.exports = {
  attachUser,
  requireAuth,
  requireAdmin,
  requireOwner,
  requireAnyRole,
  requireRoleIn,
  invalidateUserCache,
};
