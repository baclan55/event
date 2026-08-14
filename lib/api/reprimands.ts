import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { invalidateUserCache, jsonError } from '@/lib/auth';
import { tierForPriority } from '@/lib/tier';
import { getRolesForUsers } from '@/lib/roles';
import { writeAudit } from '@/lib/audit';
import {
  LIMITS_PAYLOAD,
  syncBlockStatus,
  maybeConvertVerbalToStrict,
  adminPointActive,
  helperActivePoints,
  ADMIN_POINT_DECAY_DAYS,
  ADMIN_POINT_LIMIT,
  HELPER_BLOCK_POINTS,
} from '@/lib/reprimandRules';
import { userHasPermission } from '@/lib/roleAccess';
import { ok, parseId, required, requiredPerm } from './helpers';
import type { ApiHandler } from './types';
import type { DbUser } from '@/lib/auth';

function canPunish(actor: DbUser, targetPriority: number | null | undefined): boolean {
  if (actor.is_owner) return true;
  if (actor.role_priority == null || targetPriority == null) return false;
  // Меньший priority = выше. Равные и ниже по иерархии наказывать нельзя.
  return actor.role_priority < targetPriority;
}

async function assertCanPunishUser(actor: DbUser, targetUserId: number) {
  const target = await query<{
    is_owner: boolean;
    role_priority: number | null;
    nickname: string;
  }>(
    `SELECT u.is_owner, r.priority AS role_priority, u.nickname
     FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=$1`,
    [targetUserId],
  );
  if (!target.rows[0]) return jsonError('Участник не найден.', 404);
  if (target.rows[0].is_owner) return jsonError('Нельзя наказывать владельца.', 403);
  if (!canPunish(actor, target.rows[0].role_priority)) {
    return jsonError('Нельзя наказывать сотрудника с равной или более высокой ролью.', 403);
  }
  return null;
}

function active<T extends Record<string, unknown>>(
  rows: T[],
): Array<T & { active: boolean; expires_at: string | null }> {
  return rows.map((row) => ({
    ...row,
    active: row.type === 'point'
      ? adminPointActive(row.created_at as string)
      : !(row.type === 'verbal' && row.converted),
    expires_at: row.type === 'point'
      ? new Date(new Date(row.created_at as string).getTime() + ADMIN_POINT_DECAY_DAYS * 864e5).toISOString()
      : null,
  }));
}

