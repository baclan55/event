const express = require('express');
const pool = require('../db/pool');
const { requireAnyRole, requireRoleIn } = require('../middleware/auth');
const { VACATIONS_REVIEW_ROLES, userHasRoleIn } = require('../utils/roleAccess');

const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SELECT_FIELDS = `
  v.id, v.user_id, v.start_date, v.end_date, v.reason, v.status,
  v.created_at, v.reviewed_by, v.reviewed_at,
  u.nickname, u.avatar_image_id, u.avatar_url,
  rb.nickname AS reviewed_by_nickname
`;

// Причина отпуска — личная информация. В общем списке (календарь, "Сегодня")
// её видно только автору заявки и руководству, которое рассматривает заявки
// (VACATIONS_REVIEW_ROLES) — остальным сотрудникам показываем пустую строку,
// хотя сам факт отпуска (даты, статус, имя) виден всем с ролью.
function maskReason(row, viewer) {
  const canSee = viewer.is_owner || viewer.id === row.user_id || userHasRoleIn(viewer, VACATIONS_REVIEW_ROLES);
  return { ...row, reason: canSee ? row.reason : '' };
}

// Календарь отпусков виден любому сотруднику с назначенной ролью (как
// "Состав") — не обязательно быть руководителем, чтобы видеть, кто и когда
// в отпуске.
router.get('/', requireAnyRole, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${SELECT_FIELDS}
       FROM vacations v
       JOIN users u ON u.id = v.user_id
       LEFT JOIN users rb ON rb.id = v.reviewed_by
       ORDER BY v.start_date ASC`
    );
    res.json({ vacations: rows.map((r) => maskReason(r, req.user)) });
  } catch (err) {
    next(err);
  }
});

// Собственные заявки текущего сотрудника (раздел "Мои заявки") — здесь
// причина видна всегда, это его же заявки.
router.get('/mine', requireAnyRole, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${SELECT_FIELDS}
       FROM vacations v
       JOIN users u ON u.id = v.user_id
       LEFT JOIN users rb ON rb.id = v.reviewed_by
       WHERE v.user_id = $1
       ORDER BY v.created_at DESC`,
      [req.user.id]
    );
    res.json({ vacations: rows });
  } catch (err) {
    next(err);
  }
});

// Подать заявку на отпуск может любой сотрудник с назначенной ролью — сразу
// уходит на проверку руководству (status = 'pending' по умолчанию).
router.post('/', requireAnyRole, async (req, res, next) => {
  try {
    const startDate = String(req.body.startDate || '').trim();
    const endDate = String(req.body.endDate || '').trim();
    const reason = String(req.body.reason || '').trim();

    if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
      return res.status(400).json({ error: 'Укажите корректный период отпуска.' });
    }
    if (endDate < startDate) {
      return res.status(400).json({ error: 'Дата окончания не может быть раньше даты начала.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO vacations (user_id, start_date, end_date, reason)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.user.id, startDate, endDate, reason]
    );
    res.json({ ok: true, id: rows[0].id });
  } catch (err) {
    next(err);
  }
});

// Изменение статуса заявки:
//  - 'approved' / 'rejected' — только руководство (VACATIONS_REVIEW_ROLES),
//    и только пока заявка ещё 'pending' (повторно решение не меняется тут —
//    для этого есть отдельное удаление ниже).
//  - 'cancelled' — может выставить сам автор заявки, пока она ещё не
//    рассмотрена, либо руководство в любой момент (например, сотрудник
//    передумал уже после одобрения).
router.put('/:id', requireAnyRole, async (req, res, next) => {
  try {
    const status = req.body.status;
    if (!['approved', 'rejected', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Некорректный статус.' });
    }

    const { rows } = await pool.query('SELECT * FROM vacations WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Заявка не найдена.' });
    const vacation = rows[0];

    const isReviewer = userHasRoleIn(req.user, VACATIONS_REVIEW_ROLES);
    const isOwnPendingCancel = status === 'cancelled' && vacation.user_id === req.user.id && vacation.status === 'pending';

    if (!isReviewer && !isOwnPendingCancel) {
      return res.status(403).json({
        error: status === 'cancelled'
          ? 'Отменить можно только свою заявку, пока она на рассмотрении.'
          : 'Недостаточно прав для рассмотрения заявок на отпуск.',
      });
    }
    if (status !== 'cancelled' && vacation.status !== 'pending') {
      return res.status(400).json({ error: 'Эта заявка уже рассмотрена.' });
    }
    if (status === 'cancelled' && vacation.status === 'cancelled') {
      return res.status(400).json({ error: 'Эта заявка уже отменена.' });
    }

    await pool.query(
      `UPDATE vacations SET status = $1, reviewed_by = $2, reviewed_at = now() WHERE id = $3`,
      [status, req.user.id, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Полное удаление записи из истории — только руководству (например, чтобы
// убрать ошибочно созданную заявку).
router.delete('/:id', requireRoleIn(VACATIONS_REVIEW_ROLES), async (req, res, next) => {
  try {
    await pool.query('DELETE FROM vacations WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
