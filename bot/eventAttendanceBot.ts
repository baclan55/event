// @ts-nocheck
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

import { Client, GatewayIntentBits, Partials, Events } from 'discord.js';
import { getRestAgent, resolveProxyUrl } from './outboundProxy';

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
    // Поле embed'а (и опция select-меню) имеет форму { name, value } /
    // { label, value }, где value — это СОДЕРЖИМОЕ, а name/label — его
    // ЗАГОЛОВОК перед ним. Раньше здесь был единый порядок ключей
    // ['content', ..., 'value', 'name', 'label'], в котором 'value' стоял
    // РАНЬШЕ 'name' — из-за этого для каждого embed-поля сначала попадало
    // в текст его значение, а заголовок ("Администратор:", "Участники:")
    // приклеивался уже ПОСЛЕ него. Итоговый текст получался перепутанным
    // (значение одного поля — заголовок этого же поля — значение
    // следующего поля — ...), а extractAdminId/extractParticipantIds ищут
    // ID сразу ПОСЛЕ заголовка секции — в перепутанном тексте они находили
    // либо не тот ID (ID первого участника вместо администратора), либо
    // вообще ничего (участники считались пустым списком). Поэтому здесь
    // заголовок обязательно кладём ПЕРЕД значением.
    const heading = typeof node.name === 'string' ? node.name : (typeof node.label === 'string' ? node.label : null);
    if (heading != null && typeof node.value === 'string') {
      collectStrings(heading, out);
      collectStrings(node.value, out);
    } else {
      for (const key of ['content', 'description', 'title', 'text', 'value', 'name', 'label']) {
        if (typeof node[key] === 'string') collectStrings(node[key], out);
      }
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
//
// Идемпотентно на уровне КАЖДОГО участника (через таблицу-леджер
// event_bot_credits), а не всего сообщения разом. Это специально: если
// маркер "закрыт" (см. CLOSED_MARKERS) сработает раньше времени — например,
// когда в сообщении виден только администратор, а участники ещё дописываются
// — тем, кто уже в леджере для этого message_id, лишний +1 не прилетит, а
// тем, кто появится в "Участники:" при следующем редактировании сообщения,
// начисление всё равно придёт при следующем вызове. Раньше всё сообщение
// целиком помечалось обработанным после первого же срабатывания, поэтому
// опоздавших участников бот больше никогда не видел.
async function creditParticipants(pool, { messageId, eventLabel, discordIds }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let newIds = [];
    if (discordIds.length > 0) {
      const linked = await client.query(
        `INSERT INTO event_bot_credits (message_id, discord_id)
         SELECT $1, x FROM UNNEST($2::text[]) AS x
         ON CONFLICT (message_id, discord_id) DO NOTHING
         RETURNING discord_id`,
        [messageId, discordIds]
      );
      newIds = linked.rows.map((r) => r.discord_id);
    }

    let creditedRows = [];
    if (newIds.length > 0) {
      const { rows } = await client.query(
        `UPDATE users SET weekly_events = weekly_events + 1
         WHERE discord_id = ANY($1::text[])
         RETURNING discord_id, nickname`,
        [newIds]
      );
      creditedRows = rows;

      const creditedIds = new Set(rows.map((r) => r.discord_id));
      const missing = newIds.filter((id) => !creditedIds.has(id));
      if (missing.length) {
        console.log(`[event-bot] Не найдены в "Составе" по discord_id (пропущены): ${missing.join(', ')}`);
      }
      if (rows.length) {
        console.log(`[event-bot] +1 мероприятие начислено: ${rows.map((r) => r.nickname).join(', ')}`);
      }
    }

    // Сводка по сообщению — информационная, не гейт (см. schema.sql).
    await client.query(
      `INSERT INTO event_bot_processed_messages (message_id, event_label, participant_count, credited_count)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (message_id) DO UPDATE SET
         event_label = EXCLUDED.event_label,
         participant_count = GREATEST(event_bot_processed_messages.participant_count, EXCLUDED.participant_count),
         credited_count = event_bot_processed_messages.credited_count + EXCLUDED.credited_count,
         processed_at = now()`,
      [messageId, eventLabel, discordIds.length, creditedRows.length]
    );

    await client.query('COMMIT');
    return { newlyCredited: creditedRows, newlyLinked: newIds.length, totalInMessage: discordIds.length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// --- Обработка одного сообщения -------------------------------------------

async function handleMessage(pool, rawMessage, { channelId, sourceBotId }) {
  try {
    if (!rawMessage) return;
    // discord.js: channelId; REST JSON через relay: channel_id
    const msgChannelId = rawMessage.channelId || rawMessage.channel_id;
    if (msgChannelId !== channelId) return;
    if (!rawMessage.author || rawMessage.author.id !== sourceBotId) return;

    let message = rawMessage;
    if (message.partial && typeof message.fetch === 'function') {
      message = await message.fetch();
    }

    const text = extractText(message);
    if (!isClosedEventMessage(text)) return;

    const participantIds = extractParticipantIds(text);
    const adminId = extractAdminId(text);
    const discordIds = [...new Set(adminId ? [...participantIds, adminId] : participantIds)];
    const eventLabel = extractEventLabel(text) || message.id;

    const result = await creditParticipants(pool, {
      messageId: message.id,
      eventLabel,
      discordIds,
    });

    if (result.newlyCredited.length === 0) {
      console.log(
        `[event-bot] Сбор "${eventLabel}" (сообщение ${message.id}): новых начислений нет ` +
        `(все ${result.totalInMessage} уже учтены за это сообщение ранее).`
      );
    } else {
      console.log(
        `[event-bot] Сбор "${eventLabel}" закрыт: участников ${participantIds.length}` +
        `${adminId ? ' + администратор' : ''}, в списке всего ${result.totalInMessage}, ` +
        `новых начислений ${result.newlyCredited.length}.`
      );
    }
  } catch (err) {
    console.error('[event-bot] Ошибка обработки сообщения:', err);
  }
}

function normalizeRestMessage(m, channelId) {
  return {
    id: m.id,
    channelId: m.channel_id || channelId,
    channel_id: m.channel_id || channelId,
    author: m.author,
    content: m.content || '',
    embeds: m.embeds || [],
    components: m.components || [],
    partial: false,
  };
}

/** Режим через Cloudflare relay: REST-опрос канала (без Gateway — с VDS WS всё равно не проходит). */
function startRelayPollBot(pool, { token, channelId, sourceBotId, catchupLimit }) {
  const relayUrl = (process.env.DISCORD_RELAY_URL || '').trim().replace(/\/$/, '');
  const relaySecret = (process.env.DISCORD_RELAY_SECRET || '').trim();
  if (!relayUrl || !relaySecret) {
    console.error('[event-bot] Для relay нужны DISCORD_RELAY_URL и DISCORD_RELAY_SECRET.');
    return null;
  }

  const pollMs = Math.max(10_000, parseInt(process.env.EVENT_BOT_POLL_MS, 10) || 30_000);
  let stopped = false;
  let timer = null;
  const seen = new Map(); // messageId -> content hash (ловить edits)

  async function discordGet(path) {
    const url = `${relayUrl}/api/v10${path}`;
    let res;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bot ${token}`,
          'X-Relay-Secret': relaySecret,
        },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      const cause = err.cause ? ` (${err.cause.code || err.cause.message || err.cause})` : '';
      throw new Error(
        `не достучались до relay ${relayUrl}${cause}. ` +
        'DNS discord-relay.event.mjdn.ru должен идти в Cloudflare (прокси ON), ' +
        'а не A-записью на IP VDS. Проверьте: curl -sI https://discord-relay.event.mjdn.ru/health'
      );
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Discord relay ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  function contentKey(m) {
    return `${m.id}:${m.content || ''}:${JSON.stringify(m.embeds || [])}:${JSON.stringify(m.components || [])}`;
  }

  async function pollOnce(label) {
    const list = await discordGet(
      `/channels/${channelId}/messages?limit=${catchupLimit}`
    );
    const fromSource = (Array.isArray(list) ? list : [])
      .filter((m) => m.author && m.author.id === sourceBotId)
      .reverse();

    let processed = 0;
    for (const raw of fromSource) {
      const key = contentKey(raw);
      if (seen.get(raw.id) === key) continue;
      seen.set(raw.id, key);
      await handleMessage(pool, normalizeRestMessage(raw, channelId), { channelId, sourceBotId });
      processed += 1;
      await new Promise((r) => setTimeout(r, 40));
    }
    // Не раздуваем Map бесконечно
    if (seen.size > catchupLimit * 4) {
      const keep = new Set(fromSource.map((m) => m.id));
      for (const id of seen.keys()) {
        if (!keep.has(id)) seen.delete(id);
      }
    }
    console.log(`[event-bot] ${label}: сообщений источника ${fromSource.length}, новых/изменённых ${processed}.`);
  }

  console.log(
    `[event-bot] Режим Cloudflare relay: ${relayUrl}, канал ${channelId}, опрос каждые ${pollMs / 1000}с.`
  );

  (async () => {
    try {
      const health = await fetch(`${relayUrl}/health`, {
        headers: { 'X-Relay-Secret': relaySecret },
        signal: AbortSignal.timeout(10_000),
      });
      // /health у нас без секрета — если 403, всё равно хост жив
      console.log(`[event-bot] Relay health: HTTP ${health.status}`);
    } catch (err) {
      const cause = err.cause ? ` (${err.cause.code || err.cause.message || err.cause})` : '';
      console.error(
        `[event-bot] Relay недоступен с VDS: ${relayUrl}/health${cause}. ` +
        'Частая причина: DNS поддомена указывает на IP сервера (Caddy), а не на Cloudflare Worker.'
      );
    }
    try {
      await pollOnce('старт');
    } catch (err) {
      console.error('[event-bot] Первый опрос через relay не удался:', err.message);
    }
    const tick = async () => {
      if (stopped) return;
      try {
        await pollOnce('опрос');
      } catch (err) {
        console.error('[event-bot] Опрос через relay:', err.message);
      }
      if (!stopped) timer = setTimeout(tick, pollMs);
    };
    timer = setTimeout(tick, pollMs);
  })();

  return {
    mode: 'relay-poll',
    async destroy() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

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
  const relayUrl = (process.env.DISCORD_RELAY_URL || '').trim();

  // Если задан relay — только REST-опрос через Worker (рекомендуемый режим на VDS).
  if (relayUrl) {
    return startRelayPollBot(pool, { token, channelId, sourceBotId, catchupLimit });
  }

  const restAgent = getRestAgent();
  const clientOptions = {
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Message, Partials.Channel],
  };
  if (restAgent) {
    clientOptions.rest = { agent: restAgent };
  }

  const client = new Client(clientOptions);

  client.once(Events.ClientReady, async (c) => {
    console.log(`[event-bot] Подключен как ${c.user.tag}. Слежу за каналом ${channelId}.`);

    const catchupDelayMs = Math.max(0, parseInt(process.env.EVENT_BOT_CATCHUP_DELAY_MS, 10) || 15_000);
    setTimeout(async () => {
      try {
        const channel = await c.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) return;
        const messages = await channel.messages.fetch({ limit: catchupLimit });
        const fromSource = [...messages.values()]
          .filter((m) => m.author?.id === sourceBotId)
          .reverse();
        for (const m of fromSource) {
          await handleMessage(pool, m, { channelId, sourceBotId });
          await new Promise((r) => setTimeout(r, 50));
        }
        console.log(`[event-bot] Проверено сообщений при старте: ${fromSource.length}.`);
      } catch (err) {
        console.error('[event-bot] Не удалось проверить историю канала при старте:', err.message);
      }
    }, catchupDelayMs);
  });

  client.on(Events.MessageCreate, (message) => handleMessage(pool, message, { channelId, sourceBotId }));
  client.on(Events.MessageUpdate, (_oldMessage, newMessage) =>
    handleMessage(pool, newMessage, { channelId, sourceBotId })
  );
  client.on(Events.Error, (err) => console.error('[event-bot] Ошибка клиента Discord:', err));

  client.login(token).catch((err) => {
    const viaProxy = resolveProxyUrl() ? 'через DISCORD_PROXY/HTTPS_PROXY' : 'напрямую (прокси не задан)';
    console.error(
      `[event-bot] Не удалось войти в Discord ${viaProxy}: ${err.message}. ` +
      'На VDS задайте DISCORD_RELAY_URL (Cloudflare) или DISCORD_PROXY.'
    );
  });

  return client;
}

export {
  startEventAttendanceBot,
  handleMessage,
};

export const _internal = {
  extractText,
  isClosedEventMessage,
  extractEventLabel,
  extractParticipantIds,
  extractAdminId,
};
