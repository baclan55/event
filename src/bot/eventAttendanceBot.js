// Бот учёта посещаемости мероприятий.
//
// Что делает: слушает канал Discord, в котором бот сервера (Majestic RP |
// Denver и т.п.) публикует и редактирует сообщения о сборе на мероприятие
// ("Сбор на мероприятие: ..."). Когда сообщение переходит в состояние
// "сбор закрыт" (администратор подтвердил список участников — в тексте
// появляется "Победитель:" / "успешно подтвердили список участников"),
// бот вытаскивает Discord ID всех участников из раздела "Участники:" и
// прибавляет +1 к users.weekly_events каждому, кто найден в "Составе" по
// discord_id. Работает в том же Node-процессе, что и сам сайт — отдельный
// сервер/хостинг не нужен, только токен Discord-бота.
//
// Требования на стороне Discord (см. README.md):
//  — включённый "Message Content Intent" в настройках приложения бота;
//  — бот добавлен на сервер и видит нужный канал (права "Просмотр канала" и
//    "История сообщений" достаточно — писать в канал бот не должен).
//
// Не запускается вовсе, если не задан DISCORD_BOT_TOKEN — то есть эта
// функция полностью опциональна и не ломает существующий деплой, если она
// не нужна.

const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');

// ID канала со сборами и ID бота-источника сообщений — заданы по умолчанию
// под текущий сервер, но их можно переопределить через переменные окружения
// (например, если сборы переедут в другой канал).
const DEFAULT_CHANNEL_ID = '1446581838100430878';
const DEFAULT_SOURCE_BOT_ID = '1468289401795903690';

// Фразы-маркеры того, что сбор ЗАКРЫТ (список участников подтверждён).
// Проверяются по всему тексту сообщения (content + embed + компоненты) —
// не важно, в каком именно поле сообщения бот-источник их разместит.
const CLOSED_MARKERS = /успешно подтвердили список участников|победител/i;

// --- Разбор текста сообщения -------------------------------------------

// Рекурсивно собирает все текстовые строки из произвольной структуры
// (embed, компоненты и т.п.) — так извлечение не зависит от того, использует
// бот-источник классические embed'ы или новые Components V2.
function collectStrings(node, out) {
  if (node == null) return;
  if (typeof node === 'string') {
    if (node.trim()) out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectStrings(item, out);
    return;
  }
  if (typeof node === 'object') {
    for (const key of ['content', 'description', 'title', 'text', 'value', 'name', 'label']) {
      if (typeof node[key] === 'string') collectStrings(node[key], out);
    }
    if (node.footer && typeof node.footer.text === 'string') collectStrings(node.footer.text, out);
    if (Array.isArray(node.fields)) collectStrings(node.fields, out);
    if (Array.isArray(node.components)) collectStrings(node.components, out);
  }
}

function extractText(message) {
  const parts = [];
  if (message.content) parts.push(message.content);
  for (const embed of message.embeds || []) {
    collectStrings(
      { title: embed.title, description: embed.description, fields: embed.fields, footer: embed.footer },
      parts
    );
  }
  for (const row of message.components || []) {
    collectStrings(typeof row.toJSON === 'function' ? row.toJSON() : row, parts);
  }
  return parts.join('\n');
}

function isClosedEventMessage(text) {
  return CLOSED_MARKERS.test(text);
}

// "ID мероприятия: 1faacecd" из футера — используется только для читаемых
// логов, для защиты от повторной обработки используется message.id.
function extractEventLabel(text) {
  const m = text.match(/id\s*меропри[ия]ти[яе]\s*:?\s*([a-z0-9]+)/i);
  return m ? m[1] : null;
}

// Достаёт Discord ID администратора, который вёл сбор (раздел
// "Администратор:", идёт перед "Участники:"). Возвращает null, если раздел
// не найден (на случай другого формата сообщения — тогда просто не
// начисляем администратору, участники при этом всё равно обрабатываются).
function extractAdminId(text) {
  const startIdx = text.search(/администратор\s*:/i);
  if (startIdx === -1) return null;
  let section = text.slice(startIdx);
  const endIdx = section.search(/участники\s*:/i);
  if (endIdx !== -1) section = section.slice(0, endIdx);
  const match = section.match(/\b\d{17,20}\b/);
  return match ? match[0] : null;
}

// Достаёт Discord ID участников из раздела "Участники:" (до "Победитель"
// или футера с ID мероприятия). Discord ID — это 17-20-значное число, поэтому
// короткий игровой StaticID победителя (например "187048") и hex ID
// мероприятия ("1faacecd", содержит буквы) под фильтр не попадают.
function extractParticipantIds(text) {
  const headingIdx = text.search(/участники\s*:/i);
  if (headingIdx === -1) return [];
  let section = text.slice(headingIdx);
  const endIdx = section.search(/победител|id\s*меропри[ия]ти[яе]/i);
  if (endIdx !== -1) section = section.slice(0, endIdx);
  const ids = section.match(/\b\d{17,20}\b/g) || [];
  return [...new Set(ids)];
}

// --- Начисление в базу ----------------------------------------------------