export const handleReprimands: ApiHandler = async ({ key, params, method, body }) => {
  if (!key.startsWith('reprimand')) return undefined;

  if (key === 'reprimands-me') {
    const user = await required();
    if (user instanceof NextResponse) return user;
    const result = await query<Record<string, unknown>>(
      `SELECT rp.id, rp.reason, rp.type, rp.created_at, rp.converted, rp.auto_generated,
        ib.nickname AS issued_by_nickname FROM reprimands rp LEFT JOIN users ib ON ib.id = rp.issued_by
        WHERE rp.user_id=$1 ORDER BY rp.created_at DESC`,
      [user.id],
    );
    return NextResponse.json({
      reprimands: active(result.rows),
      tier: tierForPriority(user.role_priority),
      isBlocked: !!user.is_blocked,
      blockedAt: user.blocked_at,
      limits: LIMITS_PAYLOAD,
    });
  }
  if (key === 'reprimands-user') {
    const user = await requiredPerm('reprimands');
    if (user instanceof NextResponse) return user;
    const userId = parseId(params.userId);
    const userResult = await query<Record<string, unknown>>(
      `SELECT u.id, u.nickname, u.discord_username, u.avatar_image_id, u.avatar_url,
        u.weekly_events, u.is_blocked, u.blocked_at, u.role_id, r.name AS role_name, r.priority AS role_priority
        FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=$1`,
      [userId],
    );
    if (!userResult.rows[0]) return jsonError('Участник не найден.', 404);
    const roles = await getRolesForUsers([userId]);
    const result = await query<Record<string, unknown>>(
      `SELECT rp.id, rp.reason, rp.type, rp.created_at, rp.converted, rp.auto_generated,
        ib.nickname AS issued_by_nickname FROM reprimands rp LEFT JOIN users ib ON ib.id=rp.issued_by
        WHERE rp.user_id=$1 ORDER BY rp.created_at DESC`,
      [userId],
    );
    return NextResponse.json({
      user: {
        ...userResult.rows[0],
        roles: roles.get(userId) || [],
        tier: tierForPriority(userResult.rows[0].role_priority as number),
      },
      reprimands: active(result.rows),
      limits: LIMITS_PAYLOAD,
    });
  }
  if (key === 'reprimands-unblock') {
    const user = await requiredPerm('reprimands', { level: 'edit' });
    if (user instanceof NextResponse) return user;
    const denied = await assertCanPunishUser(user, parseId(params.userId));
    if (denied) return denied;
    await query('UPDATE users SET is_blocked=FALSE, blocked_at=NULL WHERE id=$1', [parseId(params.userId)]);
    await writeAudit({
      actorId: user.id,
      action: 'reprimand.unblock',
      entityType: 'user',
      entityId: params.userId,
    });
    invalidateUserCache(params.userId);
    return ok();
  }
  if (key === 'reprimand' && method === 'DELETE') {
    const user = await requiredPerm('reprimands', { level: 'edit' });
    if (user instanceof NextResponse) return user;
    const { rows } = await query<{ user_id: number; type: string; reason: string; auto_generated: boolean }>(
      'SELECT user_id, type, reason, auto_generated FROM reprimands WHERE id=$1',
      [parseId(params.id)],
    );
    const target = rows[0];
    if (target) {
      const denied = await assertCanPunishUser(user, target.user_id);
      if (denied) return denied;
    }
    if (target?.auto_generated && target.type === 'strict') {
      await query('UPDATE reprimands SET converted=FALSE WHERE merged_into=$1', [parseId(params.id)]);
    }
    await query('DELETE FROM reprimands WHERE id=$1', [parseId(params.id)]);
    await writeAudit({
      actorId: user.id,
      action: 'reprimand.delete',
      entityType: 'reprimand',
      entityId: params.id,
      details: target ? { userId: target.user_id, type: target.type, reason: target.reason } : {},
    });
    if (target) {
      await syncBlockStatus(target.user_id);
      invalidateUserCache(target.user_id);
    }
    return ok();
  }

  const user = await requiredPerm('reprimands', { level: method === 'GET' ? 'view' : 'edit' });
  if (user instanceof NextResponse) return user;
  if (method === 'GET') {
    const result = await query<Record<string, unknown>>(
      `SELECT rp.id, rp.reason, rp.type, rp.created_at, rp.converted, rp.auto_generated,
        u.id AS user_id, u.nickname AS user_nickname, u.avatar_image_id, u.avatar_url, u.is_blocked, u.blocked_at,
        rr.name AS role_name, rr.priority AS role_priority, ib.nickname AS issued_by_nickname
        FROM reprimands rp JOIN users u ON u.id=rp.user_id LEFT JOIN roles rr ON rr.id=u.role_id
        LEFT JOIN users ib ON ib.id=rp.issued_by ORDER BY rp.created_at DESC`,
    );
    const members = await query<Record<string, unknown>>(
      `SELECT u.id, u.nickname, u.is_blocked, r.name AS role_name, r.priority AS role_priority
        FROM users u LEFT JOIN roles r ON r.id=u.role_id
        WHERE u.status='member' OR u.role_id IS NOT NULL ORDER BY u.nickname`,
    );
    return NextResponse.json({
      reprimands: active(result.rows).map((row) => ({
        ...row,
        tier: tierForPriority(row.role_priority as number),
      })),
      members: members.rows.map((row) => ({
        ...row,
        tier: tierForPriority(row.role_priority as number),
      })),
      limits: LIMITS_PAYLOAD,
      canEdit: userHasPermission(user, 'reprimands', 'edit'),
    });
  }

  const userId = Number(body.userId);
  const reason = String(body.reason || '').trim();
  let type = String(body.type || '').trim();
  if (!userId || !reason) return jsonError('Укажите участника и причину.', 400);
  const target = await query<{
    id: number;
    is_blocked: boolean;
    is_owner: boolean;
    status: string;
    role_priority: number | null;
  }>(
    `SELECT u.id, u.is_blocked, u.is_owner, u.status, r.priority AS role_priority
      FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=$1`,
    [userId],
  );
  if (!target.rows[0]) return jsonError('Участник не найден.', 404);
  if (target.rows[0].is_owner) return jsonError('Нельзя выдать выговор владельцу.', 403);
  if (target.rows[0].status !== 'member') {
    return jsonError('Выговор можно выдать только действующему сотруднику.', 400);
  }
  if (target.rows[0].is_blocked) return jsonError('Участник уже заблокирован.', 400);
  const targetPriority = target.rows[0].role_priority;
  if (!canPunish(user, targetPriority)) {
    return jsonError('Нельзя выдать выговор сотруднику с равной или более высокой ролью.', 403);
  }
  const tier = tierForPriority(targetPriority);
  let reprimandId: number;
  if (tier === 'admin') {
    type = 'point';
    const count = await query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM reprimands WHERE user_id=$1 AND type='point' AND created_at > now() - make_interval(days => $2)`,
      [userId, ADMIN_POINT_DECAY_DAYS],
    );
    if (count.rows[0].c >= ADMIN_POINT_LIMIT) {
      return jsonError('Лимит баллов администратора исчерпан.', 400);
    }
    const inserted = await query<{ id: number }>('INSERT INTO reprimands(user_id,reason,type,issued_by) VALUES($1,$2,$3,$4) RETURNING id', [
      userId,
      reason,
      type,
      user.id,
    ]);
    reprimandId = inserted.rows[0].id;
  } else {
    if (type !== 'verbal' && type !== 'strict') {
      return jsonError('Тип выговора: verbal или strict.', 400);
    }
    const all = await query<{ type: string; converted: boolean }>(
      'SELECT type, converted FROM reprimands WHERE user_id=$1',
      [userId],
    );
    if (helperActivePoints(all.rows) >= HELPER_BLOCK_POINTS) {
      return jsonError('Участник уже набрал лимит баллов.', 400);
    }
    const inserted = await query<{ id: number }>('INSERT INTO reprimands(user_id,reason,type,issued_by) VALUES($1,$2,$3,$4) RETURNING id', [
      userId,
      reason,
      type,
      user.id,
    ]);
    reprimandId = inserted.rows[0].id;
    if (type === 'verbal') await maybeConvertVerbalToStrict(userId, user.id);
  }
  await writeAudit({
    actorId: user.id,
    action: 'reprimand.create',
    entityType: 'reprimand',
    entityId: reprimandId,
    details: {
      userId,
      type,
      reason,
      nickname: (await query<{ nickname: string }>('SELECT nickname FROM users WHERE id=$1', [userId])).rows[0]?.nickname,
    },
  });
  const status = await syncBlockStatus(userId);
  invalidateUserCache(userId);
  return ok({ blocked: status?.blocked });
};
