const multer = require('multer');

// Файлы принимаем в память и сразу пишем в базу (Postgres), а не на диск —
// диск контейнера на Render не сохраняется между деплоями/перезапусками.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 МБ на файл
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Разрешены только изображения (PNG, JPEG, WEBP, GIF).'));
    }
  },
});

module.exports = upload;
