const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

router.get('/:id', async (req, res, next) => {
  try {
    // Только метаданные + data; длинный Cache-Control — браузер не долбит БД повторно.
    const { rows } = await pool.query(
      'SELECT mime_type, data FROM images WHERE id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).end();
    res.set('Content-Type', rows[0].mime_type);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(rows[0].data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
