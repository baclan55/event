const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error(
    '[db] Переменная DATABASE_URL не задана. Создайте .env на основе .env.example ' +
    'и укажите строку подключения к вашей базе (Neon).'
  );
  process.exit(1);
}

// Neon и большинство облачных Postgres требуют SSL. Локальный Postgres
// без SSL тоже отработает нормально — libpq сам договорится, если сервер
// SSL не поддерживает и sslmode строки подключения это допускает.
const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  console.error('[db] Неожиданная ошибка пула соединений:', err.message);
});

module.exports = pool;
