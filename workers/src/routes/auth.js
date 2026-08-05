import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { signSession, buildSetCookie } from '../session.js';
import { SESSION_COOKIE } from '../middleware/auth.js';

const router = new Hono();

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    login: u.login,
    nickname: u.nickname,
    discordUsername: u.discord_username,
    avatarImageId: u.avatar_image_id,
    isOwner: u.is_owner,
    isAdmin: u.is_admin,
    weeklyEvents: u.weekly_events,
    roleId: u.role_id,
    roleName: u.role_name,
  };
}

function isHttps(c) {
  return new URL(c.req.url).protocol === 'https:';
}

async function setSessionCookie(c, userId) {
  const token = await signSession(userId, c.env.SESSION_SECRET || 'dev-secret-change-me');
  c.header('Set-Cookie', buildSetCookie(SESSION_COOKIE, token, {
    maxAge: 30 * 24 * 60 * 60, // 30 дней, как в Express-версии
    secure: isHttps(c),
  }));
}

router.get('/me', (c) => c.json({ user: publicUser(c.get('user')) }));

router.post('/register', async (c) => {
  const db = c.get('db');
  const body = await c.req.json().catch(() => ({}));
  const { login, password, nickname } = body || {};
  if (!login || !password || !nickname) {
    return c.json({ error: 'Заполните логин, пароль и никнейм.' }, 400);
  }
  if (String(password).length < 4) {
    return c.json({ error: 'Пароль должен быть не короче 4 символов.' }, 400);
  }
  const existing = await db.query('SELECT id FROM users WHERE login = $1', [login]);
  if (existing.rows.length) {
    return c.json({ error: 'Такой логин уже занят.' }, 409);
  }
  const hash = await bcrypt.hash(password, 10);
  // Новый пользователь регистрируется без роли — роль назначает
  // администратор вручную во вкладке "Без ролей" на странице "Состав".
  const { rows } = await db.query(
    `INSERT INTO users (login, password_hash, nickname, role_id)
     VALUES ($1, $2, $3, NULL) RETURNING id`,
    [login, hash, nickname]
  );
  await setSessionCookie(c, rows[0].id);
  return c.json({ ok: true });
});

router.post('/login', async (c) => {
  const db = c.get('db');
  const body = await c.req.json().catch(() => ({}));
  const { login, password } = body || {};
  if (!login || !password) {
    return c.json({ error: 'Введите логин и пароль.' }, 400);
  }
  const { rows } = await db.query('SELECT * FROM users WHERE login = $1', [login]);
  const user = rows[0];
  if (!user || !user.password_hash) {
    return c.json({ error: 'Неверный логин или пароль.' }, 401);
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return c.json({ error: 'Неверный логин или пароль.' }, 401);
  }
  await setSessionCookie(c, user.id);
  return c.json({ ok: true });
});

router.post('/logout', (c) => {
  c.header('Set-Cookie', buildSetCookie(SESSION_COOKIE, '', { maxAge: 0, secure: isHttps(c) }));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Вход через Discord OAuth2.
// Требует DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET / DISCORD_REDIRECT_URI —
// задаются как секреты Worker'а (см. workers/README.md).
// ---------------------------------------------------------------------------
router.get('/discord', (c) => {
  const clientId = c.env.DISCORD_CLIENT_ID;
  const redirectUri = c.env.DISCORD_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return c.text(
      'Вход через Discord не настроен. Задайте DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET ' +
      'и DISCORD_REDIRECT_URI как секреты Worker (см. workers/README.md).',
      400
    );
  }
  const url = new URL('https://discord.com/api/oauth2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify');
  return c.redirect(url.toString());
});

router.get('/discord/callback', async (c) => {
  const db = c.get('db');
  const clientId = c.env.DISCORD_CLIENT_ID;
  const clientSecret = c.env.DISCORD_CLIENT_SECRET;
  const redirectUri = c.env.DISCORD_REDIRECT_URI;
  const code = c.req.query('code');

  if (!clientId || !clientSecret || !redirectUri) {
    return c.text('Вход через Discord не настроен на сервере.', 400);
  }
  if (!code) {
    return c.text('Discord не передал код авторизации.', 400);
  }

  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code: String(code),
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) {
    console.error('[discord] token exchange failed:', await tokenRes.text());
    return c.text('Не удалось подтвердить вход через Discord.', 400);
  }
  const tokenData = await tokenRes.json();

  const userRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  if (!userRes.ok) {
    return c.text('Не удалось получить данные пользователя Discord.', 400);
  }
  const discordUser = await userRes.json();

  const existing = await db.query('SELECT id FROM users WHERE discord_id = $1', [discordUser.id]);
  let userId;
  if (existing.rows.length) {
    userId = existing.rows[0].id;
    await db.query('UPDATE users SET discord_username = $1 WHERE id = $2', [discordUser.username, userId]);
  } else {
    // Новый пользователь через Discord тоже стартует без роли.
    const { rows } = await db.query(
      `INSERT INTO users (discord_id, discord_username, nickname, role_id)
       VALUES ($1, $2, $3, NULL) RETURNING id`,
      [discordUser.id, discordUser.username, discordUser.username]
    );
    userId = rows[0].id;
  }
  await setSessionCookie(c, userId);
  return c.redirect('/');
});

export default router;
