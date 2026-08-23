import { query } from '@/lib/db';
import { getSession } from '@/lib/session';
import {
  contentAdministratorCapsFromRole,
  contentHelperCapsFromRole,
  contentSectionCapsFromRole,
  editPermissionsFromRole,
  eventCapsFromRole,
  gmpCapsFromRole,
  permissionsFromRole,
  profileViewCapsFromRole,
  profileOwnViewCapsFromRole,
  statsCapsFromRole,
  userHasAnyRole,
  userHasPermission,
  userHasRoleIn,
  type ContentSection,
  type EventCap,
  type GmpCap,
  type Permission,
  type PermissionLevel,
  type ProfileViewCap,
  type RoleUser,
  type StatsCap,
} from '@/lib/roleAccess';
import {
  defaultDashboardBlocks,
  defaultRoleMetaForName,
  normalizeDashboardBlocks,
  type DashboardBlock,
} from '@/lib/roleMeta';
import type { PublicUser } from '@/lib/authShared';
import { isGameProfileComplete } from '@/lib/profileGame';
import { syncBlockStatus } from '@/lib/reprimandRules';
import { NextResponse } from 'next/server';

export type { PublicUser } from '@/lib/authShared';

export type DbRole = {
  id: number;
  name: string;
  priority: number;
  color?: string | null;
  permissions?: Record<string, boolean> | null;
  is_event_helper?: boolean;
  is_administrator?: boolean;
  dashboard_blocks?: Record<string, boolean> | null;
};

export type DbUser = RoleUser & {
  id: number;
  nickname: string | null;
  discord_id: string | null;
  discord_username: string | null;
  avatar_image_id: number | null;
  avatar_url: string | null;
  avatar_public_id: string | null;
  is_owner: boolean;
  is_admin: boolean;
  weekly_events: number;
  note: string | null;
  is_blocked: boolean;
  blocked_at: string | null;
  role_id: number | null;
  role_name: string | null;
  role_priority: number | null;
  first_name?: string | null;
  last_name?: string | null;
  static_id?: string | null;
  game_profile_confirmed?: boolean | null;
  roles: DbRole[];
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
  is_event_helper?: boolean;
  is_administrator?: boolean;
  dashboard_blocks?: Record<DashboardBlock, boolean>;
};

const BLOCKED_MESSAGE =
  'Учётная запись заблокирована за превышение лимита выговоров. Обратитесь к руководству отдела для разблокировки.';

const BLOCK_SYNC_TTL_MS = 60_000;
const USER_CACHE_TTL_MS = Number.parseInt(process.env.USER_CACHE_TTL_MS || '30000', 10);

const blockSyncAt = new Map<number, number>();
const userCache = new Map<string, { at: number; user: DbUser }>();

function aggregatePermissions(roles: DbRole[]): Permission[] {
  const set = new Set<Permission>();
  for (const role of roles) {
    for (const perm of permissionsFromRole(role.name, role.permissions)) {
      set.add(perm);
    }
  }
  return [...set];
}

function aggregateEditPermissions(roles: DbRole[]): Permission[] {
  const set = new Set<Permission>();
  for (const role of roles) {
    for (const perm of editPermissionsFromRole(role.name, role.permissions)) {
      set.add(perm);
    }
  }
  return [...set];
}

function aggregateGmpCaps(roles: DbRole[]): GmpCap[] {
  const set = new Set<GmpCap>();
  for (const role of roles) {
    for (const cap of gmpCapsFromRole(role.name, role.permissions)) {
      set.add(cap);
    }
  }
  return [...set];
}

function aggregateEventCaps(roles: DbRole[]): EventCap[] {
  const set = new Set<EventCap>();
  for (const role of roles) {
    for (const cap of eventCapsFromRole(role.name, role.permissions)) {
      set.add(cap);
    }
  }
  return [...set];
}

function aggregateStatsCaps(roles: DbRole[]): StatsCap[] {
  const set = new Set<StatsCap>();
  for (const role of roles) {
    for (const cap of statsCapsFromRole(role.name, role.permissions)) {
      set.add(cap);
    }
  }
  return [...set];
}

function aggregateProfileViewCaps(roles: DbRole[]): ProfileViewCap[] {
  const set = new Set<ProfileViewCap>();
  for (const role of roles) {
    for (const cap of profileViewCapsFromRole(role.name, role.permissions)) {
      set.add(cap);
    }
  }
  return [...set];
}

