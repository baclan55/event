const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
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

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// Вход в личный кабинет — только через Discord OAuth2. Требует
// DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET / DISCORD_REDIRECT_URI в .env.
// Redirect URI нужно также добавить в настройках приложения на
// https://discord.com/developers/applications -> ваше приложение -> OAuth2.
//
// DISCORD_OWNER_ID (необязательно) — Discord ID аккаунта, который должен
// автоматически получать права владельца при входе (см. README.md).
// Если в базе вообще ещё нет ни одного пользователя, первый, кто войдёт
// через Discord, тоже становится владельцем — чтобы новый портал не
// оставался без администратора.
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
  // Согласие на обработку персональных данных обязательно (чекбокс в окне
  // входа на фронтенде) — проверяем и на сервере, чтобы его нельзя было
  // обойти прямым переходом по этой ссылке.
  if (req.query.consent !== '1') {
    return res.status(400).send(
      'Необходимо подтвердить согласие на обработку персональных данных, отметив чекбокс в окне входа.'
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

    const isDesignatedOwner =
      !!process.env.DISCORD_OWNER_ID && String(discordUser.id) === String(process.env.DISCORD_OWNER_ID);

    const existing = await pool.query('SELECT id FROM users WHERE discord_id = $1', [discordUser.id]);
    let userId;
    if (existing.rows.length) {
      userId = existing.rows[0].id;
      await pool.query(
        'UPDATE users SET discord_username = $1 WHERE id = $2',
        [discordUser.username, userId]
      );
    } else {
      const { rows: countRows } = await pool.query('SELECT COUNT(*)::int AS c FROM users');
      const isFirstEverUser = countRows[0].c === 0;
      const grantOwner = isDesignatedOwner || isFirstEverUser;

      // Новый рядовой пользователь роль не получает — остаётся "Без роли"
      // (роль ему назначает администратор вручную на странице «Состав»).
      // Владельцу (назначенному по DISCORD_OWNER_ID или первому вошедшему)
      // по-прежнему выдаём высшую роль в иерархии.
      let roleId = null;
      if (grantOwner) {
        const { rows: roleRows } = await pool.query('SELECT id FROM roles ORDER BY priority ASC LIMIT 1');
        roleId = roleRows[0]?.id || null;
      }

      const { rows } = await pool.query(
        `INSERT INTO users (discord_id, discord_username, nickname, role_id, is_owner, is_admin)
         VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
        [discordUser.id, discordUser.username, discordUser.username, roleId, grantOwner]
      );
      userId = rows[0].id;
    }

    // Всегда синхронизируем права для явно назначенного владельца — так он
    // не потеряет доступ, даже если его аккаунт уже существовал без прав.
    if (isDesignatedOwner) {
      await pool.query('UPDATE users SET is_owner = TRUE, is_admin = TRUE WHERE id = $1', [userId]);
    }

    req.session.userId = userId;
    res.redirect('/#/faq');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
