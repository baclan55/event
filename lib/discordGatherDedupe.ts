import 'server-only';
import { query } from '@/lib/db';
import { weekTimeZone } from '@/lib/weekBounds';

/**
 * Удаляет дубликаты сборов МП:
 * 1) повторные строки с одним Discord message_id (если вдруг есть);
 * 2) проведённые МП с одинаковым названием в один календарный день — остаётся
 *    самое раннее сообщение, остальные удаляются по message_id.
 */
export async function dedupeDiscordGathers(): Promise<{
  byMessageId: number;
  byTitleDay: number;
  orphans: number;
}> {
  const tz = weekTimeZone();

  const byMessageId = await query<{ message_id: string }>(
    `WITH ranked AS (
       SELECT ctid AS rid,
              ROW_NUMBER() OVER (
                PARTITION BY message_id
                ORDER BY CASE status
                  WHEN 'completed' THEN 0
                  WHEN 'open' THEN 1
                  ELSE 2
                END,
                updated_at DESC NULLS LAST,
                message_created_at ASC
              ) AS rn
       FROM discord_gather_events
     )
     DELETE FROM discord_gather_events e
     USING ranked r
     WHERE e.ctid = r.rid AND r.rn > 1
     RETURNING e.message_id`,
  ).catch(() => ({ rows: [] as { message_id: string }[] }));

  const byTitleDay = await query<{ message_id: string }>(
    `WITH ranked AS (
       SELECT message_id,
              ROW_NUMBER() OVER (
                PARTITION BY
                  lower(trim(COALESCE(NULLIF(title, ''), 'Без названия'))),
                  (message_created_at AT TIME ZONE $1)::date
                ORDER BY message_created_at ASC, message_id ASC
              ) AS rn
       FROM discord_gather_events
       WHERE status = 'completed'
     )
     DELETE FROM discord_gather_events e
     USING ranked r
     WHERE e.message_id = r.message_id AND r.rn > 1
     RETURNING e.message_id`,
    [tz],
  ).catch(() => ({ rows: [] as { message_id: string }[] }));

  const orphanCredits = await query(
    `DELETE FROM event_bot_credits c
     WHERE NOT EXISTS (
       SELECT 1 FROM discord_gather_events e WHERE e.message_id = c.message_id
     )
     RETURNING c.message_id`,
  ).catch(() => ({ rows: [] }));

  const orphanProcessed = await query(
    `DELETE FROM event_bot_processed_messages p
     WHERE NOT EXISTS (
       SELECT 1 FROM discord_gather_events e WHERE e.message_id = p.message_id
     )
     RETURNING p.message_id`,
  ).catch(() => ({ rows: [] }));

  return {
    byMessageId: byMessageId.rows.length,
    byTitleDay: byTitleDay.rows.length,
    orphans: orphanCredits.rows.length + orphanProcessed.rows.length,
  };
}
