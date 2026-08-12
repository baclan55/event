export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { assertRuntimeEnv } = await import('@/lib/env');
  assertRuntimeEnv();

  const { startWeeklyResetScheduler } = await import('@/lib/weeklyReset');
  startWeeklyResetScheduler();

  if (process.env.APPLY_SCHEMA_ON_START === '1' || process.env.APPLY_SCHEMA_ON_START === 'true') {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const { pool } = await import('@/lib/db');
      const sql = fs.readFileSync(path.join(process.cwd(), 'lib/db/schema.sql'), 'utf8');
      await pool.query(sql);
      console.log('[server] Схема БД проверена/обновлена.');
    } catch (err) {
      console.error('[server] Не удалось применить схему:', (err as Error).message);
    }
  }
}
