import { query } from '@/lib/db';

/**
 * Дата последнего проведённого МП для каждого названия — сопоставляется с
 * заголовком правила в «Правила МП» по нормализованному тексту (без учёта
 * регистра и пробелов по краям).
 *
 * Ключ — LOWER(BTRIM(title)); значение — ISO-дата последнего message_created_at
 * среди мероприятий со статусом completed.
 */
export async function loadLastHeldByTitle(): Promise<Map<string, string>> {
  const r = await query<{ norm_title: string; last_at: string }>(
    `SELECT LOWER(BTRIM(title)) AS norm_title, MAX(message_created_at)::text AS last_at
     FROM discord_gather_events
     WHERE status = 'completed' AND BTRIM(title) <> ''
     GROUP BY LOWER(BTRIM(title))`,
  );
  return new Map(r.rows.map((row) => [row.norm_title, row.last_at]));
}

/** Добавляет lastHeldAt (ISO-строка или null) к строкам с полем title. */
export function attachLastHeld<T extends object>(
  rows: T[],
  lastByTitle: Map<string, string>,
): (T & { lastHeldAt: string | null })[] {
  return rows.map((row) => ({
    ...row,
    lastHeldAt: lastByTitle.get(String((row as { title?: unknown }).title ?? '').trim().toLowerCase()) ?? null,
  }));
}
