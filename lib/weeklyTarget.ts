import { query } from '@/lib/db';
import { runtimeEnv } from '@/lib/runtimeEnv';

/** Норма МП за неделю для роли: число или null (нормы нет). */
export function parseWeeklyTarget(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(Math.floor(n), 999);
}

/**
 * Норма для пользователя по основной роли (users.role_id).
 * null — нормы нет, сравнение не показывать.
 * Fallback на WEEKLY_EVENTS_TARGET только если у роли колонка ещё не задана
 * и в env есть значение — нет: без явной нормы в роли = нет нормы.
 */
export async function weeklyTargetForUser(userId: number): Promise<number | null> {
  const result = await query<{ weekly_events_target: number | null }>(
    `SELECT r.weekly_events_target
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1`,
    [userId],
  );
  return parseWeeklyTarget(result.rows[0]?.weekly_events_target);
}

/** Нормы по role_id для списков состава/дашборда. */
export async function weeklyTargetsByRoleId(): Promise<Map<number, number | null>> {
  const result = await query<{ id: number; weekly_events_target: number | null }>(
    'SELECT id, weekly_events_target FROM roles',
  );
  const map = new Map<number, number | null>();
  for (const row of result.rows) {
    map.set(row.id, parseWeeklyTarget(row.weekly_events_target));
  }
  return map;
}

/** Глобальный fallback только для старых экранов без per-role (не использовать в новых местах). */
export function envWeeklyTargetFallback(): number {
  return Number.parseInt(runtimeEnv('WEEKLY_EVENTS_TARGET') || '5', 10) || 5;
}
