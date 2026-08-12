import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { runtimeEnv } from '@/lib/runtimeEnv';

/**
 * SSL для Postgres.
 * 1. DATABASE_SSL=true|false
 * 2. sslmode= в DATABASE_URL
 * 3. localhost / docker-сервис db → без SSL
 */
function resolveSsl(connectionString: string): false | { rejectUnauthorized: boolean } {
  const flag = runtimeEnv('DATABASE_SSL').toLowerCase();
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

const globalForDb = globalThis as unknown as { __eventPortalPool?: Pool };

function createPool(): Pool {
  const connectionString = runtimeEnv('DATABASE_URL');
  if (!connectionString) {
    throw new Error('[db] DATABASE_URL не задана.');
  }
  return new Pool({
    connectionString,
    ssl: resolveSsl(connectionString),
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    max: 10,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    statement_timeout: 20_000,
    query_timeout: 20_000,
  });
}

function getPool(): Pool {
  if (!globalForDb.__eventPortalPool) {
    globalForDb.__eventPortalPool = createPool();
    globalForDb.__eventPortalPool.on('error', (err) => {
      console.error('[db] Неожиданная ошибка пула соединений:', err.message);
    });
  }
  return globalForDb.__eventPortalPool;
}

/** Ленивый пул — URL берётся при первом запросе, не на build. */
export const pool: Pool = new Proxy({} as Pool, {
  get(_target, prop, receiver) {
    const real = getPool();
    const value = Reflect.get(real, prop, receiver);
    return typeof value === 'function' ? value.bind(real) : value;
  },
});

export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params);
}

export default pool;
