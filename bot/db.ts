/**
 * Пул Postgres для Discord-бота — без `server-only` / Next.js.
 * Сайт по-прежнему использует lib/db.ts.
 */
import { Pool, type QueryResult, type QueryResultRow } from 'pg';

function resolveSsl(connectionString: string): false | { rejectUnauthorized: boolean } {
  const flag = String(process.env.DATABASE_SSL || '').toLowerCase();
  if (flag === 'false' || flag === '0' || flag === 'off') return false;
  if (flag === 'true' || flag === '1' || flag === 'on') {
    return { rejectUnauthorized: false };
  }

  const sslmodeMatch = connectionString.match(/[?&]sslmode=([^&]+)/i);
  const sslmode = sslmodeMatch ? sslmodeMatch[1].toLowerCase() : null;
  if (sslmode === 'disable') return false;
  if (sslmode === 'require' || sslmode === 'verify-ca' || sslmode === 'verify-full') {
    return { rejectUnauthorized: false };
  }

  const isDockerOrLocal =
    /localhost|127\.0\.0\.1|@db(?::|\/)|@postgres(?::|\/)/i.test(connectionString);
  if (isDockerOrLocal) return false;

  if (/amazonaws\.com|supabase\.co|render\.com|railway\.app|azure\.com|digitalocean\.com/i.test(connectionString)) {
    return { rejectUnauthorized: false };
  }
  return false;
}

const connectionString = process.env.DATABASE_URL || '';
if (!connectionString) {
  throw new Error('[event-bot] DATABASE_URL не задан');
}

const pool = new Pool({
  connectionString,
  ssl: resolveSsl(connectionString),
  max: 5,
});

pool.on('error', (err) => {
  console.error('[event-bot] Ошибка пула Postgres:', err.message);
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

export default pool;
