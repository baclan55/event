// @ts-nocheck
/**
 * Discord-бот учёта сборов на мероприятия.
 *
 * Слушает канал с сообщениями бота-источника («Сбор на мероприятие: …»).
 * - Есть кнопки (components) → мероприятие ещё идёт (status=open).
 * - Кнопки сняты → completed: участники в БД + уникальный +1 к weekly_events.
 * - Сообщение удалено или кнопки висят >24ч → abandoned (в статистику не идёт).
 */

import { Client, GatewayIntentBits, Partials, Events } from 'discord.js';
import { getRestAgent, resolveProxyUrl } from './outboundProxy';

const DEFAULT_CHANNEL_ID = '1446581838100430878';
const DEFAULT_SOURCE_BOT_ID = '1468289401795903690';
const ABANDON_AFTER_MS = 24 * 60 * 60 * 1000;

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
    const heading = typeof node.name === 'string'
      ? node.name
      : (typeof node.label === 'string' ? node.label : null);
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
      {
        title: embed.title,
        description: embed.description,
        fields: embed.fields,
        footer: embed.footer,
      },
      parts,
    );
  }
  for (const row of message.components || []) {
    collectStrings(typeof row.toJSON === 'function' ? row.toJSON() : row, parts);
  }
  return parts.join('\n');
}

/** Есть ли интерактивные кнопки / select в components. */
function hasInteractiveButtons(message) {
  function walk(node, depth = 0) {
    if (node == null || depth > 12) return false;
    if (Array.isArray(node)) return node.some((item) => walk(item, depth + 1));
    if (typeof node !== 'object') return false;
    const type = node.type;
    // 2 Button, 3 StringSelect, 5 UserSelect, 6 RoleSelect, 7 MentionableSelect, 8 ChannelSelect
    if (type === 2 || type === 3 || type === 5 || type === 6 || type === 7 || type === 8) return true;
    if (typeof type === 'string' && /button|select/i.test(type)) return true;
    if (walk(node.components, depth + 1)) return true;
    if (typeof node.toJSON === 'function') {
      try {
        return walk(node.toJSON(), depth + 1);
      } catch {
        /* ignore */
      }
    }
    return false;
  }
  return walk(message.components || []);
}

function isGatherMessage(text) {
  return /сбор\s+на\s+мероприятие/i.test(text);
}

/** «—・Сбор на мероприятие: Музыкальные стулья» → «Музыкальные стулья» */
function extractTitle(text) {
  const m = text.match(/сбор\s+на\s+мероприятие\s*[:：]\s*(.+)/i);
  if (!m) return '';
  return m[1]
    .split('\n')[0]
    .replace(/^[\s—\-・.]+/, '')
    .trim();
}

function extractEventLabel(text) {
  const m = text.match(/id\s*меропри[ия]ти[яе]\s*:?\s*([a-z0-9]+)/i);
  return m ? m[1] : null;
}

function extractParticipantIds(text) {
  const headingIdx = text.search(/участники\s*:/i);
  if (headingIdx === -1) return [];
  let section = text.slice(headingIdx);
  const endIdx = section.search(/победител|id\s*меропри[ия]ти[яе]|фото\s+победител/i);
  if (endIdx !== -1) section = section.slice(0, endIdx);
  const ids = section.match(/\b\d{17,20}\b/g) || [];
  return [...new Set(ids)];
}

function messageCreatedAt(message) {
  if (message.createdAt instanceof Date) return message.createdAt;
  if (message.createdTimestamp) return new Date(message.createdTimestamp);
  if (message.timestamp) {
    const n = Number(message.timestamp);
    if (Number.isFinite(n)) return new Date(n);
  }
  // snowflake → ms
  try {
    const id = BigInt(message.id);
    const ms = Number((id >> 22n) + 1420070400000n);
    if (Number.isFinite(ms)) return new Date(ms);
  } catch {
    /* ignore */
  }
  return new Date();
}

