import 'server-only';
import { query } from '@/lib/db';

const ABANDON_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Open-сборы с кнопками, которые бот УВИДЕЛ открытыми уже после 24ч с даты сообщения
 * → abandoned («Отменено»). Вызывается с сайта как подстраховка.
 *
 * Важно: нельзя отменять просто по возрасту. Если бот был выключен, сбор мог закончиться
 * (кнопки сняты), а бот ещё не успел это увидеть — такой сбор должен засчитаться в свою
 * неделю. Поэтому отменяем, только если last_seen_at (последняя проверка ботом) позже
 * message_created_at + 24ч, то есть бот сам видел, что кнопки всё ещё на месте.
 */
export async function abandonStaleOpenGathers(): Promise<number> {
  const cutoff = new Date(Date.now() - ABANDON_AFTER_MS).toISOString();
  try {
    const result = await query<{ message_id: string }>(
      `UPDATE discord_gather_events
       SET status='abandoned', abandoned_at=now(), updated_at=now()
       WHERE status='open'
         AND has_buttons = TRUE
         AND message_created_at < $1::timestamptz
         AND last_seen_at >= message_created_at + interval '24 hours'
       RETURNING message_id`,
      [cutoff],
    );
    return result.rows.length;
  } catch (err) {
    console.warn('[discord-gather] abandonStaleOpenGathers:', (err as Error).message);
    return 0;
  }
}
