import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { invalidateUserCache, jsonError } from '@/lib/auth';
import {
  defaultPermissionsForRoleName,
  normalizeRolePermissions,
  PERMISSIONS,
  userHasPermission,
} from '@/lib/roleAccess';
import { AUDIT_LABELS, listAudit, listAuditActions, writeAudit } from '@/lib/audit';
import {
  assertReorderSafe,
  assertRolePermissionChangeSafe,
} from '@/lib/hierarchyGuard';
import { ok, parseId, requiredPerm } from './helpers';
import type { ApiHandler } from './types';

async function listRoles() {
  const result = await query<{
    id: number;
    name: string;
    priority: number;
    permissions: Record<string, boolean> | null;
    users_count: number;
  }>(
    `SELECT r.id, r.name, r.priority, COALESCE(r.permissions, '{}'::jsonb) AS permissions,
            COUNT(ur.user_id)::int AS users_count
     FROM roles r
     LEFT JOIN user_roles ur ON ur.role_id = r.id
     GROUP BY r.id
     ORDER BY r.priority ASC, r.id ASC`,
  );
  return result.rows.map((row) => {
    const raw = row.permissions && Object.keys(row.permissions).length
      ? row.permissions
      : defaultPermissionsForRoleName(row.name);
    return {
      id: row.id,
      name: row.name,
      priority: row.priority,
      permissions: normalizeRolePermissions(raw),
      usersCount: row.users_count,
    };
  });
}

export const handleRoles: ApiHandler = async ({ key, request, params, method, body }) => {
  if (key === 'audit') {
    const user = await requiredPerm('view_audit');
    if (user instanceof NextResponse) return user;
    const sp = request.nextUrl.searchParams;
    const [audit, actions] = await Promise.all([
      listAudit({
        limit: 150,
        action: sp.get('action'),
        actor: sp.get('actor'),
        from: sp.get('from'),
        to: sp.get('to'),
      }),
      listAuditActions(),
    ]);
    return NextResponse.json({ audit, actions, labels: AUDIT_LABELS });
  }

  if (key !== 'roles' && key !== 'role' && key !== 'roles-reorder') return undefined;

  const user = await requiredPerm('manage_roles');
  if (user instanceof NextResponse) return user;

  if (key === 'roles' && method === 'GET') {
    return NextResponse.json({
      roles: await listRoles(),
      permissionKeys: PERMISSIONS,
    });
  }

  if (key === 'roles-reorder' && method === 'PUT') {
    const order = Array.isArray(body.order) ? body.order.map(Number).filter(Number.isFinite) : [];
    if (!order.length) return jsonError('Передайте порядок ролей.', 400);
    const reorderError = await assertReorderSafe(user, order);
    if (reorderError) return jsonError(reorderError, 400);
    for (let i = 0; i < order.length; i++) {
      await query('UPDATE roles SET priority=$1 WHERE id=$2', [i + 1, order[i]]);
    }
    await writeAudit({
      actorId: user.id,
      action: 'roles.reorder',
      entityType: 'role',
      details: { order },
    });
    invalidateUserCache();
    return NextResponse.json({ roles: await listRoles() });
  }

  if (key === 'roles' && method === 'POST') {
    const name = String(body.name || '').trim();
    if (!name || name.length > 80) {
      return jsonError(!name ? 'Укажите название роли.' : 'Название слишком длинное.', 400);
    }
    const permissions = normalizeRolePermissions(body.permissions);
    if (!userHasPermission(user, 'grant_owner')) permissions.grant_owner = false;
    const max = await query<{ m: number | null }>('SELECT MAX(priority) AS m FROM roles');
    const priority = (max.rows[0]?.m || 0) + 1;
    try {
      const inserted = await query<{ id: number }>(
        'INSERT INTO roles(name, priority, permissions) VALUES($1,$2,$3::jsonb) RETURNING id',
        [name, priority, JSON.stringify(permissions)],
      );
      await writeAudit({
        actorId: user.id,
        action: 'role.create',
        entityType: 'role',
        entityId: inserted.rows[0].id,
        details: { name, permissions },
      });
      return ok({ id: inserted.rows[0].id, roles: await listRoles() });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        return jsonError('Роль с таким названием уже существует.', 400);
      }
      throw error;
    }
  }

  if (key === 'role' && method === 'PUT') {
    const id = parseId(params.id);
    const existing = await query<{ id: number; name: string }>('SELECT id, name FROM roles WHERE id=$1', [id]);
    if (!existing.rows[0]) return jsonError('Роль не найдена.', 404);
    const name = typeof body.name === 'string' ? body.name.trim() : existing.rows[0].name;
    if (!name || name.length > 80) {
      return jsonError(!name ? 'Укажите название роли.' : 'Название слишком длинное.', 400);
    }
    const permissions = normalizeRolePermissions(body.permissions);
    if (!userHasPermission(user, 'grant_owner')) {
      const prev = await query<{ permissions: Record<string, boolean> }>(
        "SELECT COALESCE(permissions, '{}'::jsonb) AS permissions FROM roles WHERE id=$1",
        [id],
      );
      permissions.grant_owner = !!prev.rows[0]?.permissions?.grant_owner;
    }
    const unsafe = await assertRolePermissionChangeSafe(user, id, permissions);
    if (unsafe) return jsonError(unsafe, 400);
    try {
      await query('UPDATE roles SET name=$1, permissions=$2::jsonb WHERE id=$3', [
        name,
        JSON.stringify(permissions),
        id,
      ]);
      await writeAudit({
        actorId: user.id,
        action: 'role.update',
        entityType: 'role',
        entityId: id,
        details: { name, permissions },
      });
      invalidateUserCache();
      return ok({ roles: await listRoles() });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        return jsonError('Роль с таким названием уже существует.', 400);
      }
      throw error;
    }
  }

  if (key === 'role' && method === 'DELETE') {
    const id = parseId(params.id);
    const existing = await query<{ name: string }>('SELECT name FROM roles WHERE id=$1', [id]);
    if (!existing.rows[0]) return jsonError('Роль не найдена.', 404);
    const used = await query<{ c: number }>(
      'SELECT COUNT(*)::int AS c FROM user_roles WHERE role_id=$1',
      [id],
    );
    if (used.rows[0].c > 0) {
      return jsonError('Нельзя удалить роль, пока она назначена сотрудникам.', 400);
    }
    await query('DELETE FROM roles WHERE id=$1', [id]);
    await writeAudit({
      actorId: user.id,
      action: 'role.delete',
      entityType: 'role',
      entityId: id,
      details: { name: existing.rows[0].name },
    });
    invalidateUserCache();
    return ok({ roles: await listRoles() });
  }

  return jsonError('Метод не поддерживается.', 405);
};
