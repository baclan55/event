const cloudinary = require('cloudinary').v2;

// Cloudinary включается опционально: если переменные окружения не заданы,
// isConfigured() вернёт false и роуты аватаров продолжат работать по-старому
// (файл целиком сохраняется в Postgres, как раньше — см. src/db/images.js).
if (!process.env.CLOUDINARY_URL && process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

function isConfigured() {
  const cfg = cloudinary.config();
  return Boolean(cfg.cloud_name && cfg.api_key && cfg.api_secret);
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    }),
  ]);
}

function uploadAvatar(buffer) {
  const upload = new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'events-denver/avatars',
        resource_type: 'image',
        transformation: [{ width: 512, height: 512, crop: 'fill', gravity: 'face' }],
      },
      (err, result) => {
        if (err) return reject(err);
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    stream.end(buffer);
  });
  return withTimeout(upload, 20_000, 'cloudinary upload');
}

async function deleteAvatar(publicId) {
  if (!publicId) return;
  try {
    await withTimeout(cloudinary.uploader.destroy(publicId), 10_000, 'cloudinary destroy');
  } catch (err) {
    console.error('[cloudinary] не удалось удалить старый аватар:', err.message);
  }
}

module.exports = { isConfigured, uploadAvatar, deleteAvatar };
