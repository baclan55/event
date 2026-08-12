import { v2 as cloudinary } from 'cloudinary';
import { runtimeEnv } from '@/lib/runtimeEnv';

let configured = false;

function ensureConfigured(): boolean {
  if (configured) return true;
  if (runtimeEnv('CLOUDINARY_URL')) {
    configured = true;
    return true;
  }
  const cloud = runtimeEnv('CLOUDINARY_CLOUD_NAME');
  const key = runtimeEnv('CLOUDINARY_API_KEY');
  const secret = runtimeEnv('CLOUDINARY_API_SECRET');
  if (cloud && key && secret) {
    cloudinary.config({ cloud_name: cloud, api_key: key, api_secret: secret });
    configured = true;
    return true;
  }
  return false;
}

export function isConfigured(): boolean {
  return ensureConfigured();
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

export async function uploadAvatar(buffer: Buffer): Promise<{ url: string; publicId: string }> {
  if (!ensureConfigured()) throw new Error('Cloudinary не настроен');
  const result = await withTimeout(
    new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'events-denver/avatars',
          transformation: [{ width: 512, height: 512, crop: 'fill', gravity: 'face' }],
        },
        (err, res) => {
          if (err || !res) reject(err || new Error('upload failed'));
          else resolve(res as { secure_url: string; public_id: string });
        }
      );
      stream.end(buffer);
    }),
    20_000,
    'Cloudinary upload'
  );
  return { url: result.secure_url, publicId: result.public_id };
}

export async function deleteAvatar(publicId: string): Promise<void> {
  if (!ensureConfigured() || !publicId) return;
  try {
    await withTimeout(cloudinary.uploader.destroy(publicId), 10_000, 'Cloudinary destroy');
  } catch {
    /* ignore */
  }
}
