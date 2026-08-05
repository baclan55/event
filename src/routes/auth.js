const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');

const router = express.Router();

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

router.get('/me', (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.post('/register', async (req, res, next) => {
  try {
    const { login, password, nickname } = req.body || {};
    if (!login || !password || !nickname) {
      return res.status(400).json({ error: 'Заполните логин, пароль и никнейм.' });
    }
    if (String(password).length < 4) {
      return res.status(400).json({ error: 'Пароль должен быть не короче 4 символов.' });
    }
    const existing = await pool.query('SELECT id FROM users WHERE login = $1', [login]);
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Такой логин уже занят.' });
    }
    const hash = await bcrypt.hash(password, 10);
    // Новый пользователь регистрируется без роли — роль назначает
    // администратор вручную во вкладке "Без ролей" на странице "Состав".
    const { rows } = await pool.query(
      `INSERT INTO users (login, password_hash, nickname, role_id)
       VALUES ($1, $2, $3, NULL) RETURNING id`,
      [login, hash, nickname]
    );
    req.session.userId = rows[0].id;
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { login, password } = req.body || {};
    if (!login || !password) {
      return res.status(400).json({ error: 'Введите логин и пароль.' });
    }
    const { rows } = await pool.query('SELECT * FROM users WHERE login = $1', [login]);
    const user = rows[0];
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Неверный логин или пароль.' });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Неверный логин или пароль.' });
    }
    req.session.userId = user.id;
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// Вход через Discord OAuth2.
// Требует DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET / DISCORD_REDIRECT_URI в .env.
// Redirect URI нужно также добавить в настройках приложения на
// https://discord.com/developers/applications -> ваше приложение -> OAuth2.
// ---------------------------------------------------------------------------
router.get('/discord', (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return res.status(400).send(
      'Вход через Discord не настроен. Задайте DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET ' +
      'и DISCORD_REDIRECT_URI в файле .env (см. .env.example и README.md).'
    );
  }
  const url = new URL('https://discord.com/api/oauth2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify');
  res.redirect(url.toString());
});

router.get('/discord/callback', async (req, res, next) => {
  try {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const redirectUri = process.env.DISCORD_REDIRECT_URI;
    const { code } = req.query;
    if (!clientId || !clientSecret || !redirectUri) {
      return res.status(400).send('Вход через Discord не настроен на сервере.');
    }
    if (!code) {
      return res.status(400).send('Discord не передал код авторизации.');
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
      const text = await tokenRes.text();
      console.error('[discord] token exchange failed:', text);
      return res.status(400).send('Не удалось подтвердить вход через Discord.');
    }
    const tokenData = await tokenRes.json();

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userRes.ok) {
      return res.status(400).send('Не удалось получить данные пользователя Discord.');
    }
    const discordUser = await userRes.json();

    const existing = await pool.query('SELECT id FROM users WHERE discord_id = $1', [discordUser.id]);
    let userId;
    if (existing.rows.length) {
      userId = existing.rows[0].id;
      await pool.query(
        'UPDATE users SET discord_username = $1 WHERE id = $2',
        [discordUser.username, userId]
      );
    } else {
      // Новый пользователь через Discord тоже стартует без роли.
      const { rows } = await pool.query(
        `INSERT INTO users (discord_id, discord_username, nickname, role_id)
         VALUES ($1, $2, $3, NULL) RETURNING id`,
        [discordUser.id, discordUser.username, discordUser.username]
      );
      userId = rows[0].id;
    }
    req.session.userId = userId;
    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
