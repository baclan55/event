const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error(
    '[db] Переменная DATABASE_URL не задана. Создайте .env на основе .env.example ' +
    'и укажите строку подключения к вашей базе (Neon или локальный Postgres).'
  );
  process.exit(1);
}

/**
 * Neon / облачный Postgres требуют SSL.
 * Postgres в Docker Compose (хост db / postgres) SSL обычно не поддерживает —
 * явный ssl: {...} в node-pg форсирует SSL и даёт
 * "The server does not support SSL connections".
 *
 * Приоритет:
 * 1. DATABASE_SSL=true|false
 * 2. sslmode= в DATABASE_URL (disable / require / ...)
 * 3. эвристика: localhost / docker-сервис / не-облако → без SSL
 */
function resolveSsl(connectionString) {
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

  // Локальный хост или сервис из docker-compose (db, postgres).
  const isDockerOrLocal =
    /localhost|127\.0\.0\.1|@db(?::|\/)|@postgres(?::|\/)/i.test(connectionString);

  // Известные облачные хосты, где SSL нужен по умолчанию.
  const isCloud =
    /\.neon\.tech|amazonaws\.com|supabase\.co|render\.com|railway\.app|azure\.com|digitalocean\.com/i.test(
      connectionString
    );

  if (isDockerOrLocal || !isCloud) return false;
  return { rejectUnauthorized: false };
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: resolveSsl(process.env.DATABASE_URL),
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 20_000,
  max: 10,
  allowExitOnIdle: true,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  // Не держать зависшие запросы бесконечно (Neon/сеть).
  statement_timeout: 20_000,
  query_timeout: 20_000,
});

pool.on('error', (err) => {
  console.error('[db] Неожиданная ошибка пула соединений:', err.message);
});

module.exports = pool;