function aggregateProfileOwnViewCaps(roles: DbRole[]): ProfileViewCap[] {
  const set = new Set<ProfileViewCap>();
  for (const role of roles) {
    for (const cap of profileOwnViewCapsFromRole(role.name, role.permissions)) {
      set.add(cap);
    }
  }
  return [...set];
}

function aggregateContentSectionCaps(roles: DbRole[]): ContentSection[] {
  const set = new Set<ContentSection>();
  for (const role of roles) {
    for (const section of contentSectionCapsFromRole(role.name, role.permissions)) {
      set.add(section);
    }
  }
  return [...set];
}

function aggregateContentHelperCaps(roles: DbRole[]): ContentSection[] {
  const set = new Set<ContentSection>();
  for (const role of roles) {
    for (const section of contentHelperCapsFromRole(role.name, role.permissions)) {
      set.add(section);
    }
  }
  return [...set];
}

function aggregateContentAdministratorCaps(roles: DbRole[]): ContentSection[] {
  const set = new Set<ContentSection>();
  for (const role of roles) {
    for (const section of contentAdministratorCapsFromRole(role.name, role.permissions)) {
      set.add(section);
    }
  }
  return [...set];
}

function aggregateRoleFlags(roles: DbRole[]) {
  let isEventHelper = false;
  let isAdministrator = false;
  const blocks = defaultDashboardBlocks();
  let sawBlocks = false;
  for (const role of roles) {
    if (role.is_event_helper) isEventHelper = true;
    if (role.is_administrator) isAdministrator = true;
    // Пока флаги в БД не размечены — классификация по имени роли.
    if (!role.is_event_helper && !role.is_administrator) {
      const named = defaultRoleMetaForName(role.name);
      if (named.isEventHelper) isEventHelper = true;
      if (named.isAdministrator) isAdministrator = true;
    }
    if (role.dashboard_blocks) {
      const normalized = normalizeDashboardBlocks(role.dashboard_blocks);
      if (!sawBlocks) {
        for (const key of Object.keys(blocks) as DashboardBlock[]) blocks[key] = false;
        sawBlocks = true;
      }
      for (const key of Object.keys(blocks) as DashboardBlock[]) {
        if (normalized[key]) blocks[key] = true;
      }
    }
  }
  return {
    isEventHelper,
    isAdministrator,
    dashboardBlocks: sawBlocks ? blocks : defaultDashboardBlocks(),
  };
}

function cloneUser(user: DbUser): DbUser {
  const roles = Array.isArray(user.roles) ? user.roles.map((r) => ({ ...r })) : [];
  const permissions = Array.isArray(user.permissions)
    ? [...user.permissions]
    : aggregatePermissions(roles);
  const editPermissions = Array.isArray(user.editPermissions)
    ? [...user.editPermissions]
    : aggregateEditPermissions(roles);
  const gmpCaps = Array.isArray(user.gmpCaps) ? [...user.gmpCaps] : aggregateGmpCaps(roles);
  const eventCaps = Array.isArray(user.eventCaps) ? [...user.eventCaps] : aggregateEventCaps(roles);
  const statsCaps = Array.isArray(user.statsCaps) ? [...user.statsCaps] : aggregateStatsCaps(roles);
  const profileViewCaps = Array.isArray(user.profileViewCaps)
    ? [...user.profileViewCaps]
    : aggregateProfileViewCaps(roles);
  const profileOwnViewCaps = Array.isArray(user.profileOwnViewCaps)
    ? [...user.profileOwnViewCaps]
    : aggregateProfileOwnViewCaps(roles);
  const contentSectionCaps = Array.isArray(user.contentSectionCaps)
    ? [...user.contentSectionCaps]
    : aggregateContentSectionCaps(roles);
  const contentHelperCaps = Array.isArray(user.contentHelperCaps)
    ? [...user.contentHelperCaps]
    : aggregateContentHelperCaps(roles);
  const contentAdministratorCaps = Array.isArray(user.contentAdministratorCaps)
    ? [...user.contentAdministratorCaps]
    : aggregateContentAdministratorCaps(roles);
  const flags = aggregateRoleFlags(roles);
  return {
    ...user,
    roles,
    roleNames: roles.map((r) => r.name),
    permissions,
    editPermissions,
    gmpCaps,
    eventCaps,
    statsCaps,
    profileViewCaps,
    profileOwnViewCaps,
    contentSectionCaps,
    contentHelperCaps,
    contentAdministratorCaps,
    is_event_helper: user.is_event_helper ?? flags.isEventHelper,
    is_administrator: user.is_administrator ?? flags.isAdministrator,
    dashboard_blocks: user.dashboard_blocks || flags.dashboardBlocks,
  };
}

