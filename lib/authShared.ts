import type { EventCap, GmpCap, Permission } from '@/lib/roleAccess';
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
  permissions: Permission[];
  editPermissions: Permission[];
  gmpCaps: GmpCap[];
  eventCaps: EventCap[];
  isBlocked: boolean;
  blockedAt: string | null;
  firstName: string | null;
  lastName: string | null;
  staticId: string | null;
  isEventHelper: boolean;
  isAdministrator: boolean;
  dashboardBlocks: Record<DashboardBlock, boolean>;
  profileComplete: boolean;
};
