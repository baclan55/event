const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT mime_type, data FROM images WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).end();
    res.set('Content-Type', rows[0].mime_type);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(rows[0].data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