export function invalidateUserCache(userId?: number | string | null) {
  if (userId == null) {
    userCache.clear();
    return;
  }
  userCache.delete(String(userId));
}

export function publicUser(u: DbUser | null | undefined): PublicUser | null {
  if (!u) return null;
  const roles = Array.isArray(u.roles) ? u.roles : [];
  const permissions = Array.isArray(u.permissions) && u.permissions.length
    ? u.permissions
    : aggregatePermissions(roles);
  const editPermissions = Array.isArray(u.editPermissions)
    ? u.editPermissions
    : aggregateEditPermissions(roles);
  const gmpCaps = Array.isArray(u.gmpCaps) && u.gmpCaps.length
    ? u.gmpCaps
    : aggregateGmpCaps(roles);
  const eventCaps = Array.isArray(u.eventCaps) && u.eventCaps.length
    ? u.eventCaps
    : aggregateEventCaps(roles);
  const statsCaps = Array.isArray(u.statsCaps) && u.statsCaps.length
    ? u.statsCaps
    : aggregateStatsCaps(roles);
  const profileViewCaps = Array.isArray(u.profileViewCaps)
    ? u.profileViewCaps
    : aggregateProfileViewCaps(roles);
  const profileOwnViewCaps = Array.isArray(u.profileOwnViewCaps)
    ? u.profileOwnViewCaps
    : aggregateProfileOwnViewCaps(roles);
  const contentSectionCaps = Array.isArray(u.contentSectionCaps)
    ? u.contentSectionCaps
    : aggregateContentSectionCaps(roles);
  const contentHelperCaps = Array.isArray(u.contentHelperCaps)
    ? u.contentHelperCaps
    : aggregateContentHelperCaps(roles);
  const contentAdministratorCaps = Array.isArray(u.contentAdministratorCaps)
    ? u.contentAdministratorCaps
    : aggregateContentAdministratorCaps(roles);
  const flags = aggregateRoleFlags(roles);
  const isEventHelper = u.is_event_helper ?? flags.isEventHelper;
  const isAdministrator = u.is_administrator ?? flags.isAdministrator;
  const firstName = u.first_name ?? null;
  const lastName = u.last_name ?? null;
  const staticId = u.static_id ?? null;
  const gameProfileConfirmed = !!u.game_profile_confirmed;
  return {
    id: u.id,
    // Отображаемое имя = игровое «Имя»; nickname в БД синхронизируется с ним.
    nickname: firstName || u.nickname,
    discordUsername: u.discord_username,
    avatarImageId: u.avatar_image_id,
    avatarUrl: u.avatar_url,
    isOwner: !!u.is_owner,
    isAdmin: !!u.is_admin,
    weeklyEvents: u.weekly_events,
    roleId: u.role_id,
    roleName: u.role_name,
    rolePriority: u.role_priority != null ? u.role_priority : null,
    roles: roles.map((r) => r.name),
    roleDetails: roles.map((r) => ({ name: r.name, color: String(r.color || '') })),
    permissions,
    editPermissions,
    gmpCaps,
    eventCaps,
    statsCaps,
    profileViewCaps,
    profileOwnViewCaps,
    contentSectionCaps,
    contentHelperCaps,
    contentAdministratorCaps,
    isBlocked: !!u.is_blocked,
    blockedAt: u.blocked_at || null,
    firstName,
    lastName,
    staticId,
    isEventHelper,
    isAdministrator,
    dashboardBlocks: u.dashboard_blocks || flags.dashboardBlocks,
    gameProfileConfirmed,
    profileComplete: isGameProfileComplete({
      firstName,
      lastName,
      staticId,
      isEventHelper,
      isAdministrator,
      gameProfileConfirmed,
    }),
  };
}

