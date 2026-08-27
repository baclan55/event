import 'server-only';
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { runtimeEnv } from '@/lib/runtimeEnv';

export type DiscordUserLookup = {
  id: string;
  username: string;
  globalName: string | null;
  discriminator: string;
  /** Ник на сервере (nick из guild member), если удалось получить через гильдию. */
  nickname: string | null;
};

export type DiscordLookupError =
  | { type: 'no_token' }
  | { type: 'bad_id' }
  | { type: 'not_found' }
  | { type: 'unauthorized' }
  | { type: 'rate_limited'; retryAfter?: number }
  | { type: 'relay_misconfigured'; relayUrl: string }
  | { type: 'network'; message: string }
  | { type: 'http'; status: number };

export type DiscordLookupResult =
  | { ok: true; user: DiscordUserLookup }
  | { ok: false; error: DiscordLookupError };

type RawResult =
  | { ok: true; status: number; data: Record<string, unknown> | null }
  | { ok: false; error: DiscordLookupError };

/**
 * Исходящий прокси для прямого пути (без relay) — та же идея, что в bot/outboundProxy.ts,
 * но БЕЗ setGlobalDispatcher: Next.js — общий процесс на много запросов, глобальная подмена
 * диспетчера задела бы вообще все fetch в приложении, а не только Discord.
 */
let cachedAgent: ProxyAgent | null | undefined;
function getProxyAgent(): ProxyAgent | undefined {
  if (cachedAgent === undefined) {
    const url = runtimeEnv('DISCORD_PROXY') || runtimeEnv('HTTPS_PROXY') || runtimeEnv('HTTP_PROXY');
    try {
      cachedAgent = url ? new ProxyAgent(url) : null;
    } catch {
      cachedAgent = null;
    }
  }
  return cachedAgent ?? undefined;
}

/**
 * Запрос к Discord REST API (`path` вроде `/users/123` или `/guilds/1/members/123`).
 *
 * Приоритет — тот же Cloudflare-relay (DISCORD_RELAY_URL + DISCORD_RELAY_SECRET), который
 * bot/eventAttendanceBot.ts уже использует в relay-poll режиме для получения участников
 * гильдии (`discordGet` / `fetchMemberRoleIds`) — раз он уже рабочий и доступен из РФ без
 * блокировок, веб-приложению незачем городить отдельный прокси.
 * Если relay не настроен — фолбэк на прямой fetch к discord.com (+ опциональный
 * DISCORD_PROXY/HTTPS_PROXY), как раньше.
 */
async function discordRequest(path: string, token: string): Promise<RawResult> {
  const relayUrl = runtimeEnv('DISCORD_RELAY_URL');
  const relaySecret = runtimeEnv('DISCORD_RELAY_SECRET');

  // DISCORD_RELAY_URL задан (в docker-compose.yml у него есть дефолт), а
  // DISCORD_RELAY_SECRET — пуст: раньше в этом случае мы молча уходили в
  // прямой fetch на discord.com, который на VDS в РФ гарантированно виснет
  // по таймауту 10с и потом жалуется «похоже на блокировку хостинга, задайте
  // DISCORD_PROXY» — хотя relay для этого уже поднят и не хватает одной
  // переменной. Возвращаем понятную ошибку сразу, без обречённой попытки.
  if (relayUrl && !relaySecret) {
    return { ok: false, error: { type: 'relay_misconfigured', relayUrl } };
  }

  const useRelay = !!(relayUrl && relaySecret);

  let response: Awaited<ReturnType<typeof undiciFetch>>;
  try {
    response = useRelay
      ? await undiciFetch(`${relayUrl}/api/v10${path}`, {
          headers: { Authorization: `Bot ${token}`, 'X-Relay-Secret': relaySecret },
          signal: AbortSignal.timeout(15_000) as never,
        })
      : await undiciFetch(`https://discord.com/api/v10${path}`, {
          headers: { Authorization: `Bot ${token}` },
          dispatcher: getProxyAgent(),
          signal: AbortSignal.timeout(10_000) as never,
        });
  } catch (err) {
    const message = (err as Error)?.message || String(err);
    return {
      ok: false,
      error: { type: 'network', message: useRelay ? `relay: ${message}` : message },
    };
  }

  if (response.status === 401 || response.status === 403) return { ok: false, error: { type: 'unauthorized' } };
  if (response.status === 404) return { ok: false, error: { type: 'not_found' } };
  if (response.status === 429) {
    const body = await response.json().catch(() => null) as { retry_after?: number } | null;
    return { ok: false, error: { type: 'rate_limited', retryAfter: body?.retry_after } };
  }
  if (!response.ok) return { ok: false, error: { type: 'http', status: response.status } };
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  return { ok: true, status: response.status, data };
}

