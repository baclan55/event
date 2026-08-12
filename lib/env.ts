/** Канонический список env — как в Portainer / .env.example */

export const REQUIRED_ENV = [
  'DATABASE_URL',
  'SESSION_SECRET',
] as const;

/** Нужны для Discord-входа (без них кнопка логина бесполезна). */
export const DISCORD_LOGIN_ENV = [
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'APP_DOMAIN',
] as const;

/** Полный список из Portainer (скрин). */
export const PORTAINER_ENV = [
  'DATABASE_URL',
  'SESSION_SECRET',
  'DISCORD_OWNER_ID',
  'APP_TITLE',
  'APP_SUBTITLE',
  'WEEKLY_EVENTS_TARGET',
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_REDIRECT_URI',
  'DISCORD_BOT_TOKEN',
  'APPLICATIONS_WEBHOOK_URL',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'APP_DOMAIN',
  'DISCORD_RELAY_SECRET',
  'DISCORD_RELAY_URL',
] as const;

export function assertRuntimeEnv(): void {
  const missing = REQUIRED_ENV.filter((key) => !(process.env[key] || '').trim());
  if (missing.length) {
    throw new Error(`[env] Не заданы обязательные переменные: ${missing.join(', ')}`);
  }

  const weakLogin = DISCORD_LOGIN_ENV.filter((key) => !(process.env[key] || '').trim());
  if (weakLogin.length && process.env.NODE_ENV === 'production') {
    console.warn(
      `[env] Discord-вход может не работать — пусто: ${weakLogin.join(', ')}`
    );
  }

  if ((process.env.DISCORD_RELAY_URL || '').trim() && !(process.env.DISCORD_RELAY_SECRET || '').trim()) {
    console.warn('[env] DISCORD_RELAY_URL задан без DISCORD_RELAY_SECRET');
  }
}
