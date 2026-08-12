import 'server-only';
import fs from 'fs';
import path from 'path';
import { pool } from '@/lib/db';

export async function applySchemaOnStart() {
  try {
    const sql = fs.readFileSync(path.join(process.cwd(), 'lib/db/schema.sql'), 'utf8');
    await pool.query(sql);
    console.log('[server] Схема БД проверена/обновлена.');
  } catch (err) {
    console.error('[server] Не удалось применить схему:', (err as Error).message);
  }
}
