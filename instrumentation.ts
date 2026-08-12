export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { assertRuntimeEnv } = await import('@/lib/env');
    assertRuntimeEnv();
  } catch (err) {
    console.error('[server] env:', (err as Error).message);
  }
  // weekly reset / schema — из lib/db при первом обращении к БД (не из instrumentation:
  // иначе Next тащит pg в edge/webpack и падает сборка).
}
