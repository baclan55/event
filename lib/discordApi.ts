import 'server-only';
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { runtimeEnv } from '@/lib/runtimeEnv';

export type DiscordUserLookup = {
  id: string;
  username: string;
  globalName: string | null;
  discriminator: string;
};

export type DiscordLookupError =
  | { type: 'no_token' }
  | { type: 'bad_id' }
  | { type: 'not_found' }
  | { type: 'unauthorized' }
  | { type: 'rate_limited'; retryAfter?: number }
  | { type: 'network'; message: string }
  | { type: 'http'; status: number };

export type DiscordLookupResult =
  | { ok: true; user: DiscordUserLookup }
  | { ok: false; error: DiscordLookupError };

/**
 * Бот-токен (Bot ...) и OAuth-приложение для входа (DISCORD_CLIENT_ID/SECRET) —
 * это два РАЗНЫХ Discord-приложения в этом проекте, и с вебом до сих пор мог
 * общаться только auth (см. lib/api/system.ts). DISCORD_BOT_TOKEN раньше был нужен
 * только отдельному процессу бота (bot/standalone.ts) — если веб-приложение и бот
 * задеплоены отдельными контейнерами/стеками в Portainer, в окружении веба этой
 * переменной может просто не быть, хотя у бота она есть и он работает исправно.
 *
 * Отдельно: с части хостингов (в т.ч. многих VDS в РФ) discord.com напрямую
 * недоступен — Connect Timeout (см. bot/outboundProxy.ts, та же причина, по которой
 * OAuth здесь ходит через DISCORD_RELAY_URL). Для веба такого обхода не было,
 * поэтому здесь — тот же принцип, что у бота: DISCORD_PROXY / HTTPS_PROXY / HTTP_PROXY,
 * но БЕЗ setGlobalDispatcher — Next.js это общий процесс на много запросов, и глобальная
 * подмена диспетчера задела бы вообще все fetch в приложении, а не только Discord.
 */
let cachedAgent: ProxyAgent | null | undefined;

function resolveProxyUrl(): string {
  return (
    runtimeEnv('DISCORD_PROXY')
    || runtimeEnv('HTTPS_PROXY')
    || runtimeEnv('HTTP_PROXY')
    || runtimeEnv('https_proxy')
    || runtimeEnv('http_proxy')
  );
}

function getProxyAgent(): ProxyAgent | undefined {
  if (cachedAgent === undefined) {
    const url = resolveProxyUrl();
    try {
      cachedAgent = url ? new ProxyAgent(url) : null;
    } catch {
      cachedAgent = null;
    }
  }
  return cachedAgent ?? undefined;
}

/**
 * Живой запрос публичного профиля пользователя Discord по ID через Bot-токен
 * (GET /users/{id}). Не требует общего сервера с ботом — это глобальный lookup
 * Discord REST API, доступный любому боту для любого валидного ID, независимо от
 * того, состоит ли бот с этим пользователем на одном сервере.
 */
export async function fetchDiscordUserById(discordId: string): Promise<DiscordLookupResult> {
  const token = runtimeEnv('DISCORD_BOT_TOKEN');
  if (!token) return { ok: false, error: { type: 'no_token' } };
  if (!/^[0-9]{17,20}$/.test(discordId)) return { ok: false, error: { type: 'bad_id' } };

  let response: Awaited<ReturnType<typeof undiciFetch>>;
  try {
    response = await undiciFetch(`https://discord.com/api/v10/users/${discordId}`, {
      headers: { Authorization: `Bot ${token}` },
      dispatcher: getProxyAgent(),
      signal: AbortSignal.timeout(10_000) as never,
    });
  } catch (err) {
    return { ok: false, error: { type: 'network', message: (err as Error)?.message || String(err) } };
  }

  if (response.status === 401 || response.status === 403) return { ok: false, error: { type: 'unauthorized' } };
  if (response.status === 404) return { ok: false, error: { type: 'not_found' } };
  if (response.status === 429) {
    const body = await response.json().catch(() => null) as { retry_after?: number } | null;
    return { ok: false, error: { type: 'rate_limited', retryAfter: body?.retry_after } };
  }
  if (!response.ok) return { ok: false, error: { type: 'http', status: response.status } };

  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!data?.id) return { ok: false, error: { type: 'http', status: response.status } };
  return {
    ok: true,
    user: {
      id: String(data.id),
      username: String(data.username || ''),
      globalName: data.global_name ? String(data.global_name) : null,
      discriminator: String(data.discriminator || '0'),
    },
  };
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
      return 'Discord отклонил бот-токен (401/403) — проверьте значение DISCORD_BOT_TOKEN.';
    case 'rate_limited':
      return `Discord временно ограничил запросы, попробуйте через ${Math.max(1, Math.ceil(error.retryAfter || 5))} сек.`;
    case 'network':
      return `Сайт не смог напрямую соединиться с discord.com (${error.message}). Похоже на сетевую блокировку с хостинга — задайте DISCORD_PROXY (или HTTPS_PROXY), как это уже сделано для бота.`;
    case 'http':
      return `Discord ответил ошибкой ${error.status}.`;
    default:
      return 'Не удалось получить данные из Discord.';
  }
}
