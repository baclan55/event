import { parseCookie, verifySession } from '../session.js';

export const SESSION_COOKIE = 'session';

// Читает cookie сессии, проверяет подпись и подгружает актуального
// пользователя из базы (роль/права могут быть изменены владельцем
// после выдачи cookie, поэтому доверяем cookie только для userId,
// а не для самих прав).
export async function attachUser(c, next) {
  const cookieHeader = c.req.header('Cookie');
  const token = parseCookie(cookieHeader, SESSION_COOKIE);
  const secret = c.env.SESSION_SECRET || 'dev-secret-change-me';
  const userId = token ? await verifySession(token, secret) : null;

  if (!userId) {
    c.set('user', null);
    return next();
  }

  const db = c.get('db');
  const { rows } = await db.query(
    `SELECT u.id, u.login, u.nickname, u.discord_id, u.discord_username,
            u.avatar_image_id, u.is_owner, u.is_admin, u.weekly_events, u.note,
            u.role_id, r.name AS role_name, r.priority AS role_priority
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1`,
    [userId]
  );
  c.set('user', rows[0] || null);
  await next();
}

export async function requireAuth(c, next) {
  if (!c.get('user')) {
    return c.json({ error: 'Требуется вход в личный кабинет.' }, 401);
  }
  await next();
}

export async function requireAdmin(c, next) {
  const user = c.get('user');
  if (!user || !(user.is_admin || user.is_owner)) {
    return c.json({ error: 'Недостаточно прав. Требуется роль администратора.' }, 403);
  }
  await next();
}

export async function requireOwner(c, next) {
  const user = c.get('user');
  if (!user || !user.is_owner) {
    return c.json({ error: 'Недостаточно прав. Требуется роль владельца.' }, 403);
  }
  await next();
}
