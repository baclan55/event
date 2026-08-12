import { createHash } from 'crypto';
import { getIronSession, type SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';

export type SessionData = {
  userId?: number;
  discordOAuthState?: string;
  discordOAuthReturnTo?: string | null;
};

/**
 * iron-session требует password ≥ 32 символов.
 * Берём ваш SESSION_SECRET из Portainer как есть;
 * если короче 32 — стабильно растягиваем через SHA-256 (не padEnd нулями).
 */
export function resolveSessionPassword(secret = process.env.SESSION_SECRET): string {
  const raw = (secret || '').trim();
  if (!raw) {
    const building =
      process.env.NEXT_PHASE === 'phase-production-build' ||
      process.env.npm_lifecycle_event === 'build';
    if (process.env.NODE_ENV === 'production' && !building) {
      throw new Error('[session] SESSION_SECRET не задан — обязателен в production.');
    }
    return 'dev-secret-change-me-min-32-chars!!';
  }
  if (raw.length >= 32) return raw;
  return createHash('sha256').update(`event-portal:${raw}`).digest('hex');
}

export const sessionOptions: SessionOptions = {
  password: resolveSessionPassword(),
  cookieName: 'event_portal_session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    // lax: cookie уходит при возврате с Discord (top-level GET на callback).
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60,
    path: '/',
  },
};

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}
