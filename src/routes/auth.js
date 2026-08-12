const crypto = require('crypto');
const express = require('express');
const pool = require('../db/pool');
const upload = require('../middleware/upload');
const { saveImage } = require('../db/images');
const cloudinary = require('../utils/cloudinary');
const { requireAnyRole } = require('../middleware/auth');

const router = express.Router();

// Канонический Discord redirect URI: всегда https + APP_DOMAIN в проде.
// Иначе при DISCORD_REDIRECT_URI=http://... Discord возвращает колбэк без TLS,
// secure-cookie сессии не ставится, вход «ломается».
function getDiscordRedirectUri() {
  const domain = (process.env.APP_DOMAIN || '').trim().toLowerCase();
  if (domain) return `https://${domain}/api/auth/discord/callback`;

  const fromEnv = (process.env.DISCORD_REDIRECT_URI || '').trim();
  if (!fromEnv) return null;
  if (process.env.NODE_ENV === 'production' && fromEnv.startsWith('http://')) {
    return `https://${fromEnv.slice('http://'.length)}`;
  }
  return fromEnv;
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    nickname: u.nickname,
    discordUsername: u.discord_username,
    avatarImageId: u.avatar_image_id,
    avatarUrl: u.avatar_url,
    isOwner: u.is_owner,
    isAdmin: u.is_admin,
    weeklyEvents: u.weekly_events,
    roleId: u.role_id,
    roleName: u.role_name,
    rolePriority: u.role_priority != null ? u.role_priority : null,
    roles: (u.roles || []).map((r) => r.name),
    isBlocked: !!u.is_blocked,
    blockedAt: u.blocked_at || null,
  };
}

