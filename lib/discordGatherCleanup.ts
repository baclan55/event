import 'server-only';
import { query } from '@/lib/db';

const ABANDON_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Open-сборы старше 24ч с даты сообщения → abandoned («Отменено»).
 * Вызывается с сайта, чтобы статус обновлялся даже без бота.
 */
export async function abandonStaleOpenGathers(): Promise<number> {
  const cutoff = new Date(Date.now() - ABANDON_AFTER_MS).toISOString();
  try {
    const result = await query<{ message_id: string }>(
      `UPDATE discord_gather_events
       SET status='abandoned', abandoned_at=now(), updated_at=now()
       WHERE status='open' AND message_created_at < $1::timestamptz
       RETURNING message_id`,
      [cutoff],
    );
    return result.rows.length;
  } catch (err) {
    console.warn('[discord-gather] abandonStaleOpenGathers:', (err as Error).message);
    return 0;
  }
}
