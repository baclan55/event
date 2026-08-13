import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser, invalidateUserCache, jsonError, loadUserById, publicUser } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { findBlacklistMatch, isValidStaticId } from '@/lib/blacklist';
import { requiresLastName, validateGameProfileInput } from '@/lib/profileGame';
import { ACHIEVEMENT_TRIGGERS } from '@/lib/achievementsShared';
import {
  evaluateAchievementsForUser,
  listAchievements,
  listUserAchievements,
} from '@/lib/achievements';
import { ok, parseId, required, requiredPerm } from './helpers';
import type { ApiHandler } from './types';

export const handlePortalExtra: ApiHandler = async ({ key, params, method, body }) => {
  // ---- игровой профиль ----
  if (key === 'profile-game') {
    const user = await required(undefined, { allowIncompleteProfile: true });
    if (user instanceof NextResponse) return user;
    if (method === 'GET') {
      const pending = await query(
        `SELECT id, first_name, last_name, static_id, status, created_at
         FROM profile_change_requests WHERE user_id=$1 AND status='pending' ORDER BY created_at DESC LIMIT 1`,
        [user.id],
      ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
      const pub = publicUser(await loadUserById(user.id));
      return NextResponse.json({
        user: pub,
        pending: pending.rows[0] || null,
        requireLastName: requiresLastName({
          isEventHelper: pub?.isEventHelper,
          isAdministrator: pub?.isAdministrator,
        }),
      });
    }
    if (method !== 'PUT') return jsonError('Метод не поддерживается.', 405);
    const pub = publicUser(user);
    const needLast = requiresLastName({
      isEventHelper: !!user.is_event_helper,
      isAdministrator: !!user.is_administrator,
    });
    const validated = validateGameProfileInput(
      {
        firstName: String(body.firstName || ''),
        lastName: String(body.lastName || ''),
        staticId: String(body.staticId || ''),
      },
      { requireLastName: needLast },
    );
    if (!validated.ok) return jsonError(validated.error, 400);

    const hit = await findBlacklistMatch({
      userId: user.id,
      discordId: user.discord_id,
      staticId: validated.staticId,
    });
    if (hit) return jsonError('Указанный StaticID находится в чёрном списке.', 403);

    const hasProfile = !!(user.first_name && user.static_id && (!needLast || user.last_name));
    if (!hasProfile) {
      await query(
        'UPDATE users SET first_name=$1, last_name=$2, static_id=$3 WHERE id=$4',
        [validated.firstName, validated.lastName || null, validated.staticId, user.id],
      );
      await writeAudit({
        actorId: user.id,
        action: 'profile.game.fill',
        entityType: 'user',
        entityId: user.id,
        details: { firstName: validated.firstName, staticId: validated.staticId },
      });
      invalidateUserCache(user.id);
      return ok({ user: publicUser(await loadUserById(user.id)), moderated: false });
    }

    await query(
      `UPDATE profile_change_requests SET status='cancelled'
       WHERE user_id=$1 AND status='pending'`,
      [user.id],
    ).catch(() => undefined);
    await query(
      `INSERT INTO profile_change_requests(user_id, first_name, last_name, static_id)
       VALUES($1,$2,$3,$4)`,
      [user.id, validated.firstName, validated.lastName || null, validated.staticId],
    );
    await writeAudit({
      actorId: user.id,
      action: 'profile.game.request',
      entityType: 'user',
      entityId: user.id,
      details: { firstName: validated.firstName, staticId: validated.staticId },
    });
    return ok({ moderated: true });
  }

  if (key === 'profile-moderation') {
    const user = await requiredPerm('moderate_profile');
    if (user instanceof NextResponse) return user;
    if (method === 'GET') {
      const result = await query(
        `SELECT p.*, u.nickname, u.discord_username
         FROM profile_change_requests p
         JOIN users u ON u.id = p.user_id
         WHERE p.status='pending'
         ORDER BY p.created_at ASC`,
      );
      return NextResponse.json({ requests: result.rows });
    }
    if (method === 'PUT') {
      const id = parseId(String(body.id || params.id || ''));
      const status = String(body.status || '');
      if (!['approved', 'rejected'].includes(status)) return jsonError('Некорректный статус.', 400);
      const rows = await query<Record<string, unknown>>(
        'SELECT * FROM profile_change_requests WHERE id=$1',
        [id],
      );
      const req = rows.rows[0];
      if (!req || req.status !== 'pending') return jsonError('Заявка не найдена.', 404);
      if (status === 'approved') {
        await query(
          'UPDATE users SET first_name=$1, last_name=$2, static_id=$3 WHERE id=$4',
          [req.first_name, req.last_name, req.static_id, req.user_id],
        );
        invalidateUserCache(req.user_id as number);
      }
      await query(
        `UPDATE profile_change_requests
         SET status=$1, reviewed_by=$2, reviewed_at=now(), reject_reason=$3 WHERE id=$4`,
        [status, user.id, String(body.reason || ''), id],
      );
      await writeAudit({
        actorId: user.id,
        action: `profile.game.${status}`,
        entityType: 'profile_change',
        entityId: id,
        details: { userId: req.user_id },
      });
      return ok();
    }
  }

  // ---- blacklist ----
  if (key === 'blacklist' || key === 'blacklist-item') {
    if (key === 'blacklist' && method === 'GET') {
      const user = await requiredPerm('manage_blacklist');
      if (user instanceof NextResponse) return user;
      const result = await query(
        `SELECT b.*, u.nickname AS user_nickname, c.nickname AS created_by_nickname
         FROM blacklist b
         LEFT JOIN users u ON u.id = b.user_id
         LEFT JOIN users c ON c.id = b.created_by
         ORDER BY b.created_at DESC`,
      );
      return NextResponse.json({ items: result.rows });
    }
    const user = await requiredPerm('manage_blacklist');
    if (user instanceof NextResponse) return user;
    if (key === 'blacklist' && method === 'POST') {
      const discordId = String(body.discordId || '').trim() || null;
      const staticId = String(body.staticId || '').trim() || null;
      const userId = body.userId != null ? Number(body.userId) : null;
      const reason = String(body.reason || '').trim();
      if (!userId && !discordId && !staticId) {
        return jsonError('Укажите пользователя, Discord ID или StaticID.', 400);
      }
      if (staticId && !isValidStaticId(staticId)) {
        return jsonError('StaticID: только цифры, 2–6 символов.', 400);
      }
      const inserted = await query<{ id: number }>(
        `INSERT INTO blacklist(user_id, discord_id, static_id, reason, created_by)
         VALUES($1,$2,$3,$4,$5) RETURNING id`,
        [userId, discordId, staticId, reason, user.id],
      );
      // Все незакрытые заявки с этими идентификаторами — сразу в отказ.
      await query(
        `UPDATE applications SET status='rejected', reject_reason='Пользователь находится в ЧС'
         WHERE status IN ('pending','approved')
           AND (
             ($1::int IS NOT NULL AND (applicant_id=$1 OR candidate_user_id=$1))
             OR ($2::text IS NOT NULL AND discord=$2)
             OR ($3::text IS NOT NULL AND static_id=$3)
           )`,
        [userId, discordId, staticId],
      ).catch(() => undefined);
      await writeAudit({
        actorId: user.id,
        action: 'blacklist.create',
        entityType: 'blacklist',
        entityId: inserted.rows[0].id,
        details: { userId, discordId, staticId, reason },
      });
      return ok({ id: inserted.rows[0].id });
    }
    if (key === 'blacklist-item' && method === 'DELETE') {
      await query('DELETE FROM blacklist WHERE id=$1', [parseId(params.id)]);
      await writeAudit({
        actorId: user.id,
        action: 'blacklist.delete',
        entityType: 'blacklist',
        entityId: params.id,
      });
      return ok();
    }
  }

  // ---- achievements ----
  if (key === 'achievements' || key === 'achievement' || key === 'achievements-me' || key === 'achievements-user') {
    if (key === 'achievements-me') {
      const user = await required();
      if (user instanceof NextResponse) return user;
      await evaluateAchievementsForUser(user.id).catch(() => undefined);
      return NextResponse.json({ achievements: await listUserAchievements(user.id) });
    }
    if (key === 'achievements-user') {
      const user = await required();
      if (user instanceof NextResponse) return user;
      return NextResponse.json({ achievements: await listUserAchievements(parseId(params.userId || params.id)) });
    }
    if (key === 'achievements' && method === 'GET') {
      const viewer = await getCurrentUser();
      const manage = viewer && (viewer.is_owner || (viewer.permissions || []).includes('manage_achievements'));
      return NextResponse.json({
        achievements: await listAchievements(!manage),
        triggers: ACHIEVEMENT_TRIGGERS,
      });
    }
    const user = await requiredPerm('manage_achievements');
    if (user instanceof NextResponse) return user;
    if (key === 'achievements' && method === 'POST') {
      const name = String(body.name || '').trim();
      if (!name) return jsonError('Укажите название.', 400);
      const triggerType = String(body.triggerType || '');
      if (!ACHIEVEMENT_TRIGGERS.includes(triggerType as typeof ACHIEVEMENT_TRIGGERS[number])) {
        return jsonError('Некорректный триггер.', 400);
      }
      const inserted = await query<{ id: number }>(
        `INSERT INTO achievements(name, description, icon, trigger_type, trigger_config, max_grade, active)
         VALUES($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING id`,
        [
          name,
          String(body.description || ''),
          String(body.icon || ''),
          triggerType,
          JSON.stringify(body.triggerConfig || {}),
          Math.max(1, Number(body.maxGrade) || 1),
          body.active !== false,
        ],
      );
      await writeAudit({
        actorId: user.id,
        action: 'achievement.create',
        entityType: 'achievement',
        entityId: inserted.rows[0].id,
        details: { name, triggerType },
      });
      return ok({ id: inserted.rows[0].id });
    }
    if (key === 'achievement' && method === 'PUT') {
      const id = parseId(params.id);
      await query(
        `UPDATE achievements SET name=$1, description=$2, icon=$3, trigger_type=$4,
         trigger_config=$5::jsonb, max_grade=$6, active=$7, updated_at=now() WHERE id=$8`,
        [
          String(body.name || '').trim(),
          String(body.description || ''),
          String(body.icon || ''),
          String(body.triggerType || ''),
          JSON.stringify(body.triggerConfig || {}),
          Math.max(1, Number(body.maxGrade) || 1),
          body.active !== false,
          id,
        ],
      );
      await writeAudit({
        actorId: user.id,
        action: 'achievement.update',
        entityType: 'achievement',
        entityId: id,
      });
      return ok();
    }
    if (key === 'achievement' && method === 'DELETE') {
      await query('DELETE FROM achievements WHERE id=$1', [parseId(params.id)]);
      await writeAudit({
        actorId: user.id,
        action: 'achievement.delete',
        entityType: 'achievement',
        entityId: params.id,
      });
      return ok();
    }
  }

  return undefined;
};
