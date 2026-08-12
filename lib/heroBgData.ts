import fs from 'fs';
import path from 'path';

/** Читает сжатый фон с диска как data-uri — без HTTP /img (CF обрывает тело). */
export function getHeroBgDataUri(): string {
  const file = path.join(process.cwd(), 'public', 'img', 'mountains-bg-sm.jpg');
  const buf = fs.readFileSync(file);
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}
