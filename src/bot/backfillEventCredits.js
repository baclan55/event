// Разовый скрипт "долечивания" истории: проходит вглубь по каналу со
// сборами на мероприятия и прогоняет каждое сообщение бота-источника через
// ту же идемпотентную логику начисления, что и обычный bot (см.
// eventAttendanceBot.js). Нужен, чтобы дозачислить участников закрытых
// сборов, которые попали под старый баг (сообщение помечалось
// обработанным по маркеру "закрыт" ДО того, как список участников
// дозаполнялся, и опоздавшие никогда не засчитывались) — а старт бота
// "догоняет" только последние EVENT_BOT_CATCHUP_LIMIT (максимум 100)
// сообщений канала, чего может не хватить для старых сборов.
//
// Полностью безопасно запускать сколько угодно раз и на уже здоровых
// данных — благодаря таблице-леджеру event_bot_credits никто не может
// получить +1 дважды за одно и то же сообщение, скрипт просто "дозачислит"
// тех, кого не хватает, и не тронет тех, кто уже учтён.
//
// Запуск (из корня проекта, после `npm install`):
//   node src/bot/backfillEventCredits.js [макс-число-сообщений]
//
// По умолчанию проходит вглубь до 2000 сообщений канала (обычно с запасом
// перекрывает всю историю сборов); при необходимости передайте своё число
// первым аргументом, например:
//   node src/bot/backfillEventCredits.js 8000
//
// Использует те же переменные окружения, что и сам бот (DISCORD_BOT_TOKEN,
// DATABASE_URL, при необходимости DISCORD_EVENTS_CHANNEL_ID /
// DISCORD_EVENTS_SOURCE_BOT_ID) — те же значения, что уже прописаны в
// .env / в Environment на Render. На Render это удобнее всего запустить
// во вкладке Shell сервиса.

require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const pool = require('../db/pool');
const { handleMessage } = require('./eventAttendanceBot');

const DEFAULT_CHANNEL_ID = '1446581838100430878';
const DEFAULT_SOURCE_BOT_ID = '1468289401795903690';

async function main() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.error('[backfill] DISCORD_BOT_TOKEN не задан.');
    process.exit(1);
  }

  const channelId = process.env.DISCORD_EVENTS_CHANNEL_ID || DEFAULT_CHANNEL_ID;
  const sourceBotId = process.env.DISCORD_EVENTS_SOURCE_BOT_ID || DEFAULT_SOURCE_BOT_ID;
  const maxMessages = parseInt(process.argv[2], 10) || 2000;

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Message, Partials.Channel],
  });

  await client.login(token);
  await new Promise((resolve) => client.once('ready', resolve));
  console.log(`[backfill] Вошёл как ${client.user.tag}. Иду вглубь истории канала ${channelId}...`);

  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) {
    console.error('[backfill] Канал не найден или не текстовый.');
    await pool.end();
    client.destroy();
    process.exit(1);
  }

  let before;
  let scanned = 0;
  let fromSourceCount = 0;

  while (scanned < maxMessages) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (batch.size === 0) break;

    // Сортируем от новых к старым -> обрабатываем -> берём id самого
    // старого в пачке как курсор "before" для следующего запроса, чтобы
    // идти вглубь истории, а не топтаться на месте.
    const sorted = [...batch.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
    for (const m of sorted) {
      scanned++;
      if (m.author?.id === sourceBotId) {
        fromSourceCount++;
        await handleMessage(pool, m, { channelId, sourceBotId });
      }
    }
    before = sorted[sorted.length - 1].id;
    if (batch.size < 100) break; // дошли до начала канала
  }

  console.log(
    `[backfill] Готово. Просмотрено сообщений: ${scanned}, от бота-источника: ${fromSourceCount}. ` +
    'Подробности по каждому сбору — в строках "[event-bot] ..." выше.'
  );

  await pool.end();
  client.destroy();
  process.exit(0);
}

main().catch((err) => {
  console.error('[backfill] Ошибка:', err);
  process.exit(1);
});
