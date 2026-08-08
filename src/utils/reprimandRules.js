const pool = require('../db/pool');
const { tierForPriority } = require('./tier');

// ============================================================================
// Система выговоров — правила расчёта баллов и автоблокировки учётной
// записи. Общий модуль для src/routes/reprimands.js (выдача/удаление
// выговоров) и src/middleware/auth.js (лениво пере-проверяет уже
// заблокированных пользователей при каждом входе — актуально для баллов
// администраторов, которые сгорают через ADMIN_POINT_DECAY_DAYS дней и
// могут снять блокировку автоматически).
//
// Хелперы: устный выговор = 1 балл, строгий = 2 балла. Максимум — 4 балла,
// при достижении аккаунт блокируется автоматически (но не удаляется — вся
// история выговоров сохраняется). Как только у хелпера набирается
// HELPER_VERBAL_TO_STRICT (2) непогашенных устных выговора, они
// автоматически объединяются в 1 строгий — устные остаются в истории,
// помеченные converted=TRUE, и больше не учитываются в баллах отдельно.
// Это правило действует ТОЛЬКО у хелперов.
//
// Администраторы: 1 балл за запись (type='point'), максимум
// ADMIN_POINT_LIMIT (3) — при достижении тоже блокировка. Каждый балл
// автоматически перестаёт учитываться через ADMIN_POINT_DECAY_DAYS (10)
// дней после выдачи (запись при этом не удаляется — см. active в
// src/routes/reprimands.js).
// ============================================================================

const HELPER_POINT_VALUES = { verbal: 1, strict: 2 };
const HELPER_BLOCK_POINTS = 4;
const HELPER_VERBAL_TO_STRICT = 2; // столько непогашенных устных сливаются в 1 строгий

const ADMIN_POINT_LIMIT = 3;
const ADMIN_POINT_DECAY_DAYS = 10;

function adminPointActive(createdAt) {
  const decayMs = ADMIN_POINT_DECAY_DAYS * 24 * 60 * 60 * 1000;
  return new Date(createdAt).getTime() + decayMs > Date.now();
}

// Считает активные баллы хелпера по уже загруженным записям вида
// { type, converted }. Строгие (в т.ч. автоматические) — всегда 2 балла;
// устные — 1 балл, но только если ещё не объединены (converted=false).
function helperActivePoints(entries) {
  let points = 0;
  for (const e of entries) {
    if (e.type === 'strict') points += HELPER_POINT_VALUES.strict;
    else if (e.type === 'verbal' && !e.converted) points += HELPER_POINT_VALUES.verbal;
  }
  return points;
}

// Пересчитывает баллы пользователя с нуля (по факту записей в БД) и
// синхронизирует users.is_blocked с результатом: блокирует при достижении
// лимита своего тира, снимает блокировку, если баллы опустились ниже лимита
// (например, после удаления ошибочной записи или сгорания баллов
// администратора по времени). Никогда не трогает ни пользователя, ни
// выговоры целиком — только флаг is_blocked/blocked_at.
async function syncBlockStatus(userId) {
  const { rows: userRows } = await pool.query(
    `SELECT u.id, u.is_blocked, r.priority AS role_priority
     FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
    [userId]
  );
  if (!userRows.length) return null;
  const tier = tierForPriority(userRows[0].role_priority);

  const { rows } = await pool.query(
    `SELECT type, converted, created_at FROM reprimands WHERE user_id = $1`,
    [userId]
  );

  let points, limit;
  if (tier === 'admin') {
    points = rows.filter((r) => r.type === 'point' && adminPointActive(r.created_at)).length;
    limit = ADMIN_POINT_LIMIT;
  } else {
    points = helperActivePoints(rows);
    limit = HELPER_BLOCK_POINTS;
  }

  const shouldBeBlocked = points >= limit;
  if (shouldBeBlocked !== userRows[0].is_blocked) {
    await pool.query(
      `UPDATE users SET is_blocked = $1, blocked_at = CASE WHEN $1 THEN now() ELSE NULL END WHERE id = $2`,
      [shouldBeBlocked, userId]
    );
  }
  return { blocked: shouldBeBlocked, points, limit, tier };
}

// Вызывается после выдачи нового устного выговора хелперу. Если
// непогашенных (converted=false) устных набралось HELPER_VERBAL_TO_STRICT
// или больше, объединяет их (начиная с самых старых) в новый строгий
// выговор: исходные устные помечаются converted=TRUE и merged_into = id
// нового строгого, но остаются в истории. Выполняется в цикле на случай,
// если непогашенных устных оказалось больше порога (страховка — в обычном
// потоке конвертация срабатывает сразу при достижении двух).
async function maybeConvertVerbalToStrict(userId, issuedBy) {
  let convertedAny = false;
  for (;;) {
    const { rows } = await pool.query(
      `SELECT id FROM reprimands WHERE user_id = $1 AND type = 'verbal' AND converted = FALSE
       ORDER BY created_at ASC`,
      [userId]
    );
    if (rows.length < HELPER_VERBAL_TO_STRICT) break;

    const toConvert = rows.slice(0, HELPER_VERBAL_TO_STRICT).map((r) => r.id);
    const { rows: insRows } = await pool.query(
      `INSERT INTO reprimands (user_id, reason, type, issued_by, auto_generated)
       VALUES ($1, $2, 'strict', $3, TRUE) RETURNING id`,
      [userId, `Автоматически: объединение ${HELPER_VERBAL_TO_STRICT} устных выговоров в строгий`, issuedBy]
    );
    const newId = insRows[0].id;
    await pool.query(
      `UPDATE reprimands SET converted = TRUE, merged_into = $1 WHERE id = ANY($2::int[])`,
      [newId, toConvert]
    );
    convertedAny = true;
  }
  return convertedAny;
}

module.exports = {
  HELPER_POINT_VALUES,
  HELPER_BLOCK_POINTS,
  HELPER_VERBAL_TO_STRICT,
  ADMIN_POINT_LIMIT,
  ADMIN_POINT_DECAY_DAYS,
  adminPointActive,
  helperActivePoints,
  syncBlockStatus,
  maybeConvertVerbalToStrict,
};
