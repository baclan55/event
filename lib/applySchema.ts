import 'server-only';
import fs from 'fs';
import path from 'path';
import type { Pool } from 'pg';

const REQUIRED_TABLES = [
  'roles',
  'users',
  'user_roles',
  'applications',
  'profile_change_requests',
  'blacklist',
  'blacklist_history',
  'achievements',
  'user_achievements',
  'gmp_events',
  'gmp_staff',
  'gmp_checkpoints',
  'gmp_reward_places',
  'gmp_players',
  'gmp_marks',
] as const;

/** Точечные патчи: всегда при старте, даже если полная schema.sql отключена. */
const RUNTIME_PATCHES = [
  `ALTER TABLE rules ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE`,
  `CREATE INDEX IF NOT EXISTS idx_rules_archived ON rules(archived, position)`,
  // Выплаты: устный −50%, строгий −100% (если ещё не задавали вручную).
  `UPDATE payout_role_settings
   SET verbal_penalty_pct = 50, strict_penalty_pct = 100, updated_at = now()
   WHERE verbal_penalty_pct = 0 AND strict_penalty_pct = 0`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS game_profile_confirmed BOOLEAN NOT NULL DEFAULT FALSE`,
  // Уже заполненные профили не блокируем повторным окном.
  `UPDATE users SET game_profile_confirmed = TRUE
   WHERE game_profile_confirmed = FALSE
     AND COALESCE(TRIM(first_name), '') <> ''
     AND static_id ~ '^\\d{2,6}$'
     AND (
       COALESCE(TRIM(last_name), '') <> ''
       OR EXISTS (
         SELECT 1 FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = users.id
           AND COALESCE(r.is_administrator, FALSE) = TRUE
           AND COALESCE(r.is_event_helper, FALSE) = FALSE
       )
     )`,
] as const;

function resolveSchemaPath(): string | null {
  const candidates = [
    path.join(process.cwd(), 'lib/db/schema.sql'),
    path.join(process.cwd(), 'schema.sql'),
    path.join(__dirname, 'db', 'schema.sql'),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) return file;
  }
  return null;
}

async function verifySchema(db: Pool) {
  const check = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_name = ANY($1::text[])`,
    [REQUIRED_TABLES as unknown as string[]],
  );
  const have = new Set(check.rows.map((r) => r.table_name));
  const missing = REQUIRED_TABLES.filter((t) => !have.has(t));
  if (missing.length) {
    throw new Error(`Нет таблиц после миграции: ${missing.join(', ')}`);
  }
}

/** Лёгкие ALTER/INDEX — без полного schema.sql. */
export async function applyRuntimePatches(db: Pool) {
  for (const sql of RUNTIME_PATCHES) {
    try {
      await db.query(sql);
    } catch (err) {
      // Таблицы ещё нет — полная миграция поднимет; иначе пробрасываем.
      const message = (err as Error).message || '';
      if (/does not exist|не существует/i.test(message)) {
        console.warn('[server] Runtime patch пропущен (таблица ещё не создана):', message);
        continue;
      }
      throw err;
    }
  }
  console.log('[server] Runtime-патчи БД применены.');
}

export async function applySchemaOnStart(db: Pool) {
  const file = resolveSchemaPath();
  if (!file) {
    throw new Error('schema.sql не найден — автомиграция невозможна.');
  }
  const sql = fs.readFileSync(file, 'utf8');
  const attempts = 5;
  let lastError: Error | null = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      await db.query(sql);
      await verifySchema(db);
      await applyRuntimePatches(db);
      console.log(`[server] Схема БД применена (${path.basename(file)}).`);
      return;
    } catch (err) {
      lastError = err as Error;
      console.error(`[server] Автомиграция попытка ${i}/${attempts}:`, lastError.message);
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
  throw lastError || new Error('Автомиграция не удалась.');
}
