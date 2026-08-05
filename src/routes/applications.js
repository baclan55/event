const express = require('express');
const pool = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Поля формы заявки (см. public/js/site.js). Ключи — то, что присылает
// фронтенд в теле запроса; их же используем как имена колонок в БД
// (nicknameStatic -> nickname_static и т.п. приводятся ниже).
const FIELDS = [
  ['discord', 'discord'],
  ['nicknameStatic', 'nickname_static'],
  ['age', 'age'],
  ['avgOnline', 'avg_online'],
  ['timePeriod', 'time_period'],
  ['experience', 'experience'],
  ['ideas', 'ideas'],
  ['motivation', 'motivation'],
];

// Если указан Discord ID (просто цифры), делаем из него кликабельное
// упоминание для уведомления в Discord — <@id>. Иначе оставляем как есть
// (это может быть username вида "name" или "name#1234").
function discordMention(raw) {
  const v = String(raw || '').trim();
  if (/^\d{15,25}$/.test(v)) return `<@${v}>`;
  return v || '—';
}

// Необязательное уведомление в Discord о новой заявке через Webhook URL
// (переменная окружения APPLICATIONS_WEBHOOK_URL). Если не настроено —
// просто ничего не делаем, заявка всё равно сохраняется в БД.
async function notifyDiscord(app) {
  const url = process.env.APPLICATIONS_WEBHOOK_URL;
  if (!url) return;
  try {
    const trim = (s) => (s && s.length > 1000 ? s.slice(0, 1000) + '…' : (s || '—'));
    const payload = {
      content: `📋 Новая заявка на Event Helper — ${discordMention(app.discord)}`,
      embeds: [
        {
          title: app.nickname_static || 'Новая заявка',
          color: 0x7c5cfc,
          fields: [
            { name: 'Discord', value: app.discord || '—', inline: true },
            { name: 'Возраст', value: app.age || '—', inline: true },
            { name: 'Среднесуточный онлайн', value: app.avg_online || '—', inline: true },
            { name: 'Промежуток времени в игре', value: app.time_period || '—', inline: true },
            { name: 'Опыт в проведении мероприятий', value: trim(app.experience) },
            { name: 'Идеи по новым мероприятиям', value: trim(app.ideas) },
            { name: 'Почему именно они', value: trim(app.motivation) },
          ],
        },
      ],
    };
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[applications] не удалось отправить уведомление в Discord:', err.message);
  }
}

// Список заявок виден только администраторам/владельцу (рассмотрение).
router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.discord, a.nickname_static, a.age, a.avg_online, a.time_period,
              a.experience, a.ideas, a.motivation, a.status, a.created_at,
              r.nickname AS reviewed_by_nickname
       FROM applications a
       LEFT JOIN users r ON r.id = a.reviewed_by
       ORDER BY a.created_at DESC`
    );
    res.json({ applications: rows });
  } catch (err) {
    next(err);
  }
});

// Подать заявку может кто угодно — форма на главной странице сайта,
// вход в личный кабинет для этого не требуется.
router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const data = {};
    for (const [key] of FIELDS) data[key] = String(body[key] || '').trim();

    const missing = FIELDS.filter(([key]) => !data[key]);
    if (missing.length) {
      return res.status(400).json({ error: 'Заполните все поля формы.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO applications
         (applicant_id, applicant_name, discord, nickname_static, age, avg_online, time_period, experience, ideas, motivation)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, discord, nickname_static, age, avg_online, time_period, experience, ideas, motivation`,
      [
        req.user ? req.user.id : null,
        data.nicknameStatic || data.discord,
        data.discord,
        data.nicknameStatic,
        data.age,
        data.avgOnline,
        data.timePeriod,
        data.experience,
        data.ideas,
        data.motivation,
      ]
    );

    notifyDiscord(rows[0]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const status = req.body.status;
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Некорректный статус.' });
    }
    await pool.query(
      'UPDATE applications SET status = $1, reviewed_by = $2 WHERE id = $3',
      [status, req.user.id, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM applications WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
