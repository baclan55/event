import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { invalidateUserCache, jsonError } from '@/lib/auth';
import { userHasPermission } from '@/lib/roleAccess';
import { tierForPriority } from '@/lib/tier';
import { getRolesForUsers, replaceUserRoles } from '@/lib/roles';
import { writeAudit } from '@/lib/audit';
import {
  assertAssignableRoles,
  assertCanManageTarget,
  assertSelfRoleChange,
} from '@/lib/hierarchyGuard';
import { findBlacklistMatch } from '@/lib/blacklist';
import { evaluateAchievementsForUser } from '@/lib/achievements';
import { ok, parseId, required, requiredPerm } from './helpers';
import type { ApiHandler } from './types';

async function assertNotBlacklisted(userId: number, roleIds: number[]) {
  if (!roleIds.length) return null;
  const target = await query<{ discord_id: string | null; static_id: string | null }>(
    'SELECT discord_id, static_id FROM users WHERE id=$1',
    [userId],
  );
  const hit = await findBlacklistMatch({
    userId,
    discordId: target.rows[0]?.discord_id,
    staticId: target.rows[0]?.static_id,
  });
  if (hit) return 'Нельзя назначить роли: пользователь в чёрном списке.';
  return null;
}

export const handleRoster: ApiHandler = async ({ key, params, method, body }) => {
  if (key.startsWith('roster')) {
    const publicRequest = (key === 'roster' && method === 'GET') || key === 'roster-roles';
    const user = publicRequest ? await required() : await requiredPerm('edit_content');
    if (user instanceof NextResponse) return user;
    if (key === 'roster-roles') {
      const result = await query('SELECT id,name,priority FROM roles ORDER BY priority');
      return NextResponse.json({ roles: result.rows });
    }
    if (key === 'roster' && method === 'GET') {
      const result = await query<Record<string, unknown>>(
        `SELECT u.id,u.nickname,u.discord_username,u.avatar_image_id,u.avatar_url,u.weekly_events,
          u.note,u.role_id,u.status,u.is_blocked,u.blocked_at,u.is_owner,u.is_admin,
          r.name role_name,r.priority role_priority
         FROM users u LEFT JOIN roles r ON r.id=u.role_id
         ORDER BY COALESCE(r.priority,999),u.nickname`,
      );
      const roles = await getRolesForUsers(result.rows.map((row) => row.id as number));
      const allRoles = await query('SELECT id,name,priority FROM roles ORDER BY priority');
      return NextResponse.json({
        members: result.rows.map((row) => ({
          ...row,
          tier: tierForPriority(row.role_priority as number),
          roles: roles.get(row.id as number) || [],
        })),
        target: Number(process.env.WEEKLY_EVENTS_TARGET) || 5,
        roles: allRoles.rows,
        canGrantOwner: userHasPermission(user, 'grant_owner'),
        actorRolePriority: user.role_priority,
        actorIsOwner: !!user.is_owner,
      });
    }
    if (key === 'roster-user' && method === 'DELETE') {
      const target = await query<{ is_owner: boolean; nickname: string; role_priority: number | null }>(
        `SELECT u.is_owner, u.nickname, r.priority AS role_priority
         FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=$1`,
        [parseId(params.id)],
      );
      if (target.rows[0]?.is_owner) return jsonError('Нельзя удалить владельца из состава.', 400);
      const manageError = await assertCanManageTarget(user, target.rows[0]?.role_priority);
      if (manageError) return jsonError(manageError, 403);
      await query('DELETE FROM users WHERE id=$1', [parseId(params.id)]);
      await writeAudit({
        actorId: user.id,
        action: 'user.delete',
        entityType: 'user',
        entityId: params.id,
        details: { nickname: target.rows[0]?.nickname, source: 'roster' },
      });
      invalidateUserCache(params.id);
      return ok();
    }
    const nickname = String(body.nickname || '').trim();
    if (!nickname) return jsonError('Укажите никнейм участника.', 400);
    const roleIds = Array.isArray(body.roleIds) ? body.roleIds.map(Number).filter(Number.isFinite) : body.roleId ? [Number(body.roleId)] : [];

    if (key === 'roster') {
      const assignError = await assertAssignableRoles(user, roleIds);
      if (assignError) return jsonError(assignError, 403);
      const result = await query<{ id: number }>(
        'INSERT INTO users(nickname,weekly_events,note) VALUES($1,$2,$3) RETURNING id',
        [nickname, Number(body.weeklyEvents) || 0, String(body.note || '')],
      );
      if (roleIds.length) {
        const bl = await assertNotBlacklisted(result.rows[0].id, roleIds);
        if (bl) return jsonError(bl, 403);
        await replaceUserRoles(result.rows[0].id, roleIds);
        await evaluateAchievementsForUser(result.rows[0].id).catch(() => undefined);
      }
      await writeAudit({
        actorId: user.id,
        action: 'user.create',
        entityType: 'user',
        entityId: result.rows[0].id,
        details: { nickname, roleIds },
      });
      return ok({ id: result.rows[0].id });
    }

    const targetId = parseId(params.id);
    const target = await query<{ is_owner: boolean; role_priority: number | null }>(
      `SELECT u.is_owner, r.priority AS role_priority
       FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=$1`,
      [targetId],
    );
    if (!target.rows[0]) return jsonError('Участник не найден.', 404);

    if (targetId !== user.id) {
      const manageError = await assertCanManageTarget(user, target.rows[0].role_priority);
      if (manageError) return jsonError(manageError, 403);
      const assignError = await assertAssignableRoles(user, roleIds);
      if (assignError) return jsonError(assignError, 403);
    } else {
      const assignError = await assertAssignableRoles(user, roleIds, { allowCurrentOwnRoles: true });
      if (assignError) return jsonError(assignError, 403);
      const selfError = await assertSelfRoleChange(user, roleIds);
      if (selfError) return jsonError(selfError, 400);
    }

    if (typeof body.isOwner === 'boolean') {
      if (!userHasPermission(user, 'grant_owner')) {
        return jsonError('Недостаточно прав для выдачи права владельца.', 403);
      }
      if (String(user.id) === String(targetId) && body.isOwner === false) {
        return jsonError('Нельзя снять права владельца у самого себя.', 400);
      }
      await query('UPDATE users SET is_owner=$1, is_admin=CASE WHEN $1 THEN TRUE ELSE is_admin END WHERE id=$2', [
        body.isOwner,
        targetId,
      ]);
    }

    const bl = await assertNotBlacklisted(targetId, roleIds);
    if (bl) return jsonError(bl, 403);

    await query(
      'UPDATE users SET nickname=$1,weekly_events=COALESCE($2::integer,weekly_events),note=$3 WHERE id=$4',
      [
        nickname,
        Number.isFinite(Number(body.weeklyEvents)) ? Number(body.weeklyEvents) : null,
        String(body.note || ''),
        targetId,
      ],
    );
    await replaceUserRoles(targetId, roleIds);
    await evaluateAchievementsForUser(targetId).catch(() => undefined);
    await writeAudit({
      actorId: user.id,
      action: Array.isArray(body.roleIds) || body.roleId != null ? 'roles.update' : 'user.update',
      entityType: 'user',
      entityId: params.id,
      details: {
        nickname,
        roleIds,
        isOwner: typeof body.isOwner === 'boolean' ? body.isOwner : undefined,
      },
    });
    invalidateUserCache(params.id);
    return ok();
  }

  return undefined;
};
