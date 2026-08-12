import { createHash } from 'crypto';
import { getIronSession, type SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';
import { runtimeEnv } from '@/lib/runtimeEnv';

export type SessionData = {
  userId?: number;
  discordOAuthState?: string;
  discordOAuthReturnTo?: string | null;
};

/**
 * iron-session требует password ≥ 32 символов.
 * Берём SESSION_SECRET из runtime (не build-placeholder).
 */
export function resolveSessionPassword(secret = runtimeEnv('SESSION_SECRET')): string {
  const raw = (secret || '').trim();
  if (!raw) {
    const building =
      runtimeEnv('NEXT_PHASE') === 'phase-production-build' ||
      runtimeEnv('npm_lifecycle_event') === 'build';
    if (runtimeEnv('NODE_ENV') === 'production' && !building) {
      throw new Error('[session] SESSION_SECRET не задан — обязателен в production.');
    }
    return 'dev-secret-change-me-min-32-chars!!';
  }
  if (raw.length >= 32) return raw;
  return createHash('sha256').update(`event-portal:${raw}`).digest('hex');
}

export function getSessionOptions(): SessionOptions {
  return {
    password: resolveSessionPassword(),
    cookieName: 'event_portal_session',
    cookieOptions: {
      secure: runtimeEnv('NODE_ENV') === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
    },
  };
}

/** @deprecated используйте getSessionOptions() — пароль не должен фиксироваться на build. */
export const sessionOptions: SessionOptions = {
  get password() {
    return resolveSessionPassword();
  },
  cookieName: 'event_portal_session',
  cookieOptions: {
    get secure() {
      return runtimeEnv('NODE_ENV') === 'production';
    },
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60,
    path: '/',
  },
};

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), getSessionOptions());
}
