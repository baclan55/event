// Cloudflare Worker: Discord OAuth + REST-прокси для бота.
// Сайт/бот на VDS не ходят на discord.com напрямую.
//
// Поддомен: discord-relay.event.mjdn.ru
// Секреты в Cloudflare: DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_RELAY_SECRET
//
// Маршруты:
//   GET  /health
//   POST /oauth/complete          — вход на сайт
//   *    /api/*  → discord.com/api/*  — бот (нужен Authorization: Bot …)

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true });
    }

    const secret = (request.headers.get('x-relay-secret') || '').trim();
    const expected = String(env.DISCORD_RELAY_SECRET || '').trim();
    if (!expected) {
      return json({
        error: 'Forbidden',
        reason: 'worker_secret_missing',
        hint: 'В Worker → Settings → Variables добавьте Secret с именем DISCORD_RELAY_SECRET и Deploy',
      }, 403);
    }
    if (secret !== expected) {
      return json({
        error: 'Forbidden',
        reason: 'secret_mismatch',
        gotLen: secret.length,
        expectedLen: expected.length,
        hint: 'Длины должны совпадать. В Portainer без кавычек и пробелов; Recreate контейнера после смены env',
      }, 403);
    }

    if (request.method === 'POST' && url.pathname === '/oauth/complete') {
      return handleOAuthComplete(request, env);
    }

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return proxyDiscordApi(request, url);
    }

    return json({ error: 'Not Found' }, 404);
  },
};

async function proxyDiscordApi(request, url) {
  const target = 'https://discord.com' + url.pathname + url.search;
  const headers = new Headers();
  const auth = request.headers.get('Authorization');
  if (auth) headers.set('Authorization', auth);
  const ct = request.headers.get('Content-Type');
  if (ct) headers.set('Content-Type', ct);
  headers.set('User-Agent', 'DiscordBot (event-denver-relay, 1.0)');

  const init = {
    method: request.method,
    headers,
    redirect: 'manual',
  };
  if (!['GET', 'HEAD'].includes(request.method)) {
    init.body = await request.arrayBuffer();
  }

  const upstream = await fetch(target, init);
  const outHeaders = new Headers(upstream.headers);
  outHeaders.set('Access-Control-Allow-Origin', '*');
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}

async function handleOAuthComplete(request, env) {
  try {
    const body = await request.json();
    const code = body && body.code;
    const redirectUri = body && body.redirect_uri;
    if (!code || !redirectUri) {
      return json({ error: 'code и redirect_uri обязательны' }, 400);
    }
    if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
      return json({ error: 'Discord secrets не заданы на Worker' }, 500);
    }

    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: String(redirectUri),
      }),
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      console.error('[relay] token exchange failed:', text);
      return json({ error: 'token_exchange_failed', detail: text.slice(0, 300) }, 400);
    }
    const tokenData = await tokenRes.json();

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userRes.ok) {
      return json({ error: 'user_fetch_failed' }, 400);
    }
    const discordUser = await userRes.json();

    return json({
      discordUser: {
        id: discordUser.id,
        username: discordUser.username,
        global_name: discordUser.global_name,
        avatar: discordUser.avatar,
      },
    });
  } catch (err) {
    console.error('[relay]', err.message);
    return json({ error: 'relay_error', detail: err.message }, 502);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Relay-Secret, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  };
}