router.get('/me', (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// Самостоятельная смена ника — доступна любому сотруднику с ролью (та же
// граница, что и у остального личного кабинета, см. requireAnyRole). Меняет
// только свой собственный nickname, не роль/права/счётчики — для этого
// по-прежнему нужен доступ к «Составу» (EDIT_ROLES).
router.put('/me/nickname', requireAnyRole, async (req, res, next) => {
  try {
    const nickname = (req.body.nickname || '').trim();
    if (!nickname) return res.status(400).json({ error: 'Введите никнейм.' });
    if (nickname.length > 60) return res.status(400).json({ error: 'Никнейм слишком длинный (максимум 60 символов).' });

    const { rows } = await pool.query(
      `UPDATE users SET nickname = $1 WHERE id = $2
       RETURNING id, nickname, discord_username, avatar_image_id, avatar_url, is_owner, is_admin,
                 weekly_events, role_id`,
      [nickname, req.user.id]
    );
    const updated = rows[0];
    // role_name/role_priority/roles у UPDATE ... RETURNING не подтянутся
    // джойном, поэтому берём их из уже загруженного req.user (сам набор
    // ролей этим запросом не менялся).
    res.json({ user: publicUser({ ...updated, role_name: req.user.role_name, role_priority: req.user.role_priority, roles: req.user.roles }) });
  } catch (err) {
    next(err);
  }
});

// Самостоятельная смена своего аватара — доступна любому сотруднику с ролью
// (та же граница, что и у остального личного кабинета). Меняет только свой
// собственный avatar_image_id; загрузка аватара ДРУГОМУ пользователю
// по-прежнему делается через «Состав» и требует EDIT_ROLES (см. roster.js).
router.post('/me/avatar', requireAnyRole, upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не получен.' });

    let rows;
    if (cloudinary.isConfigured()) {
      const { url, publicId } = await cloudinary.uploadAvatar(req.file.buffer);
      const oldPublicId = req.user.avatar_public_id;
      ({ rows } = await pool.query(
        `UPDATE users SET avatar_url = $1, avatar_public_id = $2, avatar_image_id = NULL
         WHERE id = $3
         RETURNING id, nickname, discord_username, avatar_image_id, avatar_url, is_owner, is_admin,
                   weekly_events, role_id`,
        [url, publicId, req.user.id]
      ));
      if (oldPublicId) cloudinary.deleteAvatar(oldPublicId);
    } else {
      if (process.env.NODE_ENV === 'production') {
        console.warn('[auth] Cloudinary не настроен — аватар пишется в Postgres (BYTEA).');
      }
      const imageId = await saveImage(req.file);
      ({ rows } = await pool.query(
        `UPDATE users SET avatar_image_id = $1 WHERE id = $2
         RETURNING id, nickname, discord_username, avatar_image_id, avatar_url, is_owner, is_admin,
                   weekly_events, role_id`,
        [imageId, req.user.id]
      ));
    }
    const updated = rows[0];
    res.json({ user: publicUser({ ...updated, role_name: req.user.role_name, role_priority: req.user.role_priority, roles: req.user.roles }) });
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
  const redirectUri = getDiscordRedirectUri();
  if (!clientId || !redirectUri) {
    return res.status(400).send(
      'Вход через Discord не настроен. Задайте DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET ' +
      'и APP_DOMAIN (или DISCORD_REDIRECT_URI) в окружении.'
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
  // state защищает от CSRF-подделки колбэка: генерируем случайное значение,
  // кладём в сессию пользователя и сверяем при возврате из Discord
  // (см. /discord/callback) — колбэк с чужим/отсутствующим state отклоняется.
  const state = crypto.randomBytes(24).toString('hex');
  req.session.discordOAuthState = state;

  // Куда вернуть пользователя после успешной авторизации. Помимо обычного
  // входа в личный кабинет (по умолчанию -> #/faq), авторизация нужна ещё и
  // как предварительный шаг перед подачей заявки на Event Helper (см.
  // public/js/site.js -> Site.renderApply) — тогда возвращаем обратно на
  // #/apply, чтобы заявитель сразу продолжил заполнение формы. Значение
  // строго сверяется со списком разрешённых (белый список), чтобы этим
  // параметром нельзя было увести пользователя на произвольный внешний URL.
  req.session.discordOAuthReturnTo = req.query.returnTo === 'apply' ? 'apply' : null;

  const url = new URL('https://discord.com/api/oauth2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('state', state);

  req.session.save((err) => {
    if (err) {
      console.error('[discord] session.save failed:', err.message);
      return res.status(500).send('Не удалось создать сессию входа. Попробуйте ещё раз.');
    }
    res.redirect(url.toString());
  });
});

/**
 * Завершение Discord OAuth после обмена code → token → @me.
 * Раньше здесь были обходные эндпоинты для Cloudflare Worker
 * (/discord/oauth-config, /discord/complete) — больше не используются:
 * вход идёт напрямую через /discord → /discord/callback на APP_DOMAIN.
 */
async function finishDiscordLogin(req, discordUser) {
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

  if (isDesignatedOwner) {
    await pool.query('UPDATE users SET is_owner = TRUE, is_admin = TRUE WHERE id = $1', [userId]);
  }

  req.session.userId = userId;
  const returnTo = req.session.discordOAuthReturnTo;
  delete req.session.discordOAuthReturnTo;
  return returnTo === 'apply' ? '/#/apply' : '/#/faq';
}

router.get('/discord/callback', async (req, res, next) => {
  try {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const redirectUri = getDiscordRedirectUri();
    const relayUrl = (process.env.DISCORD_RELAY_URL || '').trim().replace(/\/$/, '');
    const relaySecret = (process.env.DISCORD_RELAY_SECRET || '').trim();
    const { code, state } = req.query;
    if (!redirectUri) {
      return res.status(400).send('Вход через Discord не настроен на сервере.');
    }
    // Прямой обмен с Discord нужен client_secret; через CF-relay секрет на Worker.
    if (!relayUrl && (!clientId || !clientSecret)) {
      return res.status(400).send('Вход через Discord не настроен на сервере.');
    }
    if (relayUrl && !relaySecret) {
      return res.status(500).send('DISCORD_RELAY_URL задан, но нет DISCORD_RELAY_SECRET.');
    }
    if (!code) {
      return res.status(400).send('Discord не передал код авторизации.');
    }

    const expectedState = req.session.discordOAuthState;
    delete req.session.discordOAuthState;
    if (!expectedState || !state || state !== expectedState) {
      return res.status(400).send('Недействительный запрос авторизации (state не совпадает). Попробуйте войти ещё раз.');
    }

    let discordUser;
    if (relayUrl) {
      // VDS → Cloudflare Worker → Discord (Worker в сети, где Discord доступен).
      let relayRes;
      try {
        relayRes = await fetch(`${relayUrl}/oauth/complete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Relay-Secret': relaySecret,
          },
          body: JSON.stringify({ code: String(code), redirect_uri: redirectUri }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err) {
        console.error('[discord] relay network error:', err.message);
        return res.status(502).send(
          'Не удалось связаться с Discord OAuth relay. Проверьте DISCORD_RELAY_URL.'
        );
      }
      const relayData = await relayRes.json().catch(() => ({}));
      if (!relayRes.ok || !relayData.discordUser || !relayData.discordUser.id) {
        console.error('[discord] relay failed:', relayRes.status, relayData);
        return res.status(400).send('Не удалось подтвердить вход через Discord (relay).');
      }
      discordUser = relayData.discordUser;
    } else {
      let tokenRes;
      try {
        tokenRes = await fetch('https://discord.com/api/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'authorization_code',
            code: String(code),
            redirect_uri: redirectUri,
          }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (err) {
        console.error('[discord] token exchange network error:', err.message);
        return res.status(502).send(
          'Сервер не может связаться с Discord API. Задайте DISCORD_RELAY_URL (Cloudflare relay) ' +
          'или DISCORD_PROXY, либо разместите app в сети с доступом к discord.com.'
        );
      }
      if (!tokenRes.ok) {
        const text = await tokenRes.text();
        console.error('[discord] token exchange failed:', text);
        return res.status(400).send('Не удалось подтвердить вход через Discord.');
      }
      const tokenData = await tokenRes.json();

      let userRes;
      try {
        userRes = await fetch('https://discord.com/api/users/@me', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
          signal: AbortSignal.timeout(10_000),
        });
      } catch (err) {
        console.error('[discord] users/@me network error:', err.message);
        return res.status(502).send(
          'Сервер не может связаться с Discord API. Задайте DISCORD_RELAY_URL или DISCORD_PROXY.'
        );
      }
      if (!userRes.ok) {
        return res.status(400).send('Не удалось получить данные пользователя Discord.');
      }
      discordUser = await userRes.json();
    }

    const redirectPath = await finishDiscordLogin(req, discordUser);
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });
    const domain = (process.env.APP_DOMAIN || '').trim().toLowerCase();
    if (domain) {
      return res.redirect(302, `https://${domain}${redirectPath}`);
    }
    res.redirect(redirectPath);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
