import { Pool, type QueryResult, type QueryResultRow } from 'pg';

/**
 * SSL для Postgres.
 * 1. DATABASE_SSL=true|false
 * 2. sslmode= в DATABASE_URL
 * 3. localhost / docker-сервис db → без SSL
 */
function resolveSsl(connectionString: string): false | { rejectUnauthorized: boolean } {
  const flag = (process.env.DATABASE_SSL || '').toLowerCase();
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
  // Явный облачный хост вне Docker — включаем SSL.
  if (/amazonaws\.com|supabase\.co|render\.com|railway\.app|azure\.com|digitalocean\.com/i.test(connectionString)) {
    return { rejectUnauthorized: false };
  }
  return false;
}

const connectionString = process.env.DATABASE_URL || '';
const globalForDb = globalThis as unknown as { __eventPortalPool?: Pool };

function createPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error('[db] DATABASE_URL не задана.');
  }
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: resolveSsl(process.env.DATABASE_URL),
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    max: 10,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    statement_timeout: 20_000,
    query_timeout: 20_000,
  });
}

export const pool: Pool =
  globalForDb.__eventPortalPool ?? (connectionString ? createPool() : (null as unknown as Pool));

if (connectionString) {
  if (process.env.NODE_ENV !== 'production') {
    globalForDb.__eventPortalPool = pool;
  }
  pool.on('error', (err) => {
    console.error('[db] Неожиданная ошибка пула соединений:', err.message);
  });
}

export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  if (!pool) throw new Error('[db] DATABASE_URL не задана.');
  return pool.query<T>(text, params);
}

export default pool;
