const pool = require('./pool');

// Сохраняет буфер файла (из multer) в таблицу images и возвращает id.
async function saveImage(file) {
  const { rows } = await pool.query(
    'INSERT INTO images (mime_type, data) VALUES ($1, $2) RETURNING id',
    [file.mimetype, file.buffer]
  );
  return rows[0].id;
}

module.exports = { saveImage };
