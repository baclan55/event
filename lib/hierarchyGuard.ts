import { query } from '@/lib/db';
import {
  permissionsFromRole,
  type Permission,
  type RolePermissions,
} from '@/lib/roleAccess';
import type { DbUser } from '@/lib/auth';

type RoleRow = {
  id: number;
  name: string;
  priority: number;
  permissions: RolePermissions | Record<string, boolean> | null;
};

async function loadRolesByIds(roleIds: number[]): Promise<RoleRow[]> {
  if (!roleIds.length) return [];
  const { rows } = await query<RoleRow>(
    `SELECT id, name, priority, COALESCE(permissions, '{}'::jsonb) AS permissions
     FROM roles WHERE id = ANY($1::int[])`,
    [roleIds],
  );
  return rows;
}

export async function permissionsForRoleIds(
  roleIds: number[],
  override?: { roleId: number; permissions: RolePermissions },
): Promise<Permission[]> {
  const roles = await loadRolesByIds(roleIds);
  const set = new Set<Permission>();
  for (const role of roles) {
    const raw = override && override.roleId === role.id ? override.permissions : role.permissions;
    for (const perm of permissionsFromRole(role.name, raw)) set.add(perm);
  }
  return [...set];
}

export async function assertAssignableRoles(
  actor: DbUser,
  roleIds: number[],
  options?: { allowCurrentOwnRoles?: boolean },
) {
  if (actor.is_owner || !roleIds.length) return null;
  if (actor.role_priority == null) {
    return 'Недостаточно прав для назначения ролей.';
  }
  const ownRoleIds = new Set((actor.roles || []).map((role) => role.id));
  const roles = await loadRolesByIds(roleIds);
  for (const role of roles) {
    if (options?.allowCurrentOwnRoles && ownRoleIds.has(role.id)) continue;
    if (role.priority <= actor.role_priority) {
      return `Нельзя назначить роль «${role.name}» — она равна или выше вашей в иерархии.`;
    }
  }
  return null;
}

export async function assertCanManageTarget(actor: DbUser, targetPriority: number | null | undefined) {
  if (actor.is_owner) return null;
  if (actor.role_priority == null) return 'Недостаточно прав для управления сотрудником.';
  if (targetPriority != null && targetPriority <= actor.role_priority) {
    return 'Нельзя управлять сотрудником с равной или более высокой ролью.';
  }
  return null;
}

/** Проверка: после смены своих ролей актор не теряет критичные доступы и не опускается ниже подчинённых. */
export async function assertSelfRoleChange(
  actor: DbUser,
  nextRoleIds: number[],
): Promise<string | null> {
  if (actor.is_owner) return null;

  const nextPerms = await permissionsForRoleIds(nextRoleIds);
  for (const critical of ['manage_roles', 'grant_owner'] as const) {
    const had = Array.isArray(actor.permissions) && actor.permissions.includes(critical);
    if (had && !nextPerms.includes(critical)) {
      return critical === 'manage_roles'
        ? 'Нельзя снять у себя последний доступ к управлению ролями.'
        : 'Нельзя снять у себя последний доступ к выдаче права владельца.';
    }
  }

  const roles = await loadRolesByIds(nextRoleIds);
  const nextBest = roles.length ? Math.min(...roles.map((r) => r.priority)) : null;
  if (
    actor.role_priority != null
    && nextBest != null
    && nextBest > actor.role_priority
  ) {
    const between = await query<{ c: number }>(
      `SELECT COUNT(*)::int AS c
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id <> $1
         AND r.priority > $2
         AND r.priority <= $3`,
      [actor.id, actor.role_priority, nextBest],
    );
    if (between.rows[0].c > 0) {
      return 'Нельзя понизить свою роль ниже сотрудников, которыми вы сейчас управляете.';
    }
  }
  return null;
}

/** После правки прав роли актор не должен потерять manage_roles / grant_owner. */
export async function assertRolePermissionChangeSafe(
  actor: DbUser,
  roleId: number,
  nextPermissions: RolePermissions,
): Promise<string | null> {
  if (actor.is_owner) return null;
  const myRoleIds = (actor.roles || []).map((r) => r.id);
  if (!myRoleIds.includes(roleId)) return null;

  const nextPerms = await permissionsForRoleIds(myRoleIds, {
    roleId,
    permissions: nextPermissions,
  });
  for (const critical of ['manage_roles', 'grant_owner'] as const) {
    const had = Array.isArray(actor.permissions) && actor.permissions.includes(critical);
    if (had && !nextPerms.includes(critical)) {
      return critical === 'manage_roles'
        ? 'Нельзя снять у себя последний доступ к управлению ролями.'
        : 'Нельзя снять у себя последний доступ к выдаче права владельца.';
    }
  }
  return null;
}

/** Нельзя опустить свою роль в списке ниже текущих подчинённых. */
export async function assertReorderSafe(
  actor: DbUser,
  order: number[],
): Promise<string | null> {
  if (actor.is_owner || actor.role_priority == null) return null;
  const myRoleIds = new Set((actor.roles || []).map((r) => r.id));
  if (!myRoleIds.size) return null;

  let newBest: number | null = null;
  for (let i = 0; i < order.length; i++) {
    if (myRoleIds.has(order[i])) {
      const priority = i + 1;
      if (newBest == null || priority < newBest) newBest = priority;
    }
  }
  if (newBest == null || newBest <= actor.role_priority) return null;

  const between = await query<{ c: number }>(
    `SELECT COUNT(*)::int AS c
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.id <> $1
       AND r.priority > $2
       AND r.priority <= $3`,
    [actor.id, actor.role_priority, newBest],
  );
  if (between.rows[0].c > 0) {
    return 'Нельзя опустить свою роль ниже сотрудников, которыми вы сейчас управляете.';
  }
  return null;
}
