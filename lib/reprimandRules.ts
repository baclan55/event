import { query } from '@/lib/db';
import { tierForPriority } from '@/lib/tier';

export const HELPER_POINT_VALUES = { verbal: 1, strict: 2 } as const;
export const HELPER_BLOCK_POINTS = 4;
export const HELPER_VERBAL_TO_STRICT = 2;
export const ADMIN_POINT_LIMIT = 3;
export const ADMIN_POINT_DECAY_DAYS = 10;

export function adminPointActive(createdAt: string | Date): boolean {
  const t = new Date(createdAt).getTime();
  return Date.now() - t < ADMIN_POINT_DECAY_DAYS * 24 * 60 * 60 * 1000;
}

export function helperActivePoints(
  entries: { type: string; converted?: boolean }[]
): number {
  let points = 0;
  for (const e of entries) {
    if (e.type === 'strict') points += HELPER_POINT_VALUES.strict;
    else if (e.type === 'verbal' && !e.converted) points += HELPER_POINT_VALUES.verbal;
  }
  return points;
}

export async function syncBlockStatus(userId: number) {
  const { rows: userRows } = await query<{
    id: number;
    is_blocked: boolean;
    role_priority: number | null;
  }>(
    `SELECT u.id, u.is_blocked, r.priority AS role_priority
     FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
    [userId]
  );
  if (!userRows.length) return null;
  const tier = tierForPriority(userRows[0].role_priority);

  const { rows } = await query<{ type: string; converted: boolean; created_at: string }>(
    `SELECT type, converted, created_at FROM reprimands WHERE user_id = $1`,
    [userId]
  );

  let points: number;
  let limit: number;
  if (tier === 'admin') {
    points = rows.filter((r) => r.type === 'point' && adminPointActive(r.created_at)).length;
    limit = ADMIN_POINT_LIMIT;
  } else {
    points = helperActivePoints(rows);
    limit = HELPER_BLOCK_POINTS;
  }

  const shouldBeBlocked = points >= limit;
  if (shouldBeBlocked !== userRows[0].is_blocked) {
    await query(
      `UPDATE users SET is_blocked = $1, blocked_at = CASE WHEN $1 THEN now() ELSE NULL END WHERE id = $2`,
      [shouldBeBlocked, userId]
    );
  }
  return { blocked: shouldBeBlocked, points, limit, tier };
}

export async function maybeConvertVerbalToStrict(userId: number, issuedBy: number) {
  let convertedAny = false;
  for (;;) {
    const { rows } = await query<{ id: number }>(
      `SELECT id FROM reprimands WHERE user_id = $1 AND type = 'verbal' AND converted = FALSE
       ORDER BY created_at ASC`,
      [userId]
    );
    if (rows.length < HELPER_VERBAL_TO_STRICT) break;

    const toConvert = rows.slice(0, HELPER_VERBAL_TO_STRICT).map((r) => r.id);
    const { rows: insRows } = await query<{ id: number }>(
      `INSERT INTO reprimands (user_id, reason, type, issued_by, auto_generated)
       VALUES ($1, $2, 'strict', $3, TRUE) RETURNING id`,
      [
        userId,
        `Автоматически: объединение ${HELPER_VERBAL_TO_STRICT} устных выговоров в строгий`,
        issuedBy,
      ]
    );
    const newId = insRows[0].id;
    await query(
      `UPDATE reprimands SET converted = TRUE, merged_into = $1 WHERE id = ANY($2::int[])`,
      [newId, toConvert]
    );
    convertedAny = true;
  }
  return convertedAny;
}

export const LIMITS_PAYLOAD = {
  helper: {
    verbal: HELPER_POINT_VALUES.verbal,
    strict: HELPER_POINT_VALUES.strict,
    block: HELPER_BLOCK_POINTS,
    verbalToStrict: HELPER_VERBAL_TO_STRICT,
  },
  admin: {
    pointLimit: ADMIN_POINT_LIMIT,
    decayDays: ADMIN_POINT_DECAY_DAYS,
  },
};
