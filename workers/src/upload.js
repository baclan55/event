// Проверка загружаемых изображений — аналог multer fileFilter + limits
// из Express-версии (src/middleware/upload.js), но на Web File API,
// который доступен в Workers из request.formData() «из коробки».

const ALLOWED_MIME = /^image\/(png|jpe?g|webp|gif)$/i;
const MAX_SIZE = 8 * 1024 * 1024; // 8 МБ

export function getImageFile(form, field = 'image') {
  const file = form.get(field);
  if (!file || typeof file === 'string') {
    return { error: 'Файл не получен.' };
  }
  if (!ALLOWED_MIME.test(file.type)) {
    return { error: 'Разрешены только изображения (PNG, JPEG, WEBP, GIF).' };
  }
  if (file.size > MAX_SIZE) {
    return { error: 'Файл больше 8 МБ.' };
  }
  return { file };
}