function toLookup(user: Record<string, unknown>, nickname: string | null): DiscordUserLookup {
  return {
    id: String(user.id),
    username: String(user.username || ''),
    globalName: user.global_name ? String(user.global_name) : null,
    discriminator: String(user.discriminator || '0'),
    nickname,
  };
}

/**
 * Живой профиль пользователя Discord по ID. Сначала пробуем как участника гильдии
 * (DISCORD_GUILD_ID) — люди, подающие заявки, уже состоят на сервере, а этот путь
 * ещё и не требует привилегированного intent GuildMembers (в отличие от кеша бота).
 * Если человек уже не на сервере — фолбэк на глобальный lookup пользователя по ID.
 */
export async function fetchDiscordUserById(discordId: string): Promise<DiscordLookupResult> {
  const token = runtimeEnv('DISCORD_BOT_TOKEN');
  if (!token) return { ok: false, error: { type: 'no_token' } };
  if (!/^[0-9]{17,20}$/.test(discordId)) return { ok: false, error: { type: 'bad_id' } };

  const guildId = runtimeEnv('DISCORD_GUILD_ID');
  if (guildId) {
    const member = await discordRequest(`/guilds/${guildId}/members/${discordId}`, token);
    if (member.ok) {
      const user = member.data?.user as Record<string, unknown> | undefined;
      if (user?.id) {
        const nick = member.data?.nick;
        return { ok: true, user: toLookup(user, typeof nick === 'string' ? nick : null) };
      }
    } else if (member.error.type !== 'not_found') {
      // Сетевая/токен-ошибка — фолбэк вниз не поможет, отдаём как есть.
      return member;
    }
    // not_found: человек не (или уже не) на сервере — пробуем глобальный lookup ниже.
  }

  const result = await discordRequest(`/users/${discordId}`, token);
  if (!result.ok) return result;
  const data = result.data;
  if (!data?.id) return { ok: false, error: { type: 'http', status: result.status } };
  return { ok: true, user: toLookup(data, null) };
}

/**
 * Отображаемый тег: старый формат «Имя#1234» — если у аккаунта ещё есть дискриминатор,
 * иначе новый уникальный юзернейм «@имя» (актуальная система Discord с 2023 года).
 */
export function formatDiscordTag(user: DiscordUserLookup): string {
  if (user.discriminator && user.discriminator !== '0') {
    return `${user.username}#${user.discriminator}`;
  }
  return `@${user.username}`;
}

/** Понятное человеку описание причины неудачи — показывается прямо в UI. */
export function describeDiscordLookupError(error: DiscordLookupError): string {
  switch (error.type) {
    case 'no_token':
      return 'На сервере веб-приложения не задан DISCORD_BOT_TOKEN (это переменная бота — проверьте, что она есть и в окружении сайта, если они задеплоены отдельно).';
    case 'bad_id':
      return 'В заявке некорректный Discord ID — тег получить нельзя.';
    case 'not_found':
      return 'Discord не нашёл пользователя с таким ID (аккаунт удалён или ID указан неверно).';
    case 'unauthorized':
      return 'Discord (или relay) отклонил запрос (401/403) — проверьте DISCORD_BOT_TOKEN и, если используется relay, DISCORD_RELAY_SECRET.';
    case 'rate_limited':
      return `Discord временно ограничил запросы, попробуйте через ${Math.max(1, Math.ceil(error.retryAfter || 5))} сек.`;
    case 'relay_misconfigured':
      return `DISCORD_RELAY_URL задан (${error.relayUrl}), но пуст DISCORD_RELAY_SECRET — из-за этого сайт не может использовать Cloudflare-relay, а идти к discord.com напрямую с этого хостинга бесполезно (заблокировано). Впишите DISCORD_RELAY_SECRET в .env — тот же секрет, что указан в Cloudflare Worker → Settings → Variables → DISCORD_RELAY_SECRET, — и пересоздайте контейнер сайта: docker compose up -d --force-recreate app (простого restart недостаточно, .env перечитывается только при пересоздании).`;
    case 'network':
      return `Не удалось соединиться с Discord напрямую (${error.message}). Похоже на сетевую блокировку с хостинга — настройте DISCORD_RELAY_URL/DISCORD_RELAY_SECRET (Cloudflare relay, см. README), либо в крайнем случае задайте DISCORD_PROXY/HTTPS_PROXY для сервиса app, как уже сделано для event-bot.`;
    case 'http':
      return `Discord ответил ошибкой ${error.status}.`;
    default:
      return 'Не удалось получить данные из Discord.';
  }
}