async function creditParticipants(pool, { messageId, eventLabel, discordIds }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const already = await client.query(
      'SELECT 1 FROM event_bot_processed_messages WHERE message_id = $1',
      [messageId]
    );
    if (already.rowCount > 0) {
      await client.query('ROLLBACK');
      return { skipped: true };
    }

    let creditedCount = 0;
    if (discordIds.length > 0) {
      const { rows } = await client.query(
        `UPDATE users SET weekly_events = weekly_events + 1
         WHERE discord_id = ANY($1::text[])
         RETURNING discord_id, nickname`,
        [discordIds]
      );
      creditedCount = rows.length;

      const creditedIds = new Set(rows.map((r) => r.discord_id));
      const missing = discordIds.filter((id) => !creditedIds.has(id));
      if (missing.length) {
        console.log(`[event-bot] Не найдены в "Составе" по discord_id (пропущены): ${missing.join(', ')}`);
      }
      if (rows.length) {
        console.log(`[event-bot] +1 мероприятие начислено: ${rows.map((r) => r.nickname).join(', ')}`);
      }
    }

    await client.query(
      `INSERT INTO event_bot_processed_messages (message_id, event_label, participant_count, credited_count)
       VALUES ($1, $2, $3, $4)`,
      [messageId, eventLabel, discordIds.length, creditedCount]
    );

    await client.query('COMMIT');
    return { skipped: false, creditedCount, participantCount: discordIds.length };
  } catch (err) {
    await client.query('ROLLBACK');
    // Уникальный конфликт по message_id — значит это же сообщение уже
    // успела обработать другая (почти одновременная) попытка. Не ошибка.
    if (err.code === '23505') return { skipped: true };
    throw err;
  } finally {
    client.release();
  }
}

// --- Обработка одного сообщения -------------------------------------------

async function handleMessage(pool, rawMessage, { channelId, sourceBotId }) {
  try {
    if (!rawMessage || rawMessage.channelId !== channelId) return;
    if (!rawMessage.author || rawMessage.author.id !== sourceBotId) return;

    let message = rawMessage;
    if (message.partial) {
      message = await message.fetch();
    }

    const text = extractText(message);
    if (!isClosedEventMessage(text)) return; // сбор ещё открыт — ждём следующего изменения

    const participantIds = extractParticipantIds(text);
    const adminId = extractAdminId(text);
    const discordIds = [...new Set(adminId ? [...participantIds, adminId] : participantIds)];
    const eventLabel = extractEventLabel(text) || message.id;

    const result = await creditParticipants(pool, {
      messageId: message.id,
      eventLabel,
      discordIds,
    });

    if (result.skipped) {
      console.log(`[event-bot] Сбор "${eventLabel}" (сообщение ${message.id}) уже был обработан ранее — пропускаю.`);
    } else {
      console.log(
        `[event-bot] Сбор "${eventLabel}" закрыт: участников ${participantIds.length}` +
        `${adminId ? ' + администратор' : ''}, всего к начислению ${result.participantCount}, начислено ${result.creditedCount}.`
      );
    }
  } catch (err) {
    console.error('[event-bot] Ошибка обработки сообщения:', err);
  }
}

// --- Запуск бота ------------------------------------------------------------

function startEventAttendanceBot(pool) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.log(
      '[event-bot] DISCORD_BOT_TOKEN не задан — бот учёта посещаемости не запущен ' +
      '(остальной сайт при этом работает как обычно).'
    );
    return null;
  }

  const channelId = process.env.DISCORD_EVENTS_CHANNEL_ID || DEFAULT_CHANNEL_ID;
  const sourceBotId = process.env.DISCORD_EVENTS_SOURCE_BOT_ID || DEFAULT_SOURCE_BOT_ID;
  const catchupLimit = Math.min(parseInt(process.env.EVENT_BOT_CATCHUP_LIMIT, 10) || 50, 100);

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Message, Partials.Channel],
  });

  client.once(Events.ClientReady, async (c) => {
    console.log(`[event-bot] Подключен как ${c.user.tag}. Слежу за каналом ${channelId}.`);

    // "Догоняющая" проверка при старте: если сайт/бот были офлайн (например,
    // Render "усыпил" бесплатный сервис) и за это время сбор успели закрыть,
    // это событие всё равно будет учтено — просматриваем последние сообщения
    // канала от бота-источника и обрабатываем те, что уже закрыты, но ещё не
    // записаны в event_bot_processed_messages.
    try {
      const channel = await c.channels.fetch(channelId);
      if (channel && channel.isTextBased()) {
        const messages = await channel.messages.fetch({ limit: catchupLimit });
        const fromSource = [...messages.values()].filter((m) => m.author?.id === sourceBotId);
        for (const m of fromSource.reverse()) {
          await handleMessage(pool, m, { channelId, sourceBotId });
        }
        console.log(`[event-bot] Проверено сообщений при старте: ${fromSource.length}.`);
      }
    } catch (err) {
      console.error('[event-bot] Не удалось проверить историю канала при старте:', err.message);
    }
  });

  client.on(Events.MessageCreate, (message) => handleMessage(pool, message, { channelId, sourceBotId }));
  client.on(Events.MessageUpdate, (_oldMessage, newMessage) =>
    handleMessage(pool, newMessage, { channelId, sourceBotId })
  );
  client.on(Events.Error, (err) => console.error('[event-bot] Ошибка клиента Discord:', err));

  client.login(token).catch((err) => {
    console.error('[event-bot] Не удалось войти в Discord (проверьте DISCORD_BOT_TOKEN):', err.message);
  });

  return client;
}

module.exports = {
  startEventAttendanceBot,
  // Экспортируется дополнительно для юнит-тестов / отладки в консоли.
  _internal: { extractText, isClosedEventMessage, extractEventLabel, extractParticipantIds, extractAdminId },
};
