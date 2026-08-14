import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { invalidateUserCache, jsonError } from '@/lib/auth';
import {
  defaultPermissionsForRoleName,
  normalizeRolePermissions,
  PERMISSIONS,
  userHasPermission,
} from '@/lib/roleAccess';
import {
  DASHBOARD_BLOCKS,
  defaultRoleMetaForName,
  normalizeDashboardBlocks,
  normalizeRoleColor,
  parseRoleMeta,
} from '@/lib/roleMeta';
import { parseWeeklyTarget } from '@/lib/weeklyTarget';
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
    is_event_helper: boolean;
    is_administrator: boolean;
    include_in_helper_payouts: boolean;
    color: string;
    dashboard_blocks: unknown;
    weekly_events_target: number | null;
    users_count: number;
    mp_rate_mc: number | string | null;
    mp_rate_dollars: number | string | null;
    gmp_rate_mc: number | string | null;
    gmp_rate_dollars: number | string | null;
    fixed_mc: number | string | null;
    fixed_dollars: number | string | null;
  }>(
    `SELECT r.id, r.name, r.priority,
            COALESCE(r.permissions, '{}'::jsonb) AS permissions,
            COALESCE(r.is_event_helper, FALSE) AS is_event_helper,
            COALESCE(r.is_administrator, FALSE) AS is_administrator,
            COALESCE(r.include_in_helper_payouts, FALSE) AS include_in_helper_payouts,
            COALESCE(r.color, '') AS color,
            COALESCE(r.dashboard_blocks, '{"stats":true,"top_admin":true,"top_helper":true}'::jsonb) AS dashboard_blocks,
            r.weekly_events_target,
            COUNT(ur.user_id)::int AS users_count,
            COALESCE(s.mp_rate_mc, 0) AS mp_rate_mc,
            COALESCE(s.mp_rate_dollars, 0) AS mp_rate_dollars,
            COALESCE(s.gmp_rate_mc, 0) AS gmp_rate_mc,
            COALESCE(s.gmp_rate_dollars, 0) AS gmp_rate_dollars,
            COALESCE(s.fixed_mc, 0) AS fixed_mc,
            COALESCE(s.fixed_dollars, 0) AS fixed_dollars
     FROM roles r
     LEFT JOIN user_roles ur ON ur.role_id = r.id
     LEFT JOIN payout_role_settings s ON s.role_id = r.id
     GROUP BY r.id, s.mp_rate_mc, s.mp_rate_dollars, s.gmp_rate_mc, s.gmp_rate_dollars, s.fixed_mc, s.fixed_dollars
     ORDER BY r.priority ASC, r.id ASC`,
  );
  return result.rows.map((row) => {
    const raw = row.permissions && Object.keys(row.permissions).length
      ? row.permissions
      : defaultPermissionsForRoleName(row.name);
    const meta = parseRoleMeta(row);
    const defaults = defaultRoleMetaForName(row.name);
    const explicitMeta = row.is_event_helper || row.is_administrator
      || row.include_in_helper_payouts
      || !!row.color
      || (row.dashboard_blocks && typeof row.dashboard_blocks === 'object'
        && Object.keys(row.dashboard_blocks as object).length > 0);
    const money = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n) : 0;
    };
    return {
      id: row.id,
      name: row.name,
      priority: row.priority,
      permissions: normalizeRolePermissions(raw),
      isEventHelper: explicitMeta ? meta.isEventHelper : defaults.isEventHelper,
      isAdministrator: explicitMeta ? meta.isAdministrator : defaults.isAdministrator,
      includeInHelperPayouts: explicitMeta ? meta.includeInHelperPayouts : defaults.includeInHelperPayouts,
      color: explicitMeta ? meta.color : defaults.color,
      dashboardBlocks: explicitMeta ? meta.dashboardBlocks : defaults.dashboardBlocks,
      weeklyEventsTarget: parseWeeklyTarget(row.weekly_events_target),
      usersCount: row.users_count,
      mpRateMc: money(row.mp_rate_mc),
      mpRateDollars: money(row.mp_rate_dollars),
      gmpRateMc: money(row.gmp_rate_mc),
      gmpRateDollars: money(row.gmp_rate_dollars),
      fixedMc: money(row.fixed_mc),
      fixedDollars: money(row.fixed_dollars),
    };
  });
}

function readPayoutRates(body: Record<string, unknown>) {
  const money = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  };
  return {
    mpRateMc: money(body.mpRateMc ?? body.mp_rate_mc),
    mpRateDollars: money(body.mpRateDollars ?? body.mp_rate_dollars),
    gmpRateMc: money(body.gmpRateMc ?? body.gmp_rate_mc),
    gmpRateDollars: money(body.gmpRateDollars ?? body.gmp_rate_dollars),
    fixedMc: money(body.fixedMc ?? body.fixed_mc),
    fixedDollars: money(body.fixedDollars ?? body.fixed_dollars),
  };
}

async function upsertPayoutRates(
  roleId: number,
  rates: ReturnType<typeof readPayoutRates>,
) {
  await query(
    `INSERT INTO payout_role_settings (
       role_id, mp_rate_mc, mp_rate_dollars, gmp_rate_mc, gmp_rate_dollars,
       fixed_mc, fixed_dollars, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7, now())
     ON CONFLICT (role_id) DO UPDATE SET
       mp_rate_mc = EXCLUDED.mp_rate_mc,
       mp_rate_dollars = EXCLUDED.mp_rate_dollars,
       gmp_rate_mc = EXCLUDED.gmp_rate_mc,
       gmp_rate_dollars = EXCLUDED.gmp_rate_dollars,
       fixed_mc = EXCLUDED.fixed_mc,
       fixed_dollars = EXCLUDED.fixed_dollars,
       updated_at = now()`,
    [
      roleId,
      rates.mpRateMc,
      rates.mpRateDollars,
      rates.gmpRateMc,
      rates.gmpRateDollars,
      rates.fixedMc,
      rates.fixedDollars,
    ],
  );
}

