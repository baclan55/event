const express = require('express');
const pool = require('../db/pool');
const { requireAnyRole, requireRoleIn } = require('../middleware/auth');
const { tierForPriority } = require('../utils/tier');
const { REPRIMANDS_ROLES } = require('../utils/roleAccess');
const {
  HELPER_POINT_VALUES,
  HELPER_BLOCK_POINTS,
  HELPER_VERBAL_TO_STRICT,
  ADMIN_POINT_LIMIT,
  ADMIN_POINT_DECAY_DAYS,
  helperActivePoints,
  syncBlockStatus,
  maybeConvertVerbalToStrict,
} = require('../utils/reprimandRules');

const router = express.Router();

// Правила системы выговоров (см. src/utils/reprimandRules.js для деталей):
//  — Хелперы: устный = 1 балл, строгий = 2 балла, максимум 4 балла — при
//    достижении учётная запись блокируется автоматически (не удаляется,
//    история сохраняется). 2 непогашенных устных автоматически объединяются
//    в 1 строгий.
//  — Администраторы: максимум 3 балла ('point'), тоже ведёт к блокировке.
//    Каждый балл автоматически перестаёт учитываться через 10 дней после
//    выдачи (список записей при этом не удаляется — старые баллы просто
//    помечаются как списанные).
const LIMITS_PAYLOAD = {
  helper: {
    verbalPoints: HELPER_POINT_VALUES.verbal,
    strictPoints: HELPER_POINT_VALUES.strict,
    blockPoints: HELPER_BLOCK_POINTS,
    verbalToStrict: HELPER_VERBAL_TO_STRICT,
  },
  admin: { points: ADMIN_POINT_LIMIT, decayDays: ADMIN_POINT_DECAY_DAYS },
};

