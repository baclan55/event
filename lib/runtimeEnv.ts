/**
 * Читает env в runtime. Нельзя писать process.env.FOO напрямую:
 * Next.js подставляет значение на этапе build (в Docker — placeholder),
 * и тогда в проде игнорируется SESSION_SECRET / DATABASE_URL из Portainer.
 */
export function runtimeEnv(key: string): string {
  return String((process.env as Record<string, string | undefined>)[key] ?? '').trim();
}
