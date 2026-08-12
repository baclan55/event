import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { invalidateUserCache, jsonError } from '@/lib/auth';
import { EDIT_ROLES, OWNER_PANEL_ROLES } from '@/lib/roleAccess';
import { tierForPriority } from '@/lib/tier';
import { getRolesForUsers, replaceUserRoles } from '@/lib/roles';
import { listAudit, writeAudit } from '@/lib/audit';
import { ok, parseId, required } from './helpers';
import type { ApiHandler } from './types';

export const handleRoster: ApiHandler = async ({ key, params, method, body }) => {
  if (key.startsWith('roster')) {
    const publicRequest = (key === 'roster' && method === 'GET') || key === 'roster-roles';
    const user = await required(publicRequest ? undefined : EDIT_ROLES);
    if (user instanceof NextResponse) return user;
    if (key === 'roster-roles') {
      const result = await query('SELECT id,name,priority FROM roles ORDER BY priority');
      return NextResponse.json({ roles: result.rows });
    }
    if (key === 'roster' && method === 'GET') {
      const result = await query<Record<string, unknown>>(
        'SELECT u.id,u.nickname,u.discord_username,u.avatar_image_id,u.avatar_url,u.weekly_events,u.note,u.role_id,u.status,u.is_blocked,u.blocked_at,r.name role_name,r.priority role_priority FROM users u LEFT JOIN roles r ON r.id=u.role_id ORDER BY COALESCE(r.priority,999),u.nickname',
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
      });
    }
    if (key === 'roster-user' && method === 'DELETE') {
      const target = await query<{ is_owner: boolean; nickname: string }>('SELECT is_owner,nickname FROM users WHERE id=$1', [parseId(params.id)]);
      if (target.rows[0]?.is_owner) return jsonError('Нельзя удалить владельца из состава.', 400);
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
    const roleIds = Array.isArray(body.roleIds) ? body.roleIds : body.roleId ? [body.roleId] : [];
    if (key === 'roster') {
      const result = await query<{ id: number }>(
        'INSERT INTO users(nickname,weekly_events,note) VALUES($1,$2,$3) RETURNING id',
        [nickname, Number(body.weeklyEvents) || 0, String(body.note || '')],
      );
      if (roleIds.length) await replaceUserRoles(result.rows[0].id, roleIds as number[]);
      await writeAudit({
        actorId: user.id,
        action: 'user.create',
        entityType: 'user',
        entityId: result.rows[0].id,
        details: { nickname, roleIds },
      });
      return ok({ id: result.rows[0].id });
    }
    await query(
      'UPDATE users SET nickname=$1,weekly_events=COALESCE($2::integer,weekly_events),note=$3 WHERE id=$4',
      [
        nickname,
        Number.isFinite(Number(body.weeklyEvents)) ? Number(body.weeklyEvents) : null,
        String(body.note || ''),
        parseId(params.id),
      ],
    );
    await replaceUserRoles(parseId(params.id), roleIds as number[]);
    await writeAudit({
      actorId: user.id,
      action: 'roles.update',
      entityType: 'user',
      entityId: params.id,
      details: { nickname, roleIds },
    });
    invalidateUserCache(params.id);
    return ok();
  }

  if (key === 'owner-users' || key === 'owner-user') {
    const user = await required(OWNER_PANEL_ROLES);
    if (user instanceof NextResponse) return user;
    if (key === 'owner-users' && method === 'GET') {
      const result = await query<Record<string, unknown>>(
        `SELECT u.id, u.discord_id, u.nickname, u.discord_username, u.avatar_image_id, u.avatar_url,
          u.is_owner, u.is_admin, u.weekly_events, u.role_id, rr.name AS role_name, u.created_at
          FROM users u LEFT JOIN roles rr ON rr.id=u.role_id ORDER BY u.created_at ASC`,
      );
      const rolesMap = await getRolesForUsers(result.rows.map((row) => row.id as number));
      const roleRows = await query('SELECT id, name, priority FROM roles ORDER BY priority ASC');
      const audit = await listAudit(100);
      return NextResponse.json({
        users: result.rows.map((row) => ({ ...row, roles: rolesMap.get(row.id as number) || [] })),
        roles: roleRows.rows,
        audit,
      });
    }
    if (method === 'DELETE') {
      if (String(user.id) === String(params.id)) return jsonError('Нельзя удалить самого себя.', 400);
      const target = await query<{ is_owner: boolean; nickname: string }>('SELECT is_owner,nickname FROM users WHERE id=$1', [parseId(params.id)]);
      if (!target.rows[0]) return jsonError('Пользователь не найден.', 404);
      if (target.rows[0].is_owner) return jsonError('Нельзя удалить владельца.', 400);
      await query('DELETE FROM users WHERE id=$1', [parseId(params.id)]);
      await writeAudit({
        actorId: user.id,
        action: 'user.delete',
        entityType: 'user',
        entityId: params.id,
        details: { nickname: target.rows[0].nickname, source: 'owner' },
      });
      invalidateUserCache(params.id);
      return ok();
    }
    const target = await query<{ is_owner: boolean }>('SELECT is_owner FROM users WHERE id=$1', [parseId(params.id)]);
    if (!target.rows[0]) return jsonError('Пользователь не найден.', 404);
    if (typeof body.isOwner === 'boolean' && body.isOwner !== target.rows[0].is_owner && !user.is_owner) {
      return jsonError('Только владелец может назначать или снимать права владельца.', 403);
    }
    if (String(user.id) === String(params.id) && body.isOwner === false) {
      return jsonError('Нельзя снять права владельца у самого себя.', 400);
    }
    if (typeof body.nickname === 'string' && (!body.nickname.trim() || body.nickname.trim().length > 60)) {
      return jsonError(
        !body.nickname.trim() ? 'Введите никнейм.' : 'Никнейм слишком длинный (максимум 60 символов).',
        400,
      );
    }
    const fields: string[] = [];
    const values: unknown[] = [];
    let index = 1;
    if (typeof body.nickname === 'string' && body.nickname.trim()) {
      fields.push(`nickname=$${index++}`);
      values.push(body.nickname.trim());
    }
    if (typeof body.isAdmin === 'boolean') {
      fields.push(`is_admin=$${index++}`);
      values.push(body.isAdmin);
    }
    if (typeof body.isOwner === 'boolean') {
      fields.push(`is_owner=$${index++}`);
      values.push(body.isOwner);
    }
    if (fields.length) {
      values.push(parseId(params.id));
      await query(`UPDATE users SET ${fields.join(', ')} WHERE id=$${index}`, values);
    }
    if (Array.isArray(body.roleIds)) await replaceUserRoles(parseId(params.id), body.roleIds as number[]);
    await writeAudit({
      actorId: user.id,
      action: Array.isArray(body.roleIds) ? 'roles.update' : 'user.update',
      entityType: 'user',
      entityId: params.id,
      details: {
        roleIds: Array.isArray(body.roleIds) ? body.roleIds : undefined,
        isAdmin: typeof body.isAdmin === 'boolean' ? body.isAdmin : undefined,
        isOwner: typeof body.isOwner === 'boolean' ? body.isOwner : undefined,
      },
    });
    invalidateUserCache(params.id);
    return ok();
  }

  return undefined;
};
