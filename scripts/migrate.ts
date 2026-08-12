import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pool from '../lib/db';

async function main() {
  const sql = fs.readFileSync(path.join(process.cwd(), 'lib/db/schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('[db] schema applied');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
