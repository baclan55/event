const cloudinary = require('cloudinary').v2;

// Cloudinary включается опционально: если переменные окружения не заданы,
// isConfigured() вернёт false и роуты аватаров продолжат работать по-старому
// (файл целиком сохраняется в Postgres, как раньше — см. src/db/images.js).
//
// Поддерживаются два способа настройки (нужен только один):
//   1) CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>
//      (сама библиотека cloudinary читает эту переменную автоматически)
//   2) три отдельные переменные:
//      CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
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

// Загружает буфер (req.file.buffer от multer) в Cloudinary. Сразу приводим
// аватар к квадрату 512×512 с фокусом на лицо (gravity: 'face') — не
// обязательно, но избавляет от лишней ручной обрезки на фронтенде.
// Возвращает { url, publicId }.
function uploadAvatar(buffer) {
  return new Promise((resolve, reject) => {
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
}

// Удаляет старый аватар при замене на новый — иначе в аккаунте Cloudinary
// будут копиться "осиротевшие" картинки. Ошибку намеренно не пробрасываем
// дальше: неудачное удаление старого файла не должно ломать загрузку нового.
async function deleteAvatar(publicId) {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    console.error('[cloudinary] не удалось удалить старый аватар:', err.message);
  }
}

module.exports = { isConfigured, uploadAvatar, deleteAvatar };
