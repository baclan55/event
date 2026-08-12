import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('[db] DATABASE_URL не задана.');

const local = /localhost|127\.0\.0\.1|@db(?::|\/)|@postgres(?::|\/)/i.test(connectionString);

export const scriptPool = new Pool({
  connectionString,
  ssl: local || /[?&]sslmode=disable/i.test(connectionString)
    ? false
    : { rejectUnauthorized: false },
});
