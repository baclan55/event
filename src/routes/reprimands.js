const express = require('express');
const pool = require('../db/pool');
const { requireAnyRole, requireRoleIn } = require('../middleware/auth');
const { tierForPriority } = require('../utils/tier');
const { REPRIMANDS_ROLES } = require('../utils/roleAccess');

const router = express.Router();

// Правила системы выговоров:
//  — Хелперы: максимум 2 строгих ('strict') и 4 устных ('verbal') выговора.
//    Они НЕ снимаются по времени — учитываются все, что когда-либо выданы.
//  — Администраторы: максимум 3 балла ('point'). Каждый балл автоматически
//    перестаёт учитываться через 10 дней после выдачи (список записей при
//    этом не удаляется — старые баллы просто помечаются как списанные).
const HELPER_LIMITS = { verbal: 4, strict: 2 };
const ADMIN_POINT_LIMIT = 3;
const ADMIN_POINT_DECAY_DAYS = 10;

const LIMITS_PAYLOAD = {
  helper: { verbal: HELPER_LIMITS.verbal, strict: HELPER_LIMITS.strict },
  admin: { points: ADMIN_POINT_LIMIT, decayDays: ADMIN_POINT_DECAY_DAYS },
};

// Список виден только сотрудникам с определёнными ролями (см.
// src/utils/roleAccess.js -> REPRIMANDS_ROLES) — это раздел внутренней
// дисциплины отдела. К каждой записи добавляем tier (тир сотрудника на
// сегодня, по его текущей роли) и active — для баллов админов это значит
// "ещё не списан" (моложе ADMIN_POINT_DECAY_DAYS дней), для устных/строгих
// выговоров хелперов active всегда true, так как они не сгорают.
router.get('/', requireRoleIn(REPRIMANDS_ROLES), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT rp.id, rp.reason, rp.type, rp.created_at,
              u.id AS user_id, u.nickname AS user_nickname, u.avatar_image_id, u.avatar_url,
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
      `SELECT rp.id, rp.reason, rp.type, rp.created_at,
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
      }
      return { ...r, active, expires_at: expiresAt };
    });

    const tier = tierForPriority(req.user.role_priority);
    res.json({ reprimands, limits: LIMITS_PAYLOAD, tier });
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
      `SELECT u.id, r.priority AS role_priority FROM users u
       LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
      [userId]
    );
    if (!userRows.length) return res.status(404).json({ error: 'Участник не найден.' });
    const tier = tierForPriority(userRows[0].role_priority);

    // Роли, в названии которых есть слово "Helper" (Chief Event Helper,
    // Dep.Chief Event Helper, Senior Event Helper — это единственные такие
    // роли, у которых вообще есть доступ к этому роуту, см. REPRIMANDS_ROLES),
    // не могут выдавать выговоры сотрудникам с ролью ВЫШЕ Chief Event Helper.
    // Тир "admin" по построению (см. ADMIN_TIER_MAX_PRIORITY в src/utils/tier.js)
    // — это как раз все роли строго выше Chief Event Helper по priority
    // (Curator Event, Event Administrator, Dep.Chief Event, Chief Event).
    const issuerIsHelperRole = !req.user.is_owner &&
      !!(req.user.role_name && req.user.role_name.includes('Helper'));
    if (issuerIsHelperRole && tier === 'admin') {
      return res.status(403).json({
        error: 'Роли с "Helper" в названии не могут выдавать выговоры сотрудникам с ролью выше Chief Event Helper.',
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
    } else {
      type = (req.body.type || '').trim();
      if (type !== 'strict' && type !== 'verbal') {
        return res.status(400).json({ error: 'Укажите тип выговора: устный или строгий.' });
      }
      const limit = HELPER_LIMITS[type];
      const { rows: cntRows } = await pool.query(
        `SELECT COUNT(*)::int AS c FROM reprimands WHERE user_id = $1 AND type = $2`,
        [userId, type]
      );
      if (cntRows[0].c >= limit) {
        const label = type === 'strict' ? 'строгих' : 'устных';
        return res.status(400).json({
          error: `У сотрудника уже максимум ${label} выговоров (${limit} из ${limit}). Они не снимаются по времени.`,
        });
      }
    }

    await pool.query(
      `INSERT INTO reprimands (user_id, reason, type, issued_by) VALUES ($1, $2, $3, $4)`,
      [userId, reason, type, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireRoleIn(REPRIMANDS_ROLES), async (req, res, next) => {
  try {
    await pool.query('DELETE FROM reprimands WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
