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
  listProfileAchievementCatalog,
  listUserAchievements,
} from '@/lib/achievements';
import { userHasEventCap, userHasPermission, userHasProfileViewCap } from '@/lib/roleAccess';
import { sqlInCurrentWeek, weekTimeZone } from '@/lib/weekBounds';
import { abandonStaleOpenGathers } from '@/lib/discordGatherCleanup';
import { dedupeDiscordGathers } from '@/lib/discordGatherDedupe';
import { saveImage } from '@/lib/images';
import { ok, parseId, readImage, required, requiredPerm } from './helpers';
import type { ApiHandler } from './types';

export const handlePortalExtra: ApiHandler = async ({ key, params, method, body, request }) => {
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

    const hasProfile = !!(user.game_profile_confirmed
      && user.first_name
      && user.static_id
      && (!needLast || user.last_name));
    if (!hasProfile) {
      await query(
        `UPDATE users SET first_name=$1, last_name=$2, static_id=$3, nickname=$1,
         game_profile_confirmed=TRUE WHERE id=$4`,
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
    if (method === 'GET') {
      const user = await requiredPerm('moderate_profile');
      if (user instanceof NextResponse) return user;
      const result = await query(
        `SELECT p.*,
                u.nickname,
                u.discord_username,
                r.nickname AS reviewer_nickname
         FROM profile_change_requests p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN users r ON r.id = p.reviewed_by
         WHERE p.status IN ('pending', 'approved', 'rejected')
         ORDER BY
           CASE p.status WHEN 'pending' THEN 0 ELSE 1 END,
           CASE WHEN p.status = 'pending' THEN p.created_at END ASC NULLS LAST,
           COALESCE(p.reviewed_at, p.created_at) DESC`,
      );
      return NextResponse.json({
        requests: result.rows,
        canEdit: userHasPermission(user, 'moderate_profile', 'edit'),
      });
    }
    if (method === 'PUT') {
      const user = await requiredPerm('moderate_profile', { level: 'edit' });
      if (user instanceof NextResponse) return user;
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
          'UPDATE users SET first_name=$1, last_name=$2, static_id=$3, nickname=$1 WHERE id=$4',
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
    const snap = (row: {
      discord_id?: string | null;
      static_id?: string | null;
      reason?: string | null;
      created_by?: number | null;
    }) => ({
      discord_id: row.discord_id || null,
      static_id: row.static_id || null,
      reason: row.reason || '',
      created_by: row.created_by ?? null,
    });

    const resolveLinkedUserId = async (discordId: string | null, staticId: string | null) => {
      const found = await query<{ id: number }>(
        `SELECT id FROM users
         WHERE ($1::text IS NOT NULL AND discord_id = $1)
            OR ($2::text IS NOT NULL AND static_id = $2)
         ORDER BY id ASC LIMIT 1`,
        [discordId, staticId],
      ).catch(() => ({ rows: [] as { id: number }[] }));
      return found.rows[0]?.id ?? null;
    };

    const rejectMatchingApps = async (
      userId: number | null,
      discordId: string | null,
      staticId: string | null,
    ) => {
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
    };

    const writeHistory = async (
      blacklistId: number,
      actorId: number,
      action: 'create' | 'update' | 'delete',
      details: Record<string, unknown>,
    ) => {
      await query(
        `INSERT INTO blacklist_history(blacklist_id, actor_id, action, details)
         VALUES($1,$2,$3,$4::jsonb)`,
        [blacklistId, actorId, action, JSON.stringify(details)],
      ).catch(() => undefined);
    };

    if (key === 'blacklist' && method === 'GET') {
      const user = await requiredPerm('manage_blacklist');
      if (user instanceof NextResponse) return user;
      const result = await query(
        `SELECT b.*,
                u.nickname AS user_nickname,
                c.nickname AS created_by_nickname,
                (
                  SELECT COUNT(*)::int FROM blacklist_history h WHERE h.blacklist_id = b.id
                ) AS history_count
         FROM blacklist b
         LEFT JOIN users u ON u.id = b.user_id
         LEFT JOIN users c ON c.id = b.created_by
         ORDER BY b.created_at DESC`,
      );
      return NextResponse.json({
        items: result.rows,
        canEdit: userHasPermission(user, 'manage_blacklist', 'edit'),
        isOwner: !!user.is_owner,
      });
    }

    if (key === 'blacklist-item' && method === 'GET') {
      const user = await requiredPerm('manage_blacklist');
      if (user instanceof NextResponse) return user;
      const id = parseId(params.id);
      const item = await query(
        `SELECT b.*,
                u.nickname AS user_nickname,
                c.nickname AS created_by_nickname
         FROM blacklist b
         LEFT JOIN users u ON u.id = b.user_id
         LEFT JOIN users c ON c.id = b.created_by
         WHERE b.id=$1`,
        [id],
      );
      if (!item.rows[0]) return jsonError('Запись не найдена.', 404);
      const history = await query(
        `SELECT h.id, h.action, h.details, h.created_at,
                a.nickname AS actor_nickname
         FROM blacklist_history h
         LEFT JOIN users a ON a.id = h.actor_id
         WHERE h.blacklist_id=$1
         ORDER BY h.created_at DESC, h.id DESC`,
        [id],
      ).catch(() => ({ rows: [] }));
      return NextResponse.json({
        item: item.rows[0],
        history: history.rows,
        canEdit: userHasPermission(user, 'manage_blacklist', 'edit'),
        isOwner: !!user.is_owner,
      });
    }

    const user = await requiredPerm('manage_blacklist', { level: 'edit' });
    if (user instanceof NextResponse) return user;

    if (key === 'blacklist' && method === 'POST') {
      const discordId = String(body.discordId || '').trim() || null;
      const staticId = String(body.staticId || '').trim() || null;
      const reason = String(body.reason || '').trim();
      if (!discordId && !staticId) {
        return jsonError('Укажите Discord ID и/или StaticID.', 400);
      }
      if (discordId && !/^\d{17,20}$/.test(discordId)) {
        return jsonError('Discord ID: 17–20 цифр.', 400);
      }
      if (staticId && !isValidStaticId(staticId)) {
        return jsonError('StaticID: только цифры, 2–6 символов.', 400);
      }

      let createdBy = user.id;
      if (body.createdBy != null && body.createdBy !== '') {
        if (!user.is_owner) {
          return jsonError('Добавлять от чужого имени может только владелец.', 403);
        }
        const onBehalf = Number(body.createdBy);
        if (!Number.isFinite(onBehalf) || onBehalf <= 0) {
          return jsonError('Некорректный пользователь «от имени».', 400);
        }
        const exists = await query<{ id: number }>('SELECT id FROM users WHERE id=$1', [onBehalf]);
        if (!exists.rows[0]) return jsonError('Пользователь «от имени» не найден.', 400);
        createdBy = onBehalf;
      }

      const linkedUserId = await resolveLinkedUserId(discordId, staticId);
      const inserted = await query<{ id: number }>(
        `INSERT INTO blacklist(user_id, discord_id, static_id, reason, created_by, updated_at)
         VALUES($1,$2,$3,$4,$5,now()) RETURNING id`,
        [linkedUserId, discordId, staticId, reason, createdBy],
      );
      const newId = inserted.rows[0].id;
      await rejectMatchingApps(linkedUserId, discordId, staticId);
      await writeHistory(newId, user.id, 'create', {
        after: snap({ discord_id: discordId, static_id: staticId, reason, created_by: createdBy }),
        attributed_to: createdBy,
        recorded_by: user.id,
      });
      await writeAudit({
        actorId: user.id,
        action: 'blacklist.create',
        entityType: 'blacklist',
        entityId: newId,
        details: { discordId, staticId, reason, createdBy, linkedUserId },
      });
      return ok({ id: newId });
    }

    if (key === 'blacklist-item' && method === 'PATCH') {
      const id = parseId(params.id);
      const existing = await query<{
        id: number;
        user_id: number | null;
        discord_id: string | null;
        static_id: string | null;
        reason: string;
        created_by: number | null;
      }>('SELECT * FROM blacklist WHERE id=$1', [id]);
      const prev = existing.rows[0];
      if (!prev) return jsonError('Запись не найдена.', 404);

      const discordId = body.discordId !== undefined
        ? (String(body.discordId || '').trim() || null)
        : (prev.discord_id || null);
      const staticId = body.staticId !== undefined
        ? (String(body.staticId || '').trim() || null)
        : (prev.static_id || null);
      const reason = body.reason !== undefined
        ? String(body.reason || '').trim()
        : (prev.reason || '');

      if (!discordId && !staticId) {
        return jsonError('Укажите Discord ID и/или StaticID.', 400);
      }
      if (discordId && !/^\d{17,20}$/.test(discordId)) {
        return jsonError('Discord ID: 17–20 цифр.', 400);
      }
      if (staticId && !isValidStaticId(staticId)) {
        return jsonError('StaticID: только цифры, 2–6 символов.', 400);
      }

      let createdBy = prev.created_by;
      if (body.createdBy != null && body.createdBy !== '' && user.is_owner) {
        const onBehalf = Number(body.createdBy);
        if (Number.isFinite(onBehalf) && onBehalf > 0) {
          const exists = await query<{ id: number }>('SELECT id FROM users WHERE id=$1', [onBehalf]);
          if (!exists.rows[0]) return jsonError('Пользователь «от имени» не найден.', 400);
          createdBy = onBehalf;
        }
      }

      const linkedUserId = await resolveLinkedUserId(discordId, staticId);
      const before = snap(prev);
      const after = snap({
        discord_id: discordId,
        static_id: staticId,
        reason,
        created_by: createdBy,
      });

      await query(
        `UPDATE blacklist SET
           user_id=$2, discord_id=$3, static_id=$4, reason=$5,
           created_by=COALESCE($6, created_by), updated_at=now()
         WHERE id=$1`,
        [id, linkedUserId, discordId, staticId, reason, createdBy],
      );
      await rejectMatchingApps(linkedUserId, discordId, staticId);
      await writeHistory(id, user.id, 'update', { before, after });
      await writeAudit({
        actorId: user.id,
        action: 'blacklist.update',
        entityType: 'blacklist',
        entityId: id,
        details: { before, after },
      });
      return ok();
    }

    if (key === 'blacklist-item' && method === 'DELETE') {
      const id = parseId(params.id);
      await query('DELETE FROM blacklist WHERE id=$1', [id]);
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
  if (key === 'achievements-icon' && method === 'POST') {
    const user = await requiredPerm('manage_achievements', { level: 'edit' });
    if (user instanceof NextResponse) return user;
    const image = await readImage(request);
    if (!image || image instanceof Error) {
      return jsonError(image?.message || 'Файл не получен.', 400);
    }
    const imageId = await saveImage(image);
    return ok({ imageId, url: `/media/${imageId}` });
  }

  if (key === 'achievements' || key === 'achievement' || key === 'achievements-me' || key === 'achievements-user') {
    if (key === 'achievements-me') {
      const user = await required();
      if (user instanceof NextResponse) return user;
      await evaluateAchievementsForUser(user.id).catch(() => undefined);
      const catalog = await listProfileAchievementCatalog(user.id, user.id);
      return NextResponse.json({
        ...catalog,
        achievements: catalog.earned,
      });
    }
    if (key === 'achievements-user') {
      const user = await required();
      if (user instanceof NextResponse) return user;
      const targetId = parseId(params.userId || params.id);
      if (user.id !== targetId && !userHasProfileViewCap(user, 'achievements')) {
        return jsonError('Недостаточно прав для просмотра достижений профиля.', 403);
      }
      await evaluateAchievementsForUser(targetId).catch(() => undefined);
      const catalog = await listProfileAchievementCatalog(targetId, user.id);
      return NextResponse.json({
        ...catalog,
        achievements: catalog.earned,
      });
    }
    if (key === 'achievements' && method === 'GET') {
      const viewer = await getCurrentUser();
      const manage = !!(viewer && userHasPermission(viewer, 'manage_achievements'));
      return NextResponse.json({
        achievements: await listAchievements(!manage),
        triggers: ACHIEVEMENT_TRIGGERS,
        canEdit: !!(viewer && userHasPermission(viewer, 'manage_achievements', 'edit')),
      });
    }
    const user = await requiredPerm('manage_achievements', { level: 'edit' });
    if (user instanceof NextResponse) return user;
    if (key === 'achievements' && method === 'POST') {
      const name = String(body.name || '').trim();
      if (!name) return jsonError('Укажите название.', 400);
      const triggerType = String(body.triggerType || '');
      if (!ACHIEVEMENT_TRIGGERS.includes(triggerType as typeof ACHIEVEMENT_TRIGGERS[number])) {
        return jsonError('Некорректный триггер.', 400);
      }
      const gradeIcons = Array.isArray(body.gradeIcons)
        ? body.gradeIcons.map((item: unknown) => String(item || '').trim())
        : [];
      const inserted = await query<{ id: number }>(
        `INSERT INTO achievements(name, description, icon, grade_icons, trigger_type, trigger_config, max_grade, active, is_hidden)
         VALUES($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7,$8,$9) RETURNING id`,
        [
          name,
          String(body.description || ''),
          String(body.icon || gradeIcons[0] || ''),
          JSON.stringify(gradeIcons),
          triggerType,
          JSON.stringify(body.triggerConfig || {}),
          Math.max(1, Number(body.maxGrade) || 1),
          body.active !== false,
          body.isHidden === true || body.is_hidden === true,
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
      const gradeIcons = Array.isArray(body.gradeIcons)
        ? body.gradeIcons.map((item: unknown) => String(item || '').trim())
        : [];
      await query(
        `UPDATE achievements SET name=$1, description=$2, icon=$3, grade_icons=$4::jsonb,
         trigger_type=$5, trigger_config=$6::jsonb, max_grade=$7, active=$8, is_hidden=$9, updated_at=now()
         WHERE id=$10`,
        [
          String(body.name || '').trim(),
          String(body.description || ''),
          String(body.icon || gradeIcons[0] || ''),
          JSON.stringify(gradeIcons),
          String(body.triggerType || ''),
          JSON.stringify(body.triggerConfig || {}),
          Math.max(1, Number(body.maxGrade) || 1),
          body.active !== false,
          body.isHidden === true || body.is_hidden === true,
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

  if (key === 'discord-events-user' && method === 'GET') {
    const viewer = await required();
    if (viewer instanceof NextResponse) return viewer;
    const userId = parseId(params.userId);
    if (!userId) return jsonError('Некорректный пользователь.', 400);
    if (viewer.id !== userId && !userHasProfileViewCap(viewer, 'events')) {
      return jsonError('Недостаточно прав для просмотра мероприятий профиля.', 403);
    }
    await abandonStaleOpenGathers();
    const tz = weekTimeZone();
    const pageSizeRaw = Number.parseInt(String(request.nextUrl.searchParams.get('pageSize') || '10'), 10);
    const pageSize = Number.isFinite(pageSizeRaw) ? Math.min(Math.max(pageSizeRaw, 5), 50) : 10;
    const pageRaw = Number.parseInt(String(request.nextUrl.searchParams.get('page') || '1'), 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

    const [totalRow, week] = await Promise.all([
      query<{ count: string }>(
        `SELECT COUNT(DISTINCT e.message_id)::text AS count
         FROM discord_gather_participants p
         JOIN discord_gather_events e ON e.message_id = p.message_id
         JOIN users u ON u.discord_id = p.discord_id
         WHERE u.id = $1
           AND u.discord_id IS NOT NULL
           AND e.status = 'completed'`,
        [userId],
      ),
      query<{ count: string }>(
        `SELECT COUNT(DISTINCT e.message_id)::text AS count
         FROM discord_gather_participants p
         JOIN discord_gather_events e ON e.message_id = p.message_id
         JOIN users u ON u.discord_id = p.discord_id
         WHERE u.id = $1
           AND u.discord_id IS NOT NULL
           AND e.status = 'completed'
           AND ${sqlInCurrentWeek('e.message_created_at', 2)}`,
        [userId, tz],
      ).catch(() => ({ rows: [{ count: '0' }] })),
    ]);
    const total = Number(totalRow.rows[0]?.count || 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    const result = await query<{
      message_id: string;
      event_key: string | null;
      title: string;
      message_created_at: string;
      status: string;
      completed_at: string | null;
    }>(
      `SELECT * FROM (
         SELECT DISTINCT ON (e.message_id)
                e.message_id, e.event_key, e.title, e.message_created_at, e.status, e.completed_at
         FROM discord_gather_participants p
         JOIN discord_gather_events e ON e.message_id = p.message_id
         JOIN users u ON u.discord_id = p.discord_id
         WHERE u.id = $1
           AND u.discord_id IS NOT NULL
           AND e.status = 'completed'
         ORDER BY e.message_id, e.message_created_at DESC
       ) x
       ORDER BY x.message_created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, pageSize, offset],
    );

    return NextResponse.json({
      ok: true,
      items: result.rows,
      weekCount: Number(week.rows[0]?.count || 0),
      totalCount: total,
      page: safePage,
      pageSize,
      totalPages,
    });
  }

  if (key === 'discord-events' && method === 'POST') {
    const user = await required();
    if (user instanceof NextResponse) return user;
    if (!userHasEventCap(user, 'delete')) return jsonError('Недостаточно прав.', 403);
    const action = String(body.action || '').trim();
    if (action !== 'dedupe') return jsonError('Неизвестное действие.', 400);
    const stats = await dedupeDiscordGathers();
    await writeAudit({
      actorId: user.id,
      action: 'discord_event.dedupe',
      entityType: 'discord_gather_event',
      details: stats,
    });
    return ok({
      removed: stats.byMessageId + stats.byTitleDay,
      ...stats,
    });
  }

  if (key === 'discord-events' && method === 'GET') {
    const user = await required();
    if (user instanceof NextResponse) return user;
    if (!userHasPermission(user, 'manage_events')) {
      return jsonError('Недостаточно прав.', 403);
    }
    await abandonStaleOpenGathers();
    const status = String(request.nextUrl.searchParams.get('status') || 'completed').trim();
    const allowed = new Set(['completed', 'open', 'abandoned', 'all']);
    const filter = allowed.has(status) ? status : 'completed';
    const q = String(request.nextUrl.searchParams.get('q') || '').trim();
    const pageSizeRaw = Number.parseInt(String(request.nextUrl.searchParams.get('pageSize') || '20'), 10);
    const pageSize = Number.isFinite(pageSizeRaw) ? Math.min(Math.max(pageSizeRaw, 5), 50) : 20;
    const pageRaw = Number.parseInt(String(request.nextUrl.searchParams.get('page') || '1'), 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const searchSql = q
      ? `AND (
           e.title ILIKE '%' || $2 || '%'
           OR COALESCE(e.event_key, '') ILIKE '%' || $2 || '%'
           OR e.message_id ILIKE '%' || $2 || '%'
           OR EXISTS (
             SELECT 1 FROM discord_gather_participants p
             LEFT JOIN users u ON u.discord_id = p.discord_id
             WHERE p.message_id = e.message_id
               AND (
                 p.discord_id ILIKE '%' || $2 || '%'
                 OR COALESCE(p.discord_username, '') ILIKE '%' || $2 || '%'
                 OR COALESCE(u.nickname, '') ILIKE '%' || $2 || '%'
                 OR COALESCE(u.first_name, '') ILIKE '%' || $2 || '%'
               )
           )
         )`
      : '';
    const countParams: unknown[] = q ? [filter, q] : [filter];
    const totalRow = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM discord_gather_events e
       WHERE ($1::text = 'all' OR e.status = $1)
       ${searchSql}`,
      countParams,
    );
    const total = Number(totalRow.rows[0]?.count || 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;
    const listParams: unknown[] = q
      ? [filter, q, pageSize, offset]
      : [filter, pageSize, offset];
    const limitSql = q ? 'LIMIT $3 OFFSET $4' : 'LIMIT $2 OFFSET $3';
    const events = await query<{
      message_id: string;
      event_key: string | null;
      title: string;
      message_created_at: string;
      status: string;
      completed_at: string | null;
      abandoned_at: string | null;
      participant_count: string;
    }>(
      `SELECT e.message_id, e.event_key, e.title, e.message_created_at, e.status,
              e.completed_at, e.abandoned_at,
              (SELECT COUNT(*)::text FROM discord_gather_participants p WHERE p.message_id=e.message_id) AS participant_count
       FROM discord_gather_events e
       WHERE ($1::text = 'all' OR e.status = $1)
       ${searchSql}
       ORDER BY e.message_created_at DESC
       ${limitSql}`,
      listParams,
    );
    const ids = events.rows.map((e) => e.message_id);
    type ParticipantRow = {
      message_id: string;
      discord_id: string;
      nickname: string | null;
      user_id: number | null;
      avatar_image_id: number | null;
      avatar_url: string | null;
      discord_username: string | null;
      role_name: string | null;
      on_site: boolean;
    };
    const participants = ids.length
      ? await query<ParticipantRow>(
        `SELECT p.message_id, p.discord_id,
                COALESCE(NULLIF(TRIM(u.first_name), ''), u.nickname, p.discord_username) AS nickname,
                u.id AS user_id, u.avatar_image_id, u.avatar_url,
                COALESCE(u.discord_username, p.discord_username) AS discord_username,
                r.name AS role_name,
                (u.id IS NOT NULL) AS on_site
         FROM discord_gather_participants p
         LEFT JOIN users u ON u.discord_id = p.discord_id
         LEFT JOIN roles r ON r.id = u.role_id
         WHERE p.message_id = ANY($1::text[])
         ORDER BY (u.id IS NULL), u.nickname NULLS LAST, p.discord_id`,
        [ids],
      )
      : { rows: [] as ParticipantRow[] };

    const byMessage = new Map<string, ParticipantRow[]>();
    for (const row of participants.rows) {
      const list = byMessage.get(row.message_id) || [];
      list.push(row);
      byMessage.set(row.message_id, list);
    }

    const job = await query<{
      id: number;
      status: string;
      created_at: string;
      started_at: string | null;
      finished_at: string | null;
      result: unknown;
      error: string | null;
    }>(
      `SELECT id, status, created_at, started_at, finished_at, result, error
       FROM event_bot_jobs
       WHERE kind='resync'
       ORDER BY created_at DESC
       LIMIT 1`,
    ).catch(() => ({ rows: [] as Array<{
      id: number;
      status: string;
      created_at: string;
      started_at: string | null;
      finished_at: string | null;
      result: unknown;
      error: string | null;
    }> }));

    const canResync = !!user.is_owner || userHasPermission(user, 'manage_roles', 'edit');
    return NextResponse.json({
      ok: true,
      canResync,
      caps: {
        editParticipants: userHasEventCap(user, 'edit_participants'),
        editStatus: userHasEventCap(user, 'edit_status'),
        delete: userHasEventCap(user, 'delete'),
      },
      page: safePage,
      pageSize,
      total,
      totalPages,
      resyncJob: job.rows[0] || null,
      events: events.rows.map((e) => ({
        ...e,
        participants: byMessage.get(e.message_id) || [],
      })),
    });
  }

  if (key === 'discord-events' && method === 'PATCH') {
    const user = await required();
    if (user instanceof NextResponse) return user;
    if (!userHasPermission(user, 'manage_events')) {
      return jsonError('Недостаточно прав.', 403);
    }
    const messageId = String(body.messageId || '').trim();
    if (!messageId) return jsonError('Не указано мероприятие.', 400);
    const action = String(body.action || '').trim();

    if (action === 'setStatus') {
      if (!userHasEventCap(user, 'edit_status')) return jsonError('Недостаточно прав.', 403);
      const nextStatus = String(body.status || '').trim();
      if (!['open', 'completed', 'abandoned'].includes(nextStatus)) {
        return jsonError('Некорректный статус.', 400);
      }
      const updated = await query(
        `UPDATE discord_gather_events SET
           status=$2,
           completed_at=CASE WHEN $2='completed' THEN COALESCE(completed_at, now()) ELSE completed_at END,
           abandoned_at=CASE WHEN $2='abandoned' THEN COALESCE(abandoned_at, now()) ELSE abandoned_at END,
           has_buttons=CASE WHEN $2='open' THEN TRUE ELSE FALSE END,
           updated_at=now()
         WHERE message_id=$1
         RETURNING message_id, status`,
        [messageId, nextStatus],
      );
      if (!updated.rows[0]) return jsonError('Мероприятие не найдено.', 404);
      await writeAudit({
        actorId: user.id,
        action: 'discord_event.status',
        entityType: 'discord_gather_event',
        entityId: messageId,
        details: { status: nextStatus },
      });
      return ok({ event: updated.rows[0] });
    }

    if (action === 'addParticipant' || action === 'removeParticipant') {
      if (!userHasEventCap(user, 'edit_participants')) return jsonError('Недостаточно прав.', 403);
      const discordId = String(body.discordId || '').replace(/\D/g, '');
      if (!discordId) return jsonError('Укажите Discord ID.', 400);
      const exists = await query('SELECT message_id FROM discord_gather_events WHERE message_id=$1', [messageId]);
      if (!exists.rows[0]) return jsonError('Мероприятие не найдено.', 404);
      if (action === 'addParticipant') {
        const known = await query<{ discord_username: string | null }>(
          'SELECT discord_username FROM users WHERE discord_id=$1',
          [discordId],
        );
        await query(
          `INSERT INTO discord_gather_participants(message_id, discord_id, discord_username)
           VALUES ($1, $2, $3)
           ON CONFLICT (message_id, discord_id) DO UPDATE SET
             discord_username = COALESCE(EXCLUDED.discord_username, discord_gather_participants.discord_username)`,
          [messageId, discordId, known.rows[0]?.discord_username || null],
        );
      } else {
        await query(
          'DELETE FROM discord_gather_participants WHERE message_id=$1 AND discord_id=$2',
          [messageId, discordId],
        );
      }
      await writeAudit({
        actorId: user.id,
        action: action === 'addParticipant' ? 'discord_event.participant_add' : 'discord_event.participant_remove',
        entityType: 'discord_gather_event',
        entityId: messageId,
        details: { discordId },
      });
      return ok();
    }

    return jsonError('Неизвестное действие.', 400);
  }

  if (key === 'discord-events' && method === 'DELETE') {
    const user = await required();
    if (user instanceof NextResponse) return user;
    if (!userHasEventCap(user, 'delete')) return jsonError('Недостаточно прав.', 403);
    const messageId = String(body.messageId || request.nextUrl.searchParams.get('messageId') || '').trim();
    if (!messageId) return jsonError('Не указано мероприятие.', 400);
    const deleted = await query(
      'DELETE FROM discord_gather_events WHERE message_id=$1 RETURNING message_id, title',
      [messageId],
    );
    if (!deleted.rows[0]) return jsonError('Мероприятие не найдено.', 404);
    await writeAudit({
      actorId: user.id,
      action: 'discord_event.delete',
      entityType: 'discord_gather_event',
      entityId: messageId,
      details: { title: deleted.rows[0].title },
    });
    return ok();
  }

  if (key === 'discord-events-resync' && method === 'POST') {
    const user = await required();
    if (user instanceof NextResponse) return user;
    if (!user.is_owner && !userHasPermission(user, 'manage_roles', 'edit')) {
      return jsonError('Недостаточно прав.', 403);
    }
    const active = await query<{ id: number; status: string }>(
      `SELECT id, status FROM event_bot_jobs
       WHERE kind='resync' AND status IN ('pending','running')
       ORDER BY created_at DESC LIMIT 1`,
    );
    if (active.rows[0]) {
      return NextResponse.json({
        ok: true,
        alreadyQueued: true,
        job: active.rows[0],
      });
    }
    const inserted = await query<{ id: number; status: string; created_at: string }>(
      `INSERT INTO event_bot_jobs(kind, status, requested_by)
       VALUES ('resync', 'pending', $1)
       RETURNING id, status, created_at`,
      [user.id],
    );
    return NextResponse.json({
      ok: true,
      alreadyQueued: false,
      job: inserted.rows[0],
    });
  }

  return undefined;
};
