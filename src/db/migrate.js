// Применяет схему базы данных (создаёт таблицы, если их ещё нет).
// Запуск: npm run db:migrate
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./pool');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  console.log('[migrate] Применяю schema.sql...');
  await pool.query(sql);
  console.log('[migrate] Готово: таблицы созданы/проверены.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('[migrate] Ошибка миграции:', err);
  process.exit(1);
});
