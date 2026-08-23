import type { ContentSection, EventCap, GmpCap, Permission, ProfileViewCap, StatsCap } from '@/lib/roleAccess';
import type { DashboardBlock } from '@/lib/roleMeta';

/** Клиент-безопасный тип пользователя сессии (без server-only / db). */
export type PublicUser = {
  id: number;
  nickname: string | null;
  discordUsername: string | null;
  avatarImageId: number | null;
  avatarUrl: string | null;
  isOwner: boolean;
  isAdmin: boolean;
  weeklyEvents: number;
  roleId: number | null;
  roleName: string | null;
  rolePriority: number | null;
  roles: string[];
  /** Роли с цветом для UI (профиль, сайдбар и т.п.). */
  roleDetails: { name: string; color: string }[];
  permissions: Permission[];
  editPermissions: Permission[];
  gmpCaps: GmpCap[];
  eventCaps: EventCap[];
  statsCaps: StatsCap[];
  profileViewCaps: ProfileViewCap[];
  profileOwnViewCaps: ProfileViewCap[];
  contentSectionCaps: ContentSection[];
  contentHelperCaps: ContentSection[];
  contentAdministratorCaps: ContentSection[];
  isBlocked: boolean;
  blockedAt: string | null;
  firstName: string | null;
  lastName: string | null;
  staticId: string | null;
  isEventHelper: boolean;
  isAdministrator: boolean;
  dashboardBlocks: Record<DashboardBlock, boolean>;
  profileComplete: boolean;
  /** Пользователь подтвердил игровые данные через обязательное окно. */
  gameProfileConfirmed: boolean;
};
