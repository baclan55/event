import { query } from '@/lib/db';

export async function saveImage(file: { mimetype: string; buffer: Buffer }): Promise<number> {
  const { rows } = await query<{ id: number }>(
    'INSERT INTO images (mime_type, data) VALUES ($1, $2) RETURNING id',
    [file.mimetype || 'application/octet-stream', file.buffer]
  );
  return rows[0].id;
}

export async function readUploadedImage(formData: FormData, field = 'image') {
  const file = formData.get(field);
  if (!file || !(file instanceof File)) return null;
  if (!String(file.type || '').startsWith('image/')) {
    throw new Error('Разрешены только изображения.');
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  return { mimetype: file.type || 'application/octet-stream', buffer };
}
