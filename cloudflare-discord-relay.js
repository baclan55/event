// Cloudflare Worker: только OAuth Discord (token + @me).
// Сайт на VDS не достаёт discord.com — колбэк ходит сюда.
//
// Секреты (wrangler secret put):
//   DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_RELAY_SECRET
//
// На VDS:
//   DISCORD_RELAY_URL=https://<имя>.<subdomain>.workers.dev
//   DISCORD_RELAY_SECRET=<тот же секрет>
//
// Деплой: скопируйте файл в отдельный worker или:
//   npx wrangler deploy cloudflare-discord-relay.js --name event-denver-discord-relay
// (нужен wrangler.toml с main — см. комментарий внизу README-эквивалент в шапке)

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true });
    }

    const secret = request.headers.get('x-relay-secret') || '';
    if (!env.DISCORD_RELAY_SECRET || secret !== env.DISCORD_RELAY_SECRET) {
      return json({ error: 'Forbidden' }, 403);
    }

    if (request.method === 'POST' && url.pathname === '/oauth/complete') {
      return handleOAuthComplete(request, env);
    }

    return json({ error: 'Not Found' }, 404);
  },
};

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
    'Access-Control-Allow-Headers': 'Content-Type, X-Relay-Secret',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}
