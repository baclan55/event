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
import { reconcileWeeklyEventCredits } from '@/lib/eventCredits';
import { runtimeEnv } from '@/lib/runtimeEnv';
import { sqlCountWeeklyMpSubquery, weekTimeZone } from '@/lib/weekBounds';
import { weeklyTargetsByRoleId } from '@/lib/weeklyTarget';
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
    const user = publicRequest
      ? await required()
      : await requiredPerm('edit_content', { level: 'edit' });
    if (user instanceof NextResponse) return user;
    if (key === 'roster-roles') {
      const result = await query('SELECT id,name,priority FROM roles ORDER BY priority');
      return NextResponse.json({ roles: result.rows });
    }
    if (key === 'roster' && method === 'GET') {
      const tz = weekTimeZone();
      const weekCountSql = sqlCountWeeklyMpSubquery('u.discord_id', 1);
      const result = await query<Record<string, unknown>>(
        `SELECT u.id,u.nickname,u.discord_id,u.discord_username,u.avatar_image_id,u.avatar_url,
          CASE WHEN u.discord_id IS NULL THEN 0 ELSE COALESCE(${weekCountSql}, 0) END AS weekly_events,
          u.note,u.role_id,u.status,u.is_blocked,u.blocked_at,u.is_owner,u.is_admin,
          r.name role_name,r.priority role_priority, r.weekly_events_target, COALESCE(r.color,'') AS role_color
         FROM users u LEFT JOIN roles r ON r.id=u.role_id
         ORDER BY COALESCE(r.priority,999),u.nickname`,
        [tz],
      );
      const roles = await getRolesForUsers(result.rows.map((row) => row.id as number));
      const targets = await weeklyTargetsByRoleId();
      const allRoles = await query('SELECT id,name,priority,weekly_events_target,COALESCE(color,\'\') AS color FROM roles ORDER BY priority');
      return NextResponse.json({
        members: result.rows.map((row) => ({
          ...row,
          tier: tierForPriority(row.role_priority as number),
          roles: roles.get(row.id as number) || [],
          weekly_target: row.role_id != null ? targets.get(row.role_id as number) ?? null : null,
        })),
        target: null,
        roles: allRoles.rows,
        canGrantOwner: userHasPermission(user, 'grant_owner', 'edit'),
        canEdit: userHasPermission(user, 'edit_content', 'edit'),
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
    const nickname = String(body.nickname || body.firstName || '').trim();
    if (!nickname) return jsonError('Укажите имя участника.', 400);
    const roleIds = Array.isArray(body.roleIds) ? body.roleIds.map(Number).filter(Number.isFinite) : body.roleId ? [Number(body.roleId)] : [];
    const discordIdRaw = body.discordId != null ? String(body.discordId).replace(/\D/g, '') : '';
    const discordId = discordIdRaw || null;
    if (discordId && !/^\d{17,20}$/.test(discordId)) {
      return jsonError('Некорректный Discord ID (17–20 цифр).', 400);
    }

    if (key === 'roster') {
      if (!discordId) return jsonError('Укажите Discord ID.', 400);
      const assignError = await assertAssignableRoles(user, roleIds);
      if (assignError) return jsonError(assignError, 403);
      const taken = await query<{ id: number }>('SELECT id FROM users WHERE discord_id=$1', [discordId]);
      if (taken.rows[0]) return jsonError('Этот Discord ID уже привязан к другому участнику.', 400);
      const result = await query<{ id: number }>(
        'INSERT INTO users(nickname,weekly_events,note,discord_id) VALUES($1,$2,$3,$4) RETURNING id',
        [nickname, Number(body.weeklyEvents) || 0, String(body.note || ''), discordId],
      );
      if (roleIds.length) {
        const bl = await assertNotBlacklisted(result.rows[0].id, roleIds);
        if (bl) return jsonError(bl, 403);
        await replaceUserRoles(result.rows[0].id, roleIds);
        await evaluateAchievementsForUser(result.rows[0].id).catch(() => undefined);
      }
      await reconcileWeeklyEventCredits(
        query,
        discordId,
        runtimeEnv('WEEKLY_RESET_TZ') || 'Europe/Moscow',
      ).catch(() => undefined);
      await writeAudit({
        actorId: user.id,
        action: 'user.create',
        entityType: 'user',
        entityId: result.rows[0].id,
        details: { nickname, roleIds, discordId },
      });
      return ok({ id: result.rows[0].id });
    }

    const targetId = parseId(params.id);
    const target = await query<{
      is_owner: boolean;
      role_priority: number | null;
      discord_id: string | null;
    }>(
      `SELECT u.is_owner, u.discord_id, r.priority AS role_priority
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
      if (!userHasPermission(user, 'grant_owner', 'edit')) {
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

    const prevDiscordId = String(target.rows[0].discord_id || '').trim() || null;
    // Discord ID обязателен и не очищается пустым полем формы.
    let nextDiscordId = prevDiscordId;
    if (body.discordId !== undefined) {
      if (discordId) {
        nextDiscordId = discordId;
      } else if (!prevDiscordId) {
        return jsonError('Укажите Discord ID.', 400);
      }
      // пустая строка при уже заполненном ID — оставляем прежний
    }
    if (!nextDiscordId) return jsonError('Укажите Discord ID.', 400);

    if (nextDiscordId !== prevDiscordId) {
      const taken = await query<{ id: number }>(
        'SELECT id FROM users WHERE discord_id=$1 AND id<>$2',
        [nextDiscordId, targetId],
      );
      if (taken.rows[0]) return jsonError('Этот Discord ID уже привязан к другому участнику.', 400);
      await query('UPDATE users SET discord_id=$1 WHERE id=$2', [nextDiscordId, targetId]);
    }
    await query(
      `UPDATE users SET nickname=$1,
       weekly_events=COALESCE($2::integer,weekly_events), note=$3 WHERE id=$4`,
      [
        nickname,
        Number.isFinite(Number(body.weeklyEvents)) ? Number(body.weeklyEvents) : null,
        String(body.note || ''),
        targetId,
      ],
    );
    await replaceUserRoles(targetId, roleIds);
    await evaluateAchievementsForUser(targetId).catch(() => undefined);
    await reconcileWeeklyEventCredits(
      query,
      nextDiscordId,
      runtimeEnv('WEEKLY_RESET_TZ') || 'Europe/Moscow',
    ).catch(() => undefined);
    await writeAudit({
      actorId: user.id,
      action: Array.isArray(body.roleIds) || body.roleId != null ? 'roles.update' : 'user.update',
      entityType: 'user',
      entityId: params.id,
      details: {
        nickname,
        roleIds,
        discordId: nextDiscordId,
        isOwner: typeof body.isOwner === 'boolean' ? body.isOwner : undefined,
      },
    });
    invalidateUserCache(params.id);
    return ok();
  }

  return undefined;
};