async function upsertGather(pool, {
  messageId,
  channelId,
  sourceBotId,
  eventKey,
  title,
  createdAt,
  hasButtons,
  participantIds,
  force = false,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT status FROM discord_gather_events WHERE message_id=$1',
      [messageId],
    );
    const prevStatus = existing.rows[0]?.status || null;

    // При полном ресинке: abandoned без кнопок снова открываем → затем complete.
    if (force && prevStatus === 'abandoned' && !hasButtons) {
      await client.query(
        `UPDATE discord_gather_events SET
           status='open', abandoned_at=NULL, has_buttons=FALSE,
           event_key=COALESCE(NULLIF($2,''), event_key),
           title=CASE WHEN $3<>'' THEN $3 ELSE title END,
           last_seen_at=now(), updated_at=now()
         WHERE message_id=$1`,
        [messageId, eventKey || '', title || ''],
      );
    } else if (!prevStatus) {
      await client.query(
        `INSERT INTO discord_gather_events(
           message_id, channel_id, source_bot_id, event_key, title,
           message_created_at, status, has_buttons, last_seen_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,'open',$7,now(),now())`,
        [
          messageId,
          channelId,
          sourceBotId,
          eventKey,
          title || 'Без названия',
          createdAt.toISOString(),
          hasButtons,
        ],
      );
    } else if (prevStatus === 'open') {
      await client.query(
        `UPDATE discord_gather_events SET
           event_key=COALESCE(NULLIF($2,''), event_key),
           title=CASE WHEN $3<>'' THEN $3 ELSE title END,
           has_buttons=$4,
           last_seen_at=now(),
           updated_at=now()
         WHERE message_id=$1 AND status='open'`,
        [messageId, eventKey || '', title || '', hasButtons],
      );
    } else {
      await client.query(
        `UPDATE discord_gather_events SET last_seen_at=now(), updated_at=now()
         WHERE message_id=$1`,
        [messageId],
      );
    }

    const statusNow = (await client.query(
      'SELECT status FROM discord_gather_events WHERE message_id=$1',
      [messageId],
    )).rows[0]?.status;

    if (statusNow === 'open') {
      await client.query('DELETE FROM discord_gather_participants WHERE message_id=$1', [messageId]);
      if (participantIds.length) {
        await client.query(
          `INSERT INTO discord_gather_participants(message_id, discord_id)
           SELECT $1, x FROM UNNEST($2::text[]) AS x
           ON CONFLICT DO NOTHING`,
          [messageId, participantIds],
        );
      }
    }

    await client.query('COMMIT');
    return { prevStatus, status: statusNow };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function completeGather(pool, { messageId, eventLabel, discordIds }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      `UPDATE discord_gather_events
       SET status='completed', has_buttons=FALSE, completed_at=now(), updated_at=now()
       WHERE message_id=$1 AND status='open'
       RETURNING message_id, title`,
      [messageId],
    );
    if (!locked.rows[0]) {
      await client.query('COMMIT');
      return { credited: [], skipped: true };
    }

    let newIds = [];
    if (discordIds.length > 0) {
      const linked = await client.query(
        `INSERT INTO event_bot_credits (message_id, discord_id)
         SELECT $1, x FROM UNNEST($2::text[]) AS x
         ON CONFLICT (message_id, discord_id) DO NOTHING
         RETURNING discord_id`,
        [messageId, discordIds],
      );
      newIds = linked.rows.map((r) => r.discord_id);
    }

    let creditedRows = [];
    if (newIds.length > 0) {
      const { rows } = await client.query(
        `UPDATE users SET weekly_events = weekly_events + 1
         WHERE discord_id = ANY($1::text[])
         RETURNING discord_id, nickname`,
        [newIds],
      );
      creditedRows = rows;
      const creditedIds = new Set(rows.map((r) => r.discord_id));
      const missing = newIds.filter((id) => !creditedIds.has(id));
      if (missing.length) {
        console.log(`[event-bot] Не найдены в составе (пропущены): ${missing.join(', ')}`);
      }
    }

    await client.query(
      `INSERT INTO event_bot_processed_messages (message_id, event_label, participant_count, credited_count)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (message_id) DO UPDATE SET
         event_label = EXCLUDED.event_label,
         participant_count = GREATEST(event_bot_processed_messages.participant_count, EXCLUDED.participant_count),
         credited_count = event_bot_processed_messages.credited_count + EXCLUDED.credited_count,
         processed_at = now()`,
      [messageId, eventLabel, discordIds.length, creditedRows.length],
    );

    await client.query('COMMIT');
    return {
      credited: creditedRows,
      skipped: false,
      title: locked.rows[0].title,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function abandonGather(pool, messageId, reason) {
  const result = await pool.query(
    `UPDATE discord_gather_events
     SET status='abandoned', abandoned_at=now(), updated_at=now()
     WHERE message_id=$1 AND status='open'
     RETURNING title`,
    [messageId],
  );
  if (result.rows[0]) {
    console.log(
      `[event-bot] Сбор "${result.rows[0].title}" (${messageId}) → не проведён (${reason}).`,
    );
  }
  return result.rowCount > 0;
}

async function abandonStaleOpens(pool) {
  const cutoff = new Date(Date.now() - ABANDON_AFTER_MS).toISOString();
  const result = await pool.query(
    `UPDATE discord_gather_events
     SET status='abandoned', abandoned_at=now(), updated_at=now()
     WHERE status='open' AND message_created_at < $1
     RETURNING message_id, title`,
    [cutoff],
  );
  for (const row of result.rows) {
    console.log(
      `[event-bot] Сбор "${row.title}" (${row.message_id}) → не проведён (прошло 24ч с кнопками).`,
    );
  }
  return result.rowCount;
}

async function handleMessage(pool, rawMessage, { channelId, sourceBotId, force = false }) {
  try {
    if (!rawMessage) return;
    const msgChannelId = rawMessage.channelId || rawMessage.channel_id;
    if (msgChannelId !== channelId) return;
    if (!rawMessage.author || rawMessage.author.id !== sourceBotId) return;

    let message = rawMessage;
    if (message.partial && typeof message.fetch === 'function') {
      message = await message.fetch();
    }

    const text = extractText(message);
    if (!isGatherMessage(text)) return;

    const title = extractTitle(text);
    const participantIds = extractParticipantIds(text);
    const eventKey = extractEventLabel(text);
    const eventLabel = eventKey || message.id;
    const hasButtons = hasInteractiveButtons(message);
    const createdAt = messageCreatedAt(message);

    const { prevStatus, status } = await upsertGather(pool, {
      messageId: message.id,
      channelId,
      sourceBotId,
      eventKey,
      title,
      createdAt,
      hasButtons,
      participantIds,
      force,
    });

    if (status !== 'open') return;

    // Кнопки ещё есть — ждём завершения.
    if (hasButtons) {
      if (!prevStatus) {
        console.log(
          `[event-bot] Открыт сбор "${title || eventLabel}" (${message.id}), участников: ${participantIds.length}.`,
        );
      }
      return;
    }

    // Кнопок нет → мероприятие завершено.
    const result = await completeGather(pool, {
      messageId: message.id,
      eventLabel,
      discordIds: participantIds,
    });
    if (result.skipped) return;
    console.log(
      `[event-bot] Завершён сбор "${result.title}" (${message.id}): участников ${participantIds.length}, ` +
      `новых начислений ${result.credited.length}.`,
    );
    if (result.credited.length) {
      console.log(`[event-bot] +1: ${result.credited.map((r) => r.nickname).join(', ')}`);
    }
  } catch (err) {
    console.error('[event-bot] Ошибка обработки сообщения:', err);
  }
}

async function handleMessageDelete(pool, payload, { channelId }) {
  try {
    const msgChannelId = payload.channelId || payload.channel_id;
    if (msgChannelId && msgChannelId !== channelId) return;
    const messageId = payload.id || payload.messageId;
    if (!messageId) return;
    await abandonGather(pool, messageId, 'сообщение удалено');
  } catch (err) {
    console.error('[event-bot] Ошибка удаления сообщения:', err);
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
    timestamp: m.timestamp,
    createdTimestamp: m.timestamp ? Date.parse(m.timestamp) : undefined,
    partial: false,
  };
}

async function claimResyncJob(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const picked = await client.query(
      `SELECT id, requested_by FROM event_bot_jobs
       WHERE kind='resync' AND status='pending'
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
    );
    if (!picked.rows[0]) {
      await client.query('COMMIT');
      return null;
    }
    await client.query(
      `UPDATE event_bot_jobs
       SET status='running', started_at=now(), error=NULL
       WHERE id=$1`,
      [picked.rows[0].id],
    );
    await client.query('COMMIT');
    return picked.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function finishResyncJob(pool, jobId, { ok, result, error }) {
  await pool.query(
    `UPDATE event_bot_jobs
     SET status=$2, finished_at=now(), result=$3::jsonb, error=$4
     WHERE id=$1`,
    [jobId, ok ? 'done' : 'failed', JSON.stringify(result || null), error || null],
  );
}

/** Полный проход истории канала (для кнопки «Пересобрать МП»). */
async function runHistoryResync(pool, {
  fetchPage,
  channelId,
  sourceBotId,
}) {
  const maxPages = Math.min(parseInt(process.env.EVENT_BOT_RESYNC_MAX_PAGES, 10) || 50, 200);
  let before = null;
  let pages = 0;
  let scanned = 0;
  let fromSource = 0;

  while (pages < maxPages) {
    const list = await fetchPage(before);
    pages += 1;
    if (!Array.isArray(list) || !list.length) break;
    scanned += list.length;
    const batch = list.filter((m) => m.author && m.author.id === sourceBotId);
    fromSource += batch.length;
    // от старых к новым внутри страницы (Discord отдаёт от новых к старым)
    for (const raw of [...batch].reverse()) {
      await handleMessage(pool, normalizeRestMessage(raw, channelId), {
        channelId,
        sourceBotId,
        force: true,
      });
      await new Promise((r) => setTimeout(r, 35));
    }
    const oldest = list[list.length - 1];
    if (!oldest?.id || list.length < 100) break;
    before = oldest.id;
  }

  await abandonStaleOpens(pool);
  return { pages, scanned, fromSource };
}

async function processResyncJobs(pool, deps) {
  const job = await claimResyncJob(pool);
  if (!job) return false;
  console.log(`[event-bot] Старт пересборки МП (job #${job.id})…`);
  try {
    const stats = await runHistoryResync(pool, deps);
    await finishResyncJob(pool, job.id, { ok: true, result: stats });
    console.log(
      `[event-bot] Пересборка #${job.id} готова: страниц ${stats.pages}, ` +
      `сообщений ${stats.scanned}, от источника ${stats.fromSource}.`,
    );
  } catch (err) {
    await finishResyncJob(pool, job.id, { ok: false, error: err.message || String(err) });
    console.error(`[event-bot] Пересборка #${job.id} ошибка:`, err.message || err);
  }
  return true;
}

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
  const seen = new Map();

  async function discordGet(path, { allow404 = false } = {}) {
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
      throw new Error(`не достучались до relay ${relayUrl}${cause}.`);
    }
    if (allow404 && res.status === 404) return null;
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
    await processResyncJobs(pool, {
      channelId,
      sourceBotId,
      fetchPage: async (before) => {
        const q = before
          ? `/channels/${channelId}/messages?limit=100&before=${before}`
          : `/channels/${channelId}/messages?limit=100`;
        return discordGet(q);
      },
    });

    await abandonStaleOpens(pool);

    const list = await discordGet(
      `/channels/${channelId}/messages?limit=${catchupLimit}`,
    );
    const fromSource = (Array.isArray(list) ? list : [])
      .filter((m) => m.author && m.author.id === sourceBotId)
      .reverse();
    const presentIds = new Set(fromSource.map((m) => m.id));

    // Открытые сборы, которых уже нет в окне истории — проверяем точечно.
    const openRows = await pool.query(
      `SELECT message_id FROM discord_gather_events
       WHERE channel_id=$1 AND status='open'`,
      [channelId],
    );
    for (const row of openRows.rows) {
      if (presentIds.has(row.message_id)) continue;
      const remote = await discordGet(`/channels/${channelId}/messages/${row.message_id}`, { allow404: true });
      if (remote == null) {
        await abandonGather(pool, row.message_id, 'сообщение удалено');
      }
    }

    let processed = 0;
    for (const raw of fromSource) {
      const key = contentKey(raw);
      if (seen.get(raw.id) === key) continue;
      seen.set(raw.id, key);
      await handleMessage(pool, normalizeRestMessage(raw, channelId), { channelId, sourceBotId });
      processed += 1;
      await new Promise((r) => setTimeout(r, 40));
    }
    if (seen.size > catchupLimit * 4) {
      const keep = new Set(fromSource.map((m) => m.id));
      for (const id of seen.keys()) {
        if (!keep.has(id)) seen.delete(id);
      }
    }
    console.log(`[event-bot] ${label}: сообщений источника ${fromSource.length}, новых/изменённых ${processed}.`);
  }

  console.log(
    `[event-bot] Режим Cloudflare relay: ${relayUrl}, канал ${channelId}, опрос каждые ${pollMs / 1000}с.`,
  );

  (async () => {
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
      '[event-bot] DISCORD_BOT_TOKEN не задан — бот учёта посещаемости не запущен.',
    );
    return null;
  }

  const channelId = process.env.DISCORD_EVENTS_CHANNEL_ID || DEFAULT_CHANNEL_ID;
  const sourceBotId = process.env.DISCORD_EVENTS_SOURCE_BOT_ID || DEFAULT_SOURCE_BOT_ID;
  const catchupLimit = Math.min(parseInt(process.env.EVENT_BOT_CATCHUP_LIMIT, 10) || 50, 100);
  const relayUrl = (process.env.DISCORD_RELAY_URL || '').trim();

  if (relayUrl) {
    return startRelayPollBot(pool, { token, channelId, sourceBotId, catchupLimit });
  }

  const restAgent = getRestAgent();
  const clientOptions = {
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message, Partials.Channel],
  };
  if (restAgent) {
    clientOptions.rest = { agent: restAgent };
  }

  const client = new Client(clientOptions);
  let staleTimer = null;

  async function gatewayResyncFetch(before) {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return [];
    const opts = { limit: 100 };
    if (before) opts.before = before;
    const col = await channel.messages.fetch(opts);
    return [...col.values()].map((m) => ({
      id: m.id,
      channel_id: channelId,
      author: m.author ? { id: m.author.id } : null,
      content: m.content || '',
      embeds: m.embeds?.map((e) => e.toJSON?.() || e) || [],
      components: m.components?.map((r) => (typeof r.toJSON === 'function' ? r.toJSON() : r)) || [],
      timestamp: m.createdAt?.toISOString?.() || null,
    }));
  }

  client.once(Events.ClientReady, async (c) => {
    console.log(`[event-bot] Подключен как ${c.user.tag}. Слежу за каналом ${channelId}.`);
    await abandonStaleOpens(pool).catch((err) => {
      console.error('[event-bot] Проверка просроченных сборов:', err.message);
    });
    await processResyncJobs(pool, {
      channelId,
      sourceBotId,
      fetchPage: gatewayResyncFetch,
    }).catch((err) => console.error('[event-bot] Resync:', err.message));

    staleTimer = setInterval(() => {
      void (async () => {
        await processResyncJobs(pool, {
          channelId,
          sourceBotId,
          fetchPage: gatewayResyncFetch,
        }).catch((err) => console.error('[event-bot] Resync:', err.message));
        await abandonStaleOpens(pool).catch((err) => {
          console.error('[event-bot] Проверка просроченных сборов:', err.message);
        });
      })();
    }, Math.min(60_000, Math.max(15_000, parseInt(process.env.EVENT_BOT_POLL_MS, 10) || 30_000)));

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
    handleMessage(pool, newMessage, { channelId, sourceBotId }),
  );
  client.on(Events.MessageDelete, (message) => handleMessageDelete(pool, message, { channelId }));
  client.on(Events.Error, (err) => console.error('[event-bot] Ошибка клиента Discord:', err));

  const originalDestroy = client.destroy.bind(client);
  client.destroy = async () => {
    if (staleTimer) clearInterval(staleTimer);
    return originalDestroy();
  };

  client.login(token).catch((err) => {
    const viaProxy = resolveProxyUrl() ? 'через DISCORD_PROXY/HTTPS_PROXY' : 'напрямую (прокси не задан)';
    console.error(
      `[event-bot] Не удалось войти в Discord ${viaProxy}: ${err.message}. ` +
      'На VDS задайте DISCORD_RELAY_URL (Cloudflare) или DISCORD_PROXY.',
    );
  });

  return client;
}

export {
  startEventAttendanceBot,
  handleMessage,
  handleMessageDelete,
};

export const _internal = {
  extractText,
  extractTitle,
  extractEventLabel,
  extractParticipantIds,
  hasInteractiveButtons,
  isGatherMessage,
};
