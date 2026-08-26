import 'server-only';
import { runtimeEnv } from '@/lib/runtimeEnv';

export type DiscordUserLookup = {
  id: string;
  username: string;
  globalName: string | null;
  discriminator: string;
};

/**
 * Живой запрос публичного профиля пользователя Discord по ID через Bot-токен
 * (GET /users/{id}). Не требует общего сервера с ботом — это глобальный lookup
 * Discord REST API, доступный любому боту для любого валидного ID.
 * Возвращает null, если токен не настроен, ID некорректен, либо Discord ответил ошибкой
 * (пользователь удалён, неверный ID и т.п.) — вызывающий код должен показать понятную ошибку.
 */
export async function fetchDiscordUserById(discordId: string): Promise<DiscordUserLookup | null> {
  const token = runtimeEnv('DISCORD_BOT_TOKEN');
  if (!token || !/^[0-9]{17,20}$/.test(discordId)) return null;
  let response: Response;
  try {
    response = await fetch(`https://discord.com/api/v10/users/${discordId}`, {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const data = await response.json().catch(() => null);
  if (!data?.id) return null;
  return {
    id: String(data.id),
    username: String(data.username || ''),
    globalName: data.global_name ? String(data.global_name) : null,
    discriminator: String(data.discriminator || '0'),
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
