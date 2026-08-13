import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { pool, query } from '@/lib/db';
import {
  getCurrentUser,
  publicUser,
  invalidateUserCache,
  jsonError,
  loadUserById,
} from '@/lib/auth';
import { getSession } from '@/lib/session';
import { runtimeEnv } from '@/lib/runtimeEnv';
import { renderMarkdown } from '@/lib/richText';
import { ok, parseId, plain, required, requiredPerm } from './helpers';
import type { ApiHandler } from './types';

function redirectUri() {
  const domain = runtimeEnv('APP_DOMAIN').toLowerCase();
  const fromEnv = runtimeEnv('DISCORD_REDIRECT_URI');
  if (domain) return `https://${domain}/api/auth/discord/callback`;
  return runtimeEnv('NODE_ENV') === 'production' && fromEnv.startsWith('http://')
    ? `https://${fromEnv.slice(7)}`
    : fromEnv || null;
}

function discordAvatar(discordUser: { id: string; avatar?: string | null }): string {
  if (discordUser.avatar) {
    return `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.webp?size=128`;
  }
  const index = Number((BigInt(discordUser.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

async function login(
  discordUser: { id: string; username: string; avatar?: string | null },
  session: Awaited<ReturnType<typeof getSession>>,
) {
  const ownerId = runtimeEnv('DISCORD_OWNER_ID');
  const owner = !!ownerId && String(discordUser.id) === String(ownerId);
  const avatarUrl = discordAvatar(discordUser);
  const existing = await query<{ id: number }>('SELECT id FROM users WHERE discord_id=$1', [discordUser.id]);
  let userId: number;
  if (existing.rows[0]) {
    userId = existing.rows[0].id;
    await query(`UPDATE users SET discord_username=$1, avatar_url=$2,
      avatar_image_id=NULL, avatar_public_id=NULL WHERE id=$3`, [discordUser.username, avatarUrl, userId]);
  } else {
    const count = await query<{ c: number }>('SELECT COUNT(*)::int AS c FROM users');
    const grant = owner || count.rows[0].c === 0;
    const role = grant ? await query<{ id: number }>('SELECT id FROM roles ORDER BY priority LIMIT 1') : { rows: [] };
    const inserted = await query<{ id: number }>(
      'INSERT INTO users(discord_id,discord_username,nickname,role_id,is_owner,is_admin,avatar_url) VALUES($1,$2,$2,$3,$4,$4,$5) RETURNING id',
      [discordUser.id, discordUser.username, role.rows[0]?.id ?? null, grant, avatarUrl],
    );
    userId = inserted.rows[0].id;
  }
  if (owner) await query('UPDATE users SET is_owner=TRUE,is_admin=TRUE WHERE id=$1', [userId]);
  invalidateUserCache(userId);
  session.userId = userId;
  const returnTo = session.discordOAuthReturnTo;
  delete session.discordOAuthReturnTo;
  return returnTo === 'apply' ? '/apply' : '/app/faq';
}

export const handleSystem: ApiHandler = async ({ key, request, params, method, body }) => {
  if (key === 'config') {
    return NextResponse.json({
      appTitle: runtimeEnv('APP_TITLE') || 'Events Denver',
      appSubtitle: runtimeEnv('APP_SUBTITLE') || 'Ивент-отдел сервера',
      weeklyEventsTarget: Number.parseInt(runtimeEnv('WEEKLY_EVENTS_TARGET') || '', 10) || 5,
      discordEnabled: !!(runtimeEnv('DISCORD_CLIENT_ID') && runtimeEnv('DISCORD_CLIENT_SECRET')),
    });
  }
  if (key === 'live') return NextResponse.json({ ok: true });
  if (key === 'health') {
    try {
      await pool.query('SELECT 1');
      return ok();
    } catch {
      return NextResponse.json({ ok: false, error: 'База данных недоступна.' }, { status: 503 });
    }
  }
  if (key === 'me') return NextResponse.json({ user: publicUser(await getCurrentUser()) });
  if (key === 'logout') {
    const session = await getSession();
    const userId = session.userId;
    await session.destroy();
    if (userId) invalidateUserCache(userId);
    if (method === 'GET') {
      const domain = runtimeEnv('APP_DOMAIN');
      return NextResponse.redirect(domain ? `https://${domain}/` : new URL('/', request.url));
    }
    return ok();
  }
  if (key === 'oauth') {
    const client = runtimeEnv('DISCORD_CLIENT_ID');
    const uri = redirectUri();
    if (!client || !uri) return plain('Вход через Discord не настроен.', 400);
    if (request.nextUrl.searchParams.get('consent') !== '1') {
      return plain('Необходимо подтвердить согласие на обработку персональных данных.', 400);
    }
    const session = await getSession();
    const state = crypto.randomBytes(24).toString('hex');
    session.discordOAuthState = state;
    session.discordOAuthReturnTo = request.nextUrl.searchParams.get('returnTo') === 'apply' ? 'apply' : null;
    await session.save();
    const url = new URL('https://discord.com/api/oauth2/authorize');
    url.search = new URLSearchParams({
      client_id: client,
      redirect_uri: uri,
      response_type: 'code',
      scope: 'identify',
      state,
    }).toString();
    return NextResponse.redirect(url);
  }
  if (key === 'callback') {
    const uri = redirectUri();
    const code = request.nextUrl.searchParams.get('code');
    const state = request.nextUrl.searchParams.get('state');
    const session = await getSession();
    const expected = session.discordOAuthState;
    delete session.discordOAuthState;
    if (!uri || !code) return plain('Discord не передал код авторизации.', 400);
    if (!expected || state !== expected) return plain('Недействительный запрос авторизации (state не совпадает).', 400);
    const relay = runtimeEnv('DISCORD_RELAY_URL').replace(/\/$/, '');
    const secret = runtimeEnv('DISCORD_RELAY_SECRET');
    let discordUser: { id: string; username: string; avatar?: string | null };
    if (relay) {
      if (!secret) return plain('DISCORD_RELAY_URL задан, но нет DISCORD_RELAY_SECRET.', 500);
      const response = await fetch(`${relay}/oauth/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Relay-Secret': secret },
        body: JSON.stringify({ code, redirect_uri: uri }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.discordUser?.id) {
        return plain(`Не удалось подтвердить вход через Discord (relay): ${data.error || response.status}`, 400);
      }
      discordUser = data.discordUser;
    } else {
      const clientId = runtimeEnv('DISCORD_CLIENT_ID');
      const clientSecret = runtimeEnv('DISCORD_CLIENT_SECRET');
      if (!clientId || !clientSecret) return plain('Вход через Discord не настроен на сервере.', 400);
      const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: uri,
        }),
      });
      if (!tokenResponse.ok) return plain('Не удалось подтвердить вход через Discord.', 400);
      const token = await tokenResponse.json();
      const userResponse = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      if (!userResponse.ok) return plain('Не удалось получить данные пользователя Discord.', 400);
      discordUser = await userResponse.json();
    }
    const path = await login(discordUser, session);
    await session.save();
    const domain = runtimeEnv('APP_DOMAIN');
    return NextResponse.redirect(domain ? `https://${domain}${path}` : new URL(path, request.url));
  }
  if (key === 'nickname') {
    return jsonError('Ник на сайте задаётся полем «Имя» в игровых данных.', 410);
  }
  if (key === 'my-avatar' || key === 'roster-avatar') {
    return jsonError('Аватар автоматически синхронизируется с Discord.', 410);
  }
  if (key === 'media') {
    const result = await query<{ mime_type: string; data: Buffer }>('SELECT mime_type,data FROM images WHERE id=$1', [
      parseId(params.id),
    ]);
    return result.rows[0]
      ? new NextResponse(new Uint8Array(result.rows[0].data), {
          headers: {
            'Content-Type': result.rows[0].mime_type,
            'Cache-Control': 'public, max-age=31536000, immutable',
            'X-Content-Type-Options': 'nosniff',
          },
        })
      : new NextResponse(null, { status: 404 });
  }
  if (key === 'markdown') {
    const user = await requiredPerm('edit_content', { level: 'view' });
    if (user instanceof NextResponse) return user;
    return NextResponse.json({ html: renderMarkdown(String(body.body || '')) });
  }
  return undefined;
};