function readMeta(body: Record<string, unknown>, name: string) {
  const defaults = defaultRoleMetaForName(name);
  return {
    isEventHelper: typeof body.isEventHelper === 'boolean' ? body.isEventHelper : defaults.isEventHelper,
    isAdministrator: typeof body.isAdministrator === 'boolean' ? body.isAdministrator : defaults.isAdministrator,
    includeInHelperPayouts:
      typeof body.includeInHelperPayouts === 'boolean'
        ? body.includeInHelperPayouts
        : defaults.includeInHelperPayouts,
    color: normalizeRoleColor(
      body.color != null ? body.color : defaults.color,
    ),
    dashboardBlocks: normalizeDashboardBlocks(body.dashboardBlocks ?? defaults.dashboardBlocks),
  };
}

export const handleRoles: ApiHandler = async ({ key, request, params, method, body }) => {
  if (key === 'audit') {
    const user = await requiredPerm('view_audit', { allowIncompleteProfile: true });
    if (user instanceof NextResponse) return user;
    const sp = request.nextUrl.searchParams;
    const userIdRaw = sp.get('userId');
    const userId = userIdRaw && /^\d+$/.test(userIdRaw) ? Number(userIdRaw) : null;
    const [audit, actions] = await Promise.all([
      listAudit({
        limit: 150,
        action: sp.get('action'),
        actor: sp.get('actor'),
        userId,
        from: sp.get('from'),
        to: sp.get('to'),
      }),
      listAuditActions(),
    ]);
    return NextResponse.json({ audit, actions, labels: AUDIT_LABELS });
  }

  if (key !== 'roles' && key !== 'role' && key !== 'roles-reorder') return undefined;

  if (key === 'roles' && method === 'GET') {
    const user = await requiredPerm('manage_roles');
    if (user instanceof NextResponse) return user;
    return NextResponse.json({
      roles: await listRoles(),
      permissionKeys: PERMISSIONS,
      dashboardBlocks: DASHBOARD_BLOCKS,
      canEdit: userHasPermission(user, 'manage_roles', 'edit'),
    });
  }

  const user = await requiredPerm('manage_roles', { level: 'edit' });
  if (user instanceof NextResponse) return user;

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
    if (!userHasPermission(user, 'grant_owner', 'edit')) {
      permissions.grant_owner = { view: false, edit: false };
    }
    const meta = readMeta(body, name);
    const weeklyEventsTarget = parseWeeklyTarget(body.weeklyEventsTarget);
    const payoutRates = readPayoutRates(body);
    const max = await query<{ m: number | null }>('SELECT MAX(priority) AS m FROM roles');
    const priority = (max.rows[0]?.m || 0) + 1;
    try {
      const inserted = await query<{ id: number }>(
        `INSERT INTO roles(name, priority, permissions, is_event_helper, is_administrator, include_in_helper_payouts, color, dashboard_blocks, weekly_events_target)
         VALUES($1,$2,$3::jsonb,$4,$5,$6,$7,$8::jsonb,$9) RETURNING id`,
        [
          name,
          priority,
          JSON.stringify(permissions),
          meta.isEventHelper,
          meta.isAdministrator,
          meta.includeInHelperPayouts,
          meta.color,
          JSON.stringify(meta.dashboardBlocks),
          weeklyEventsTarget,
        ],
      );
      await upsertPayoutRates(inserted.rows[0].id, payoutRates);
      await writeAudit({
        actorId: user.id,
        action: 'role.create',
        entityType: 'role',
        entityId: inserted.rows[0].id,
        details: { name, permissions, weeklyEventsTarget, payoutRates, ...meta },
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
    if (!userHasPermission(user, 'grant_owner', 'edit')) {
      const prev = await query<{ permissions: unknown }>(
        "SELECT COALESCE(permissions, '{}'::jsonb) AS permissions FROM roles WHERE id=$1",
        [id],
      );
      permissions.grant_owner = normalizeRolePermissions(prev.rows[0]?.permissions).grant_owner;
    }
    const unsafe = await assertRolePermissionChangeSafe(user, id, permissions);
    if (unsafe) return jsonError(unsafe, 400);
    const meta = readMeta(body, name);
    const weeklyEventsTarget = parseWeeklyTarget(body.weeklyEventsTarget);
    const payoutRates = readPayoutRates(body);
    try {
      await query(
        `UPDATE roles SET name=$1, permissions=$2::jsonb,
         is_event_helper=$3, is_administrator=$4, include_in_helper_payouts=$5, color=$6,
         dashboard_blocks=$7::jsonb, weekly_events_target=$8 WHERE id=$9`,
        [
          name,
          JSON.stringify(permissions),
          meta.isEventHelper,
          meta.isAdministrator,
          meta.includeInHelperPayouts,
          meta.color,
          JSON.stringify(meta.dashboardBlocks),
          weeklyEventsTarget,
          id,
        ],
      );
      await upsertPayoutRates(id, payoutRates);
      await writeAudit({
        actorId: user.id,
        action: 'role.update',
        entityType: 'role',
        entityId: id,
        details: { name, permissions, weeklyEventsTarget, payoutRates, ...meta },
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
