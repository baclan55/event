import type { PublicUser } from '@/lib/authShared';
import { isValidStaticId } from '@/lib/staticId';

export type GameProfileFields = {
  firstName: string | null;
  lastName: string | null;
  staticId: string | null;
};

/** Фамилия не нужна только чистым администраторам (без флага «Ивент хелпер»). */
export function requiresLastName(user: {
  isEventHelper?: boolean;
  isAdministrator?: boolean;
}): boolean {
  if (user.isAdministrator && !user.isEventHelper) return false;
  return true;
}

/**
 * Для пользователей без классификации ролей (ещё нет роли) — требуем полный набор,
 * как для хелпера, чтобы нельзя было обойти окно.
 */
export function profileCompletionRequired(user: {
  isEventHelper?: boolean;
  isAdministrator?: boolean;
  isOwner?: boolean;
  roleId?: number | null;
}): boolean {
  if (user.isOwner) return true;
  return true; // все сотрудники с доступом в кабинет
}

export function isGameProfileComplete(user: {
  firstName?: string | null;
  lastName?: string | null;
  staticId?: string | null;
  isEventHelper?: boolean;
  isAdministrator?: boolean;
  isOwner?: boolean;
  /** Подтверждение через обязательное окно (ProfileGate). */
  gameProfileConfirmed?: boolean | null;
}): boolean {
  if (!user.gameProfileConfirmed) return false;
  const first = (user.firstName || '').trim();
  const last = (user.lastName || '').trim();
  const staticId = (user.staticId || '').trim();
  if (!first || !isValidStaticId(staticId)) return false;
  if (requiresLastName(user) && !last) return false;
  return true;
}

export function validateGameProfileInput(
  input: { firstName?: string; lastName?: string; staticId?: string },
  opts: { requireLastName: boolean },
): { ok: true; firstName: string; lastName: string; staticId: string } | { ok: false; error: string } {
  const firstName = String(input.firstName || '').trim();
  const lastName = String(input.lastName || '').trim();
  const staticId = String(input.staticId || '').trim();
  if (!firstName || firstName.length > 60) {
    return { ok: false, error: 'Укажите имя (до 60 символов).' };
  }
  if (opts.requireLastName && (!lastName || lastName.length > 60)) {
    return { ok: false, error: 'Укажите фамилию (до 60 символов).' };
  }
  if (!opts.requireLastName && lastName.length > 60) {
    return { ok: false, error: 'Фамилия слишком длинная.' };
  }
  if (!isValidStaticId(staticId)) {
    return { ok: false, error: 'StaticID: только цифры, от 2 до 6 символов.' };
  }
  return { ok: true, firstName, lastName: opts.requireLastName ? lastName : lastName, staticId };
}

export function publicNeedsProfileGate(user: PublicUser & {
  firstName?: string | null;
  lastName?: string | null;
  staticId?: string | null;
  isEventHelper?: boolean;
  isAdministrator?: boolean;
  gameProfileConfirmed?: boolean | null;
}): boolean {
  return !isGameProfileComplete({
    firstName: user.firstName,
    lastName: user.lastName,
    staticId: user.staticId,
    isEventHelper: user.isEventHelper,
    isAdministrator: user.isAdministrator,
    isOwner: user.isOwner,
    gameProfileConfirmed: user.gameProfileConfirmed,
  });
}
