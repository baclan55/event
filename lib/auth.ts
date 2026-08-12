import { query } from '@/lib/db';
import { getSession } from '@/lib/session';
import { userHasAnyRole, userHasRoleIn, type RoleUser } from '@/lib/roleAccess';
import { syncBlockStatus } from '@/lib/reprimandRules';
import { NextResponse } from 'next/server';

export type DbRole = { id: number; name: string; priority: number };

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
  roles: DbRole[];
};

const BLOCKED_MESSAGE =
  'Учётная запись заблокирована за превышение лимита выговоров. Обратитесь к руководству отдела для разблокировки.';

const BLOCK_SYNC_TTL_MS = 60_000;
const USER_CACHE_TTL_MS = Number.parseInt(process.env.USER_CACHE_TTL_MS || '30000', 10);

const blockSyncAt = new Map<number, number>();
const userCache = new Map<string, { at: number; user: DbUser }>();

function cloneUser(user: DbUser): DbUser {
  const roles = Array.isArray(user.roles) ? user.roles.map((r) => ({ ...r })) : [];
  return {
    ...user,
    roles,
    roleNames: roles.map((r) => r.name),
  };
}

export function invalidateUserCache(userId?: number | string | null) {
  if (userId == null) {
    userCache.clear();
    return;
  }
  userCache.delete(String(userId));
}

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
  isBlocked: boolean;
  blockedAt: string | null;
};

export function publicUser(u: DbUser | null | undefined): PublicUser | null {
  if (!u) return null;
  return {
    id: u.id,
    nickname: u.nickname,
    discordUsername: u.discord_username,
    avatarImageId: u.avatar_image_id,
    avatarUrl: u.avatar_url,
    isOwner: !!u.is_owner,
    isAdmin: !!u.is_admin,
    weeklyEvents: u.weekly_events,
    roleId: u.role_id,
    roleName: u.role_name,
    rolePriority: u.role_priority != null ? u.role_priority : null,
    roles: (u.roles || []).map((r) => r.name),
    isBlocked: !!u.is_blocked,
    blockedAt: u.blocked_at || null,
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
            u.role_id, r.name AS role_name, r.priority AS role_priority,
            COALESCE(
              (SELECT json_agg(json_build_object('id', rr.id, 'name', rr.name, 'priority', rr.priority)
                               ORDER BY rr.priority ASC)
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

export { BLOCKED_MESSAGE };