export async function loadUserById(userId: number): Promise<DbUser | null> {
  const uid = String(userId);
  const cached = userCache.get(uid);
  if (cached && Date.now() - cached.at < USER_CACHE_TTL_MS) {
    return cloneUser(cached.user);
  }

  const { rows } = await query<DbUser>(
    `SELECT u.id, u.nickname, u.discord_id, u.discord_username,
            u.avatar_image_id, u.avatar_url, u.avatar_public_id,
            u.is_owner, u.is_admin, u.weekly_events, u.note,
            u.is_blocked, u.blocked_at,
            u.first_name, u.last_name, u.static_id,
            COALESCE(u.game_profile_confirmed, FALSE) AS game_profile_confirmed,
            u.role_id, r.name AS role_name, r.priority AS role_priority,
            COALESCE(
              (SELECT json_agg(json_build_object(
                  'id', rr.id,
                  'name', rr.name,
                  'priority', rr.priority,
                  'color', COALESCE(rr.color, ''),
                  'permissions', COALESCE(rr.permissions, '{}'::jsonb),
                  'is_event_helper', COALESCE(rr.is_event_helper, FALSE),
                  'is_administrator', COALESCE(rr.is_administrator, FALSE),
                  'dashboard_blocks', COALESCE(rr.dashboard_blocks, '{"stats":true,"top_admin":true,"top_helper":true}'::jsonb)
                ) ORDER BY rr.priority ASC)
               FROM user_roles ur
               JOIN roles rr ON rr.id = ur.role_id
               WHERE ur.user_id = u.id),
              '[]'::json
            ) AS roles
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1`,
    [userId]
  );

  const user = rows[0] || null;
  if (!user) {
    userCache.delete(uid);
    return null;
  }

  const roles = Array.isArray(user.roles) ? user.roles : [];
  user.roles = roles;
  user.roleNames = roles.map((r) => r.name);
  user.permissions = aggregatePermissions(roles);
  user.editPermissions = aggregateEditPermissions(roles);
  user.gmpCaps = aggregateGmpCaps(roles);
  user.eventCaps = aggregateEventCaps(roles);
  user.statsCaps = aggregateStatsCaps(roles);
  user.profileViewCaps = aggregateProfileViewCaps(roles);
  user.profileOwnViewCaps = aggregateProfileOwnViewCaps(roles);
  user.contentSectionCaps = aggregateContentSectionCaps(roles);
  user.contentHelperCaps = aggregateContentHelperCaps(roles);
  user.contentAdministratorCaps = aggregateContentAdministratorCaps(roles);
  const flags = aggregateRoleFlags(roles);
  user.is_event_helper = flags.isEventHelper;
  user.is_administrator = flags.isAdministrator;
  user.dashboard_blocks = flags.dashboardBlocks;

  if (user.is_blocked) {
    const last = blockSyncAt.get(user.id) || 0;
    if (Date.now() - last >= BLOCK_SYNC_TTL_MS) {
      blockSyncAt.set(user.id, Date.now());
      const status = await syncBlockStatus(user.id);
      if (status) {
        user.is_blocked = status.blocked;
        if (!status.blocked) user.blocked_at = null;
      }
    }
  }

  userCache.set(uid, { at: Date.now(), user: cloneUser(user) });
  return cloneUser(user);
}

export async function getCurrentUser(): Promise<DbUser | null> {
  const session = await getSession();
  if (!session.userId) return null;
  return loadUserById(session.userId);
}

export function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function requireUser(): Promise<DbUser | NextResponse> {
  const user = await getCurrentUser();
  if (!user) return jsonError('Требуется вход в личный кабинет.', 401);
  if (user.is_blocked) return jsonError(BLOCKED_MESSAGE, 403, { blocked: true });
  return user;
}

export async function requireAnyRoleUser(): Promise<DbUser | NextResponse> {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  if (!userHasAnyRole(user)) {
    return jsonError(
      'Личный кабинет станет доступен после того, как вам назначат роль.',
      403
    );
  }
  return user;
}

export async function requireRoleInUser(
  roles: readonly string[]
): Promise<DbUser | NextResponse> {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  if (!userHasRoleIn(user, roles)) {
    return jsonError('Недостаточно прав для доступа к этому разделу.', 403);
  }
  return user;
}

export async function requirePermissionUser(
  permission: Permission,
  level: PermissionLevel = 'view',
): Promise<DbUser | NextResponse> {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  if (!userHasPermission(user, permission, level)) {
    return jsonError(
      level === 'edit'
        ? 'Недостаточно прав для изменения в этом разделе.'
        : 'Недостаточно прав для доступа к этому разделу.',
      403,
    );
  }
  return user;
}

export { BLOCKED_MESSAGE };
