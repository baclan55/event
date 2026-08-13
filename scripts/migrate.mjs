/**
 * Автомиграция для Docker/Portainer (чистый Node, без tsx).
 * Применяет lib/db/schema.sql и проверяет ключевые таблицы.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Pool } = require('pg');

const REQUIRED_TABLES = [
  'roles',
  'users',
  'user_roles',
  'applications',
  'profile_change_requests',
  'blacklist',
  'achievements',
  'user_achievements',
];

function resolveSsl(connectionString) {
  const flag = String(process.env.DATABASE_SSL || '').toLowerCase();
  if (flag === 'false' || flag === '0' || flag === 'off') return false;
  if (flag === 'true' || flag === '1' || flag === 'on') {
    return { rejectUnauthorized: false };
  }
  if (/localhost|127\.0\.0\.1|@db(?::|\/)|@postgres(?::|\/)/i.test(connectionString)) {
    return false;
  }
  return false;
}

function schemaPath() {
  const candidates = [
    path.join(process.cwd(), 'lib/db/schema.sql'),
    path.join(process.cwd(), 'schema.sql'),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) return file;
  }
  return null;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[migrate] DATABASE_URL не задана.');
    process.exit(1);
  }
  const file = schemaPath();
  if (!file) {
    console.error('[migrate] schema.sql не найден.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString,
    ssl: resolveSsl(connectionString),
    connectionTimeoutMillis: 10_000,
  });

  const sql = fs.readFileSync(file, 'utf8');
  const attempts = Number(process.env.MIGRATE_RETRIES || 15);
  let lastError = null;

  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query(sql);
      const check = await pool.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema='public' AND table_name = ANY($1::text[])`,
        [REQUIRED_TABLES],
      );
      const have = new Set(check.rows.map((r) => r.table_name));
      const missing = REQUIRED_TABLES.filter((t) => !have.has(t));
      if (missing.length) {
        throw new Error(`После миграции нет таблиц: ${missing.join(', ')}`);
      }
      console.log(`[migrate] OK · ${path.basename(file)} · таблицы на месте`);
      await pool.end();
      return;
    } catch (err) {
      lastError = err;
      console.error(`[migrate] попытка ${i}/${attempts}:`, err.message);
      await sleep(Math.min(2000 * i, 10_000));
    }
  }

  await pool.end().catch(() => undefined);
  console.error('[migrate] Не удалось применить схему:', lastError?.message);
  process.exit(1);
}

main();
