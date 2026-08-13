/**
 * Обёртка для локальной разработки. В Docker/CI используйте:
 *   node scripts/migrate.mjs
 */
import 'dotenv/config';
import { spawn } from 'child_process';
import path from 'path';

const child = spawn(process.execPath, [path.join(process.cwd(), 'scripts/migrate.mjs')], {
  stdio: 'inherit',
  env: process.env,
});
child.on('exit', (code) => process.exit(code ?? 1));
