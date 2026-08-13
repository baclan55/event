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
  'achievements',
  'user_achievements',
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