// Список виден только сотрудникам с определёнными ролями (см.
// src/utils/roleAccess.js -> REPRIMANDS_ROLES) — это раздел внутренней
// дисциплины отдела. К каждой записи добавляем tier (тир сотрудника на
// сегодня, по его текущей роли) и active — для баллов админов это значит
// "ещё не списан" (моложе ADMIN_POINT_DECAY_DAYS дней), для устных хелпера,
// объединённого в строгий (converted), active=false (запись видна в
// истории, но в баллах больше не участвует); для строгих и непогашенных
// устных active всегда true.
router.get('/', requireRoleIn(REPRIMANDS_ROLES), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT rp.id, rp.reason, rp.type, rp.created_at, rp.converted, rp.auto_generated,
              u.id AS user_id, u.nickname AS user_nickname, u.avatar_image_id, u.avatar_url,
              u.is_blocked, u.blocked_at,
              r.name AS role_name, r.priority AS role_priority,
              iu.nickname AS issued_by_nickname
       FROM reprimands rp
       JOIN users u ON u.id = rp.user_id
       LEFT JOIN roles r ON r.id = u.role_id
       LEFT JOIN users iu ON iu.id = rp.issued_by
       ORDER BY rp.created_at DESC`
    );

    const decayMs = ADMIN_POINT_DECAY_DAYS * 24 * 60 * 60 * 1000;
    const reprimands = rows.map((r) => {
      const tier = tierForPriority(r.role_priority);
      let active = true;
      let expiresAt = null;
      if (r.type === 'point') {
        expiresAt = new Date(new Date(r.created_at).getTime() + decayMs).toISOString();
        active = new Date(expiresAt).getTime() > Date.now();
      } else if (r.type === 'verbal' && r.converted) {
        active = false;
      }
      return { ...r, tier, active, expires_at: expiresAt };
    });

    res.json({ reprimands, limits: LIMITS_PAYLOAD });
  } catch (err) {
    next(err);
  }
});

// Личная версия списка — доступна любому сотруднику С РОЛЬЮ (не только
// тем, кому виден весь раздел) и отдаёт только ЕГО СОБСТВЕННЫЕ записи.
// Используется на личной мини-странице сотрудника, чтобы не открывать ему
// полный раздел "Система выговоров" (тот доступен только ролям из
// REPRIMANDS_ROLES, см. GET '/' выше).
router.get('/me', requireAnyRole, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT rp.id, rp.reason, rp.type, rp.created_at, rp.converted, rp.auto_generated,
              iu.nickname AS issued_by_nickname
       FROM reprimands rp
       LEFT JOIN users iu ON iu.id = rp.issued_by
       WHERE rp.user_id = $1
       ORDER BY rp.created_at DESC`,
      [req.user.id]
    );

    const decayMs = ADMIN_POINT_DECAY_DAYS * 24 * 60 * 60 * 1000;
    const reprimands = rows.map((r) => {
      let active = true;
      let expiresAt = null;
      if (r.type === 'point') {
        expiresAt = new Date(new Date(r.created_at).getTime() + decayMs).toISOString();
        active = new Date(expiresAt).getTime() > Date.now();
      } else if (r.type === 'verbal' && r.converted) {
        active = false;
      }
      return { ...r, active, expires_at: expiresAt };
    });

    const tier = tierForPriority(req.user.role_priority);
    res.json({
      reprimands,
      limits: LIMITS_PAYLOAD,
      tier,
      isBlocked: !!req.user.is_blocked,
      blockedAt: req.user.blocked_at || null,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRoleIn(REPRIMANDS_ROLES), async (req, res, next) => {
  try {
    const userId = req.body.userId;
    const reason = (req.body.reason || '').trim();
    if (!userId || !reason) {
      return res.status(400).json({ error: 'Укажите участника и причину выговора.' });
    }

    const { rows: userRows } = await pool.query(
      `SELECT u.id, u.is_blocked, r.priority AS role_priority FROM users u
       LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
      [userId]
    );
    if (!userRows.length) return res.status(404).json({ error: 'Участник не найден.' });
    if (userRows[0].is_blocked) {
      return res.status(400).json({
        error: 'Учётная запись сотрудника заблокирована за превышение лимита выговоров. Новые выговоры недоступны, пока блокировка не будет снята.',
      });
    }
    const tier = tierForPriority(userRows[0].role_priority);

    // Общее правило: сотрудник не может выдать выговор тому, чья роль выше
    // по иерархии (число priority меньше — см. порядок в src/db/seed.js),
    // чем его собственная. Сравнение идёт по точному priority, а не по
    // тиру helper/admin — это распространяется и на равные роли внутри
    // одного тира (например, Dep.Chief Event Helper не может выдать выговор
    // Chief Event Helper), и на роли внутри тира "admin" (Dep.Chief Event не
    // может выдать выговор Chief Event). Не распространяется на владельца
    // (is_owner) — тот может выдавать выговор кому угодно.
    const issuerPriority = req.user.role_priority;
    const targetPriority = userRows[0].role_priority;
    if (!req.user.is_owner && issuerPriority != null && targetPriority != null &&
        targetPriority < issuerPriority) {
      return res.status(403).json({
        error: 'Нельзя выдать выговор сотруднику с ролью выше вашей.',
      });
    }

    let type;
    if (tier === 'admin') {
      // У администраторов тип всегда "балл" — значение type из запроса
      // игнорируем, чтобы это нельзя было обойти с фронтенда.
      type = 'point';
      const { rows: cntRows } = await pool.query(
        `SELECT COUNT(*)::int AS c FROM reprimands
         WHERE user_id = $1 AND type = 'point'
           AND created_at > now() - make_interval(days => $2)`,
        [userId, ADMIN_POINT_DECAY_DAYS]
      );
      if (cntRows[0].c >= ADMIN_POINT_LIMIT) {
        return res.status(400).json({
          error: `У администратора уже максимум баллов (${ADMIN_POINT_LIMIT} из ${ADMIN_POINT_LIMIT}). Баллы снимаются автоматически через ${ADMIN_POINT_DECAY_DAYS} дней после выдачи — новый можно будет добавить после этого.`,
        });
      }

      await pool.query(
        `INSERT INTO reprimands (user_id, reason, type, issued_by) VALUES ($1, $2, $3, $4)`,
        [userId, reason, type, req.user.id]
      );
    } else {
      type = (req.body.type || '').trim();
      if (type !== 'strict' && type !== 'verbal') {
        return res.status(400).json({ error: 'Укажите тип выговора: устный или строгий.' });
      }

      // Подстраховка на случай гонки запросов — is_blocked уже проверен
      // выше, но пересчитываем баллы ещё раз прямо перед вставкой.
      const { rows: hRows } = await pool.query(
        `SELECT type, converted FROM reprimands WHERE user_id = $1`,
        [userId]
      );
      if (helperActivePoints(hRows) >= HELPER_BLOCK_POINTS) {
        return res.status(400).json({
          error: `У сотрудника уже максимум баллов (${HELPER_BLOCK_POINTS} из ${HELPER_BLOCK_POINTS}). Учётная запись будет заблокирована.`,
        });
      }

      await pool.query(
        `INSERT INTO reprimands (user_id, reason, type, issued_by) VALUES ($1, $2, $3, $4)`,
        [userId, reason, type, req.user.id]
      );

      // Только у хелперов: 2 непогашенных устных автоматически сливаются в
      // 1 строгий (см. src/utils/reprimandRules.js).
      if (type === 'verbal') {
        await maybeConvertVerbalToStrict(userId, req.user.id);
      }
    }

    const status = await syncBlockStatus(userId);
    res.json({ ok: true, blocked: !!(status && status.blocked) });
  } catch (err) {
    next(err);
  }
});

// Ручная разблокировка — доступна тем же ролям, что управляют выговорами.
// НЕ трогает историю выговоров, снимает только флаг блокировки (например,
// при восстановлении сотрудника по решению руководства).
router.post('/users/:userId/unblock', requireRoleIn(REPRIMANDS_ROLES), async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT id FROM users WHERE id = $1', [req.params.userId]);
    if (!rows.length) return res.status(404).json({ error: 'Участник не найден.' });
    await pool.query(
      'UPDATE users SET is_blocked = FALSE, blocked_at = NULL WHERE id = $1',
      [req.params.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireRoleIn(REPRIMANDS_ROLES), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT user_id, type, auto_generated FROM reprimands WHERE id = $1',
      [req.params.id]
    );
    const target = rows[0];

    // Если удаляют автоматически созданный строгий (результат объединения
    // 2 устных) — отменяем объединение: устные, из которых он был собран,
    // возвращаются в активное (не объединённое) состояние вместо того,
    // чтобы навсегда остаться учтёнными в удалённой записи.
    if (target && target.auto_generated && target.type === 'strict') {
      await pool.query(
        `UPDATE reprimands SET converted = FALSE WHERE merged_into = $1`,
        [req.params.id]
      );
    }

    await pool.query('DELETE FROM reprimands WHERE id = $1', [req.params.id]);
    if (target) await syncBlockStatus(target.user_id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
