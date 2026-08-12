import 'server-only';
import fs from 'fs';
import path from 'path';
import type { Pool } from 'pg';

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

export async function applySchemaOnStart(db: Pool) {
  const file = resolveSchemaPath();
  if (!file) {
    console.error('[server] schema.sql не найден — автомиграция пропущена.');
    return;
  }
  const sql = fs.readFileSync(file, 'utf8');
  await db.query(sql);
  console.log('[server] Схема БД проверена/обновлена.');
}
