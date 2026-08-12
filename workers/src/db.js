import { neon } from '@neondatabase/serverless';

// Legacy HTTP-драйвер (пакет @neondatabase/serverless). Прод-сайт его не использует —
// Next.js ходит в Postgres через node-pg (lib/db.ts).
// Возвращает { rows }, чтобы SQL в workers/ совпадал с Express+pg.
export function createDb(databaseUrl) {
  const sql = neon(databaseUrl);
  return {
    async query(text, params = []) {
      return sql.query(text, params, { fullResults: true });
    },
  };
}

// Сохраняет файл (из FormData, Web File API) в таблицу images и возвращает id.
export async function saveImage(db, file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { rows } = await db.query(
    'INSERT INTO images (mime_type, data) VALUES ($1, $2) RETURNING id',
    [file.type || 'application/octet-stream', bytes]
  );
  return rows[0].id;
}
