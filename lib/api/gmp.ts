import { createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { jsonError, type DbUser } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { userHasGmpCap, userHasPermission, userHasProfileViewCap, type GmpCap } from '@/lib/roleAccess';
import { renderBody } from '@/lib/richText';
import { evaluateAchievementsForUser } from '@/lib/achievements';
import { sqlInCurrentWeek, weekTimeZone } from '@/lib/weekBounds';
import { ok, parseId, required } from './helpers';
import type { ApiHandler } from './types';

async function evaluateGmpStaffAchievements(userIds: number[]) {
  const unique = [...new Set(userIds.filter((id) => id > 0))];
  await Promise.all(unique.map((id) => evaluateAchievementsForUser(id).catch(() => undefined)));
}

type StaffRole = 'staff' | 'organizer';
type GmpStatus = 'draft' | 'open' | 'closed';
type Row = Record<string, unknown>;
type WinnerRow = {
  place: number;
  dollars: number;
  mc: number;
  battlePassXp: number;
  staticId: string;
};

function asInt(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function asStaffList(raw: unknown): Array<{ userId: number; role: StaffRole }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ userId: number; role: StaffRole }> = [];
  const seen = new Set<number>();
  for (const item of raw) {
    const row = item as Row;
    const userId = asInt(row.userId ?? row.user_id);
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    const role = String(row.role || 'staff') === 'organizer' ? 'organizer' : 'staff';
    out.push({ userId, role });
  }
  return out;
}

function asCheckpointNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') return String((item as Row).name || '').trim();
      return '';
    })
    .filter(Boolean);
}

function asWinners(raw: unknown): WinnerRow[] {
  if (!Array.isArray(raw)) return [];
  const out: WinnerRow[] = [];
  const seen = new Set<number>();
  for (const item of raw) {
    const row = item as Row;
    const place = asInt(row.place);
    if (place < 1 || seen.has(place)) continue;
    seen.add(place);
    out.push({
      place,
      dollars: Math.max(0, asInt(row.dollars)),
      mc: Math.max(0, asInt(row.mc)),
      battlePassXp: Math.max(0, asInt(row.battlePassXp ?? row.battle_pass_xp)),
      staticId: String(row.staticId ?? row.static_id ?? '').replace(/\D/g, '').slice(0, 6),
    });
  }
  return out.sort((a, b) => a.place - b.place);
}

async function isStaffOf(eventId: number, userId: number) {
  const result = await query<{ role: string }>(
    'SELECT role FROM gmp_staff WHERE event_id=$1 AND user_id=$2',
    [eventId, userId],
  );
  return result.rows[0] || null;
}

function gmpCapsPayload(user: DbUser) {
  return {
    create: userHasGmpCap(user, 'create'),
    manageStaff: userHasGmpCap(user, 'manage_staff'),
    editWinners: userHasGmpCap(user, 'edit_winners'),
    editBody: userHasGmpCap(user, 'edit_body'),
    editCheckpoints: userHasGmpCap(user, 'edit_checkpoints'),
    marks: userHasGmpCap(user, 'marks'),
    viewStats: userHasGmpCap(user, 'view_stats'),
  };
}

async function canAccessEvent(user: DbUser, eventId: number) {
  if (userHasPermission(user, 'manage_gmp')) {
    return { view: true, staff: false as const, staffRole: null as string | null };
  }
  const staff = await isStaffOf(eventId, user.id);
  if (staff) {
    return { view: true, staff: true as const, staffRole: staff.role };
  }
  return { view: false, staff: false as const, staffRole: null as string | null };
}

async function hasGmpCapOrOrganizer(user: DbUser, eventId: number, cap: GmpCap) {
  if (userHasGmpCap(user, cap)) return true;
  const staff = await isStaffOf(eventId, user.id);
  return !!staff && staff.role === 'organizer';
}

async function canMark(user: DbUser, eventId: number) {
  if (userHasGmpCap(user, 'marks')) return true;
  return !!(await isStaffOf(eventId, user.id));
}

async function getEventStatus(eventId: number) {
  const result = await query<{ status: string }>('SELECT status FROM gmp_events WHERE id=$1', [eventId]);
  return result.rows[0]?.status || null;
}

async function assertNotClosed(eventId: number) {
  const status = await getEventStatus(eventId);
  if (!status) return jsonError('ГМП не найдено.', 404);
  if (status === 'closed') {
    return jsonError('ГМП закрыто: отметки и состав игроков нельзя менять. Награды выдаются вручную.', 400);
  }
  return null;
}

async function replaceStaff(eventId: number, staff: Array<{ userId: number; role: StaffRole }>) {
  const keepIds = staff.map((s) => s.userId);
  if (keepIds.length) {
    await query(
      'DELETE FROM gmp_staff WHERE event_id=$1 AND NOT (user_id = ANY($2::int[]))',
      [eventId, keepIds],
    );
  } else {
    await query('DELETE FROM gmp_staff WHERE event_id=$1', [eventId]);
  }
  if (!staff.length) return;
  const userIds = staff.map((s) => s.userId);
  const roles = staff.map((s) => s.role);
  await query(
    `INSERT INTO gmp_staff(event_id, user_id, role)
     SELECT $1, u, r
     FROM unnest($2::int[], $3::text[]) AS t(u, r)
     ON CONFLICT (event_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [eventId, userIds, roles],
  );
}

/** Обновляет чекпоинты по позиции: rename/insert/delete хвоста — marks существующих id сохраняются. */
async function syncCheckpoints(eventId: number, names: string[]) {
  const existing = await query<{ id: number; position: number; name: string }>(
    'SELECT id, position, name FROM gmp_checkpoints WHERE event_id=$1',
    [eventId],
  );
  const byPos = new Map(existing.rows.map((row) => [row.position, row]));
  const keepIds: number[] = [];

  for (let i = 0; i < names.length; i++) {
    const position = i + 1;
    const name = names[i];
    const prev = byPos.get(position);
    if (prev) {
      if (prev.name !== name) {
        await query('UPDATE gmp_checkpoints SET name=$1 WHERE id=$2', [name, prev.id]);
      }
      keepIds.push(prev.id);
    } else {
      const inserted = await query<{ id: number }>(
        'INSERT INTO gmp_checkpoints(event_id, position, name) VALUES($1,$2,$3) RETURNING id',
        [eventId, position, name],
      );
      keepIds.push(inserted.rows[0].id);
    }
  }

  if (keepIds.length) {
    await query(
      'DELETE FROM gmp_checkpoints WHERE event_id=$1 AND NOT (id = ANY($2::int[]))',
      [eventId, keepIds],
    );
  } else {
    await query('DELETE FROM gmp_checkpoints WHERE event_id=$1', [eventId]);
  }

  const players = await query<{ id: number }>('SELECT id FROM gmp_players WHERE event_id=$1', [eventId]);
  for (const player of players.rows) {
    await syncPlayerFinish(player.id, eventId, { skipWinnerSync: true });
  }
  await syncWinnersFromPlaces(eventId);
}

async function replaceWinners(eventId: number, winners: WinnerRow[]) {
  await query('DELETE FROM gmp_reward_places WHERE event_id=$1', [eventId]);
  if (!winners.length) return;
  const places = winners.map((w) => w.place);
  const dollars = winners.map((w) => w.dollars);
  const mcs = winners.map((w) => w.mc);
  const xps = winners.map((w) => w.battlePassXp);
  const staticIds = winners.map((w) => w.staticId);
  await query(
    `INSERT INTO gmp_reward_places(event_id, place, dollars, mc, battle_pass_xp, static_id)
     SELECT $1, p, d, m, x, s
     FROM unnest($2::int[], $3::int[], $4::int[], $5::int[], $6::text[]) AS t(p, d, m, x, s)`,
    [eventId, places, dollars, mcs, xps, staticIds],
  );
}

async function recomputePlaces(eventId: number) {
  await query('UPDATE gmp_players SET place=NULL WHERE event_id=$1 AND finished_at IS NULL', [eventId]);
  await query(
    `UPDATE gmp_players p
     SET place = ranked.rn
     FROM (
       SELECT id, ROW_NUMBER() OVER (ORDER BY finished_at ASC, id ASC) AS rn
       FROM gmp_players
       WHERE event_id=$1 AND finished_at IS NOT NULL
     ) ranked
     WHERE p.id = ranked.id`,
    [eventId],
  );
}

/** Подставляет StaticID в пустые места победителей по авторангу. */
async function syncWinnersFromPlaces(eventId: number) {
  await query(
    `UPDATE gmp_reward_places r
     SET static_id = p.static_id
     FROM gmp_players p
     WHERE r.event_id = $1
       AND p.event_id = $1
       AND p.place = r.place
       AND (r.static_id IS NULL OR r.static_id = '')`,
    [eventId],
  );
}

async function syncPlayerFinish(
  playerId: number,
  eventId: number,
  opts?: { skipWinnerSync?: boolean },
) {
  const before = await query<{ finished_at: string | null; place: number | null }>(
    'SELECT finished_at, place FROM gmp_players WHERE id=$1',
    [playerId],
  );
  const totals = await query<{ total: string; marked: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM gmp_checkpoints WHERE event_id=$1) AS total,
       (SELECT COUNT(*)::text FROM gmp_marks WHERE player_id=$2) AS marked`,
    [eventId, playerId],
  );
  const total = Number(totals.rows[0]?.total || 0);
  const marked = Number(totals.rows[0]?.marked || 0);
  if (total > 0 && marked >= total) {
    await query(
      `UPDATE gmp_players
       SET finished_at = COALESCE(finished_at, (
         SELECT MAX(marked_at) FROM gmp_marks WHERE player_id=$1
       ))
       WHERE id=$1`,
      [playerId],
    );
  } else {
    await query('UPDATE gmp_players SET finished_at=NULL, place=NULL WHERE id=$1', [playerId]);
  }
  await recomputePlaces(eventId);
  if (!opts?.skipWinnerSync) await syncWinnersFromPlaces(eventId);
  const after = await query<{ finished_at: string | null; place: number | null }>(
    'SELECT finished_at, place FROM gmp_players WHERE id=$1',
    [playerId],
  );
  const changed =
    String(before.rows[0]?.finished_at || '') !== String(after.rows[0]?.finished_at || '')
    || Number(before.rows[0]?.place || 0) !== Number(after.rows[0]?.place || 0);
  return changed;
}

function avgMedian(values: number[]): { avg: number | null; median: number | null } {
  if (!values.length) return { avg: null, median: null };
  const sorted = [...values].sort((a, b) => a - b);
  const avg = Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  return { avg, median };
}

async function loadEventBundle(eventId: number) {
  const event = await query<Row>(
    `SELECT e.*,
            wb.nickname AS written_by_nickname,
            cb.nickname AS created_by_nickname
     FROM gmp_events e
     JOIN users wb ON wb.id=e.written_by
     LEFT JOIN users cb ON cb.id=e.created_by
     WHERE e.id=$1`,
    [eventId],
  );
  if (!event.rows[0]) return null;
  const [staff, checkpoints, rewards, players, marks] = await Promise.all([
    query<Row>(
      `SELECT s.user_id, s.role, u.nickname, u.avatar_url, u.avatar_image_id, u.static_id
       FROM gmp_staff s
       JOIN users u ON u.id=s.user_id
       WHERE s.event_id=$1
       ORDER BY s.role DESC, u.nickname`,
      [eventId],
    ),
    query<Row>(
      'SELECT id, position, name FROM gmp_checkpoints WHERE event_id=$1 ORDER BY position, id',
      [eventId],
    ),
    query<Row>(
      `SELECT place, dollars, mc, battle_pass_xp, static_id
       FROM gmp_reward_places WHERE event_id=$1 ORDER BY place`,
      [eventId],
    ),
    query<Row>(
      `SELECT p.id, p.static_id, p.finished_at, p.place, p.created_at,
              p.is_blocked, p.block_reason, p.blocked_by, p.blocked_at,
              bu.nickname AS blocked_by_nickname
       FROM gmp_players p
       LEFT JOIN users bu ON bu.id=p.blocked_by
       WHERE p.event_id=$1
       ORDER BY p.is_blocked DESC, p.place NULLS LAST, p.finished_at NULLS LAST, p.static_id`,
      [eventId],
    ),
    query<Row>(
      `SELECT m.player_id, m.checkpoint_id, m.marked_at, m.marked_by, u.nickname AS marked_by_nickname
       FROM gmp_marks m
       JOIN gmp_players p ON p.id=m.player_id
       LEFT JOIN users u ON u.id=m.marked_by
       WHERE p.event_id=$1`,
      [eventId],
    ),
  ]);

  const winners = rewards.rows.map((r) => ({
    place: r.place,
    static_id: r.static_id || '',
    dollars: r.dollars || 0,
    mc: r.mc || 0,
    battle_pass_xp: r.battle_pass_xp || 0,
  }));

  const checkpointIds = checkpoints.rows.map((c) => Number(c.id));
  const markCountByCp = new Map<number, number>();
  const markTimes: number[] = [];
  for (const mark of marks.rows) {
    const cp = Number(mark.checkpoint_id);
    markCountByCp.set(cp, (markCountByCp.get(cp) || 0) + 1);
    if (mark.marked_at) markTimes.push(new Date(String(mark.marked_at)).getTime());
  }
  const playerCount = players.rows.length || 1;
  const checkpointStats = checkpoints.rows.map((cp) => {
    const count = markCountByCp.get(Number(cp.id)) || 0;
    return {
      id: cp.id,
      name: cp.name,
      position: cp.position,
      marked: count,
      percent: Math.round((count / playerCount) * 100),
    };
  });

  const markStats = avgMedian(markTimes);
  const row = event.rows[0];
  const startsAtMs = new Date(String(row.starts_at || '')).getTime();
  const marksByPlayer = new Map<number, number>();
  for (const mark of marks.rows) {
    const pid = Number(mark.player_id);
    marksByPlayer.set(pid, (marksByPlayer.get(pid) || 0) + 1);
  }

  const finishEntries = players.rows
    .filter((p) => p.finished_at)
    .map((p) => {
      const finished = new Date(String(p.finished_at || '')).getTime();
      const duration = Number.isFinite(startsAtMs) && Number.isFinite(finished) && finished >= startsAtMs
        ? finished - startsAtMs
        : null;
      return {
        id: Number(p.id),
        static_id: String(p.static_id || ''),
        place: p.place != null ? Number(p.place) : null,
        finished_at: p.finished_at,
        durationMs: duration,
      };
    });
  const finishDurations = finishEntries
    .map((p) => p.durationMs)
    .filter((v): v is number => v != null);
  const finishStats = avgMedian(finishDurations);
  const blockedCount = players.rows.filter((p) => p.is_blocked).length;
  const finishedCount = players.rows.filter((p) => p.finished_at).length;
  const inProgressCount = players.rows.filter((p) => {
    if (p.is_blocked || p.finished_at) return false;
    return (marksByPlayer.get(Number(p.id)) || 0) > 0;
  }).length;
  const notStartedCount = Math.max(0, players.rows.length - finishedCount - inProgressCount - blockedCount);
  const winnersAssigned = winners.filter((w) => String(w.static_id || '').trim()).length;
  const marksTotal = marks.rows.length;
  const marksPossible = players.rows.length * checkpointIds.length;
  const avgMarksPerPlayer = players.rows.length
    ? Math.round((marksTotal / players.rows.length) * 10) / 10
    : 0;
  const leaders = [...finishEntries]
    .sort((a, b) => {
      if (a.place != null && b.place != null) return a.place - b.place;
      if (a.place != null) return -1;
      if (b.place != null) return 1;
      return (a.durationMs ?? Number.POSITIVE_INFINITY) - (b.durationMs ?? Number.POSITIVE_INFINITY);
    })
    .slice(0, 5);

  const liveStamp = createHash('sha1')
    .update(JSON.stringify({
      status: row.status,
      players: players.rows,
      marks: marks.rows,
      winners,
    }))
    .digest('hex');

  return {
    event: {
      ...row,
      bodyHtml: renderBody(String(row.body || '')),
    } as Row,
    staff: staff.rows,
    checkpoints: checkpoints.rows,
    rewards: rewards.rows,
    players: players.rows,
    marks: marks.rows,
    winners,
    liveStamp,
    stats: {
      players: players.rows.length,
      finished: finishedCount,
      blocked: blockedCount,
      inProgress: inProgressCount,
      notStarted: notStartedCount,
      active: players.rows.length - blockedCount,
      finishRate: players.rows.length ? Math.round((finishedCount / players.rows.length) * 100) : 0,
      staff: staff.rows.length,
      organizers: staff.rows.filter((s) => s.role === 'organizer').length,
      helpers: staff.rows.filter((s) => s.role !== 'organizer').length,
      checkpoints: checkpointIds.length,
      checkpointStats,
      marksTotal,
      marksPossible,
      avgMarksPerPlayer,
      winnersTotal: winners.length,
      winnersAssigned,
      avgMarkedAt: markStats.avg != null ? new Date(markStats.avg).toISOString() : null,
      medianMarkedAt: markStats.median != null ? new Date(markStats.median).toISOString() : null,
      avgFinishMs: finishStats.avg,
      medianFinishMs: finishStats.median,
      minFinishMs: finishDurations.length ? Math.min(...finishDurations) : null,
      maxFinishMs: finishDurations.length ? Math.max(...finishDurations) : null,
      leaders,
    },
  };
}

export const handleGmp: ApiHandler = async ({ key, params, method, body, request }) => {
  if (
    key !== 'gmp'
    && key !== 'gmp-item'
    && key !== 'gmp-live'
    && key !== 'gmp-marks'
    && key !== 'gmp-players'
    && key !== 'gmp-user'
  ) {
    return undefined;
  }

  if (key === 'gmp-user') {
    const viewer = await required();
    if (viewer instanceof NextResponse) return viewer;
    const userId = parseId(params.userId);
    if (!userId) return jsonError('Некорректный пользователь.', 400);
    if (viewer.id !== userId && !userHasProfileViewCap(viewer, 'gmp')) {
      return jsonError('Недостаточно прав для просмотра ГМП профиля.', 403);
    }
    const tz = weekTimeZone();
    const weekPred = sqlInCurrentWeek('e.starts_at', 2);
    const [result, week] = await Promise.all([
      query<Row>(
        `SELECT e.id, e.title, e.starts_at, e.status, s.role,
                (${weekPred}) AS this_week
         FROM gmp_staff s
         JOIN gmp_events e ON e.id=s.event_id
         WHERE s.user_id=$1
         ORDER BY e.starts_at DESC`,
        [userId, tz],
      ),
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM gmp_staff s
         JOIN gmp_events e ON e.id=s.event_id
         WHERE s.user_id=$1
           AND ${weekPred}`,
        [userId, tz],
      ),
    ]);
    return NextResponse.json({
      items: result.rows,
      weekCount: Number(week.rows[0]?.count || 0),
      totalCount: result.rows.length,
    });
  }

  if (key === 'gmp' && method === 'GET') {
    const user = await required();
    if (user instanceof NextResponse) return user;
    const canViewAll = userHasPermission(user, 'manage_gmp');
    const caps = gmpCapsPayload(user);
    const writtenBy = asInt(request.nextUrl.searchParams.get('writtenBy'));
    const sqlParams: unknown[] = [];
    const join = !canViewAll
      ? (() => {
          sqlParams.push(user.id);
          return `JOIN gmp_staff me ON me.event_id=e.id AND me.user_id=$${sqlParams.length}`;
        })()
      : '';
    const filterParts: string[] = [];
    if (writtenBy) {
      sqlParams.push(writtenBy);
      filterParts.push(`e.written_by=$${sqlParams.length}`);
    }
    const whereSql = filterParts.length ? `WHERE ${filterParts.join(' AND ')}` : '';

    const result = await query<Row>(
      `SELECT e.id, e.title, e.starts_at, e.status, e.written_by, e.created_by,
              wb.nickname AS written_by_nickname,
              (SELECT COUNT(*)::int FROM gmp_staff s WHERE s.event_id=e.id) AS staff_count,
              (SELECT COUNT(*)::int FROM gmp_players p WHERE p.event_id=e.id) AS player_count
       FROM gmp_events e
       JOIN users wb ON wb.id=e.written_by
       ${join}
       ${whereSql}
       ORDER BY e.starts_at DESC`,
      sqlParams,
    );

    if (!canViewAll) {
      const anyStaff = await query('SELECT 1 FROM gmp_staff WHERE user_id=$1 LIMIT 1', [user.id]);
      if (!anyStaff.rows.length) {
        return jsonError('Недостаточно прав для просмотра ГМП.', 403);
      }
    }
    return NextResponse.json({
      events: result.rows,
      canEdit: caps.create || caps.editBody || caps.manageStaff || caps.editWinners || caps.editCheckpoints,
      canCreate: caps.create,
      canViewAll,
      isStaffOnly: !canViewAll,
      caps,
    });
  }

  if (key === 'gmp' && method === 'POST') {
    const user = await required();
    if (user instanceof NextResponse) return user;
    if (!userHasGmpCap(user, 'create')) return jsonError('Недостаточно прав для создания ГМП.', 403);
    const title = String(body.title || '').trim();
    const startsAt = String(body.startsAt || body.starts_at || '').trim();
    const writtenBy = asInt(body.writtenBy ?? body.written_by);
    const gmpBody = String(body.body || '');
    const status = (['draft', 'open', 'closed'].includes(String(body.status))
      ? String(body.status)
      : 'draft') as GmpStatus;
    if (!title) return jsonError('Укажите название ГМП.', 400);
    if (!startsAt || Number.isNaN(Date.parse(startsAt))) {
      return jsonError('Укажите корректную дату и время.', 400);
    }
    if (!writtenBy) return jsonError('Укажите, кто написал ГМП.', 400);
    const author = await query('SELECT id FROM users WHERE id=$1', [writtenBy]);
    if (!author.rows[0]) return jsonError('Автор ГМП не найден.', 400);

    const created = await query<{ id: number }>(
      `INSERT INTO gmp_events(title,body,starts_at,status,written_by,created_by)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [title, gmpBody, new Date(startsAt).toISOString(), status, writtenBy, user.id],
    );
    const eventId = created.rows[0].id;
    const staff = asStaffList(body.staff);
    if (!staff.some((s) => s.userId === user.id)) {
      staff.push({ userId: user.id, role: 'organizer' });
    }
    await replaceStaff(eventId, staff);
    const checkpoints = asCheckpointNames(body.checkpoints);
    if (checkpoints.length) await syncCheckpoints(eventId, checkpoints);
    const winners = asWinners(body.winners ?? body.rewards);
    if (winners.length) await replaceWinners(eventId, winners);
    await evaluateGmpStaffAchievements(staff.map((s) => s.userId));

    await writeAudit({
      actorId: user.id,
      action: 'gmp.create',
      entityType: 'gmp',
      entityId: eventId,
      details: { title, writtenBy, status },
    });
    return ok({ id: eventId });
  }

  const eventId = parseId(params.id);
  if (!eventId) return jsonError('Некорректный идентификатор ГМП.', 400);

  if (key === 'gmp-item' && method === 'GET') {
    const user = await required();
    if (user instanceof NextResponse) return user;
    const access = await canAccessEvent(user, eventId);
    if (!access.view) return jsonError('Недостаточно прав.', 403);
    const bundle = await loadEventBundle(eventId);
    if (!bundle) return jsonError('ГМП не найдено.', 404);
    const caps = gmpCapsPayload(user);
    const canViewStats = caps.viewStats || access.staff;
    return NextResponse.json({
      ...bundle,
      stats: canViewStats ? bundle.stats : null,
      caps,
      canEdit: caps.editBody || caps.manageStaff || caps.editWinners || caps.editCheckpoints || access.staffRole === 'organizer',
      canEditBody: caps.editBody || access.staffRole === 'organizer',
      canManageStaff: caps.manageStaff || access.staffRole === 'organizer',
      canEditWinners: caps.editWinners || access.staffRole === 'organizer',
      canEditCheckpoints: caps.editCheckpoints || access.staffRole === 'organizer',
      canViewStats,
      canMark: (await canMark(user, eventId)) && bundle.event.status !== 'closed',
      canCreate: caps.create,
    });
  }

  if (key === 'gmp-live' && method === 'GET') {
    const user = await required();
    if (user instanceof NextResponse) return user;
    const access = await canAccessEvent(user, eventId);
    if (!access.view) return jsonError('Недостаточно прав.', 403);
    const since = request.nextUrl.searchParams.get('since') || request.headers.get('if-none-match');
    const bundle = await loadEventBundle(eventId);
    if (!bundle) return jsonError('ГМП не найдено.', 404);
    if (since && since.replace(/"/g, '') === bundle.liveStamp) {
      return new NextResponse(null, {
        status: 304,
        headers: { ETag: `"${bundle.liveStamp}"` },
      });
    }
    const caps = gmpCapsPayload(user);
    const canViewStats = caps.viewStats || access.staff;
    return NextResponse.json({
      players: bundle.players,
      marks: bundle.marks,
      winners: bundle.winners,
      stats: canViewStats ? bundle.stats : null,
      status: bundle.event.status,
      liveStamp: bundle.liveStamp,
      updatedAt: new Date().toISOString(),
      canMark: (await canMark(user, eventId)) && bundle.event.status !== 'closed',
      canViewStats,
    }, {
      headers: { ETag: `"${bundle.liveStamp}"` },
    });
  }

  if (key === 'gmp-item' && method === 'DELETE') {
    const user = await required();
    if (user instanceof NextResponse) return user;
    if (!userHasGmpCap(user, 'create')) return jsonError('Недостаточно прав для удаления ГМП.', 403);
    const existing = await query('SELECT id,title FROM gmp_events WHERE id=$1', [eventId]);
    if (!existing.rows[0]) return jsonError('ГМП не найдено.', 404);
    await query('DELETE FROM gmp_events WHERE id=$1', [eventId]);
    await writeAudit({
      actorId: user.id,
      action: 'gmp.delete',
      entityType: 'gmp',
      entityId: eventId,
      details: { title: existing.rows[0].title },
    });
    return ok();
  }

  if (key === 'gmp-item' && method === 'PUT') {
    const user = await required();
    if (user instanceof NextResponse) return user;
    const existing = await query<{ status: string }>('SELECT status FROM gmp_events WHERE id=$1', [eventId]);
    if (!existing.rows[0]) return jsonError('ГМП не найдено.', 404);

    const title = body.title != null ? String(body.title).trim() : null;
    const startsAt = body.startsAt != null || body.starts_at != null
      ? String(body.startsAt ?? body.starts_at).trim()
      : null;
    const writtenBy = body.writtenBy != null || body.written_by != null
      ? asInt(body.writtenBy ?? body.written_by)
      : null;
    const gmpBody = body.body != null ? String(body.body) : null;
    const status = body.status != null ? String(body.status) : null;
    const touchesMeta = title != null || startsAt != null || writtenBy != null || gmpBody != null || status != null;

    if (touchesMeta && !(await hasGmpCapOrOrganizer(user, eventId, 'edit_body'))) {
      return jsonError('Недостаточно прав для редактирования описания ГМП.', 403);
    }
    if (body.staff != null && !(await hasGmpCapOrOrganizer(user, eventId, 'manage_staff'))) {
      return jsonError('Недостаточно прав для изменения staff.', 403);
    }
    if (body.checkpoints != null && !(await hasGmpCapOrOrganizer(user, eventId, 'edit_checkpoints'))) {
      return jsonError('Недостаточно прав для редактирования таблицы точек.', 403);
    }
    if ((body.winners != null || body.rewards != null)
      && !(await hasGmpCapOrOrganizer(user, eventId, 'edit_winners'))) {
      return jsonError('Недостаточно прав для редактирования победителей.', 403);
    }

    if (title !== null && !title) return jsonError('Укажите название ГМП.', 400);
    if (startsAt !== null && (!startsAt || Number.isNaN(Date.parse(startsAt)))) {
      return jsonError('Укажите корректную дату и время.', 400);
    }
    if (writtenBy !== null) {
      if (!writtenBy) return jsonError('Укажите, кто написал ГМП.', 400);
      const author = await query('SELECT id FROM users WHERE id=$1', [writtenBy]);
      if (!author.rows[0]) return jsonError('Автор ГМП не найден.', 400);
    }
    if (status !== null && !['draft', 'open', 'closed'].includes(status)) {
      return jsonError('Некорректный статус.', 400);
    }

    if (touchesMeta) {
      await query(
        `UPDATE gmp_events SET
           title = COALESCE($1, title),
           body = COALESCE($2, body),
           starts_at = COALESCE($3::timestamptz, starts_at),
           written_by = COALESCE($4, written_by),
           status = COALESCE($5, status),
           updated_at = now()
         WHERE id=$6`,
        [
          title,
          gmpBody,
          startsAt ? new Date(startsAt).toISOString() : null,
          writtenBy,
          status,
          eventId,
        ],
      );
    }

    if (body.staff != null) {
      const staffList = asStaffList(body.staff);
      await replaceStaff(eventId, staffList);
      await evaluateGmpStaffAchievements(staffList.map((s) => s.userId));
      await writeAudit({
        actorId: user.id,
        action: 'gmp.staff',
        entityType: 'gmp',
        entityId: eventId,
        details: { count: staffList.length },
      });
    }
    if (body.checkpoints != null) {
      await syncCheckpoints(eventId, asCheckpointNames(body.checkpoints));
    }
    if (body.winners != null || body.rewards != null) {
      await replaceWinners(eventId, asWinners(body.winners ?? body.rewards));
    }

    if (status === 'closed' && existing.rows[0].status !== 'closed') {
      await writeAudit({
        actorId: user.id,
        action: 'gmp.close',
        entityType: 'gmp',
        entityId: eventId,
        details: {},
      });
    }

    await writeAudit({
      actorId: user.id,
      action: 'gmp.update',
      entityType: 'gmp',
      entityId: eventId,
      details: { title, status, writtenBy },
    });
    const bundle = await loadEventBundle(eventId);
    const caps = gmpCapsPayload(user);
    const access = await canAccessEvent(user, eventId);
    const canViewStats = caps.viewStats || access.staff;
    return NextResponse.json({
      ok: true,
      ...bundle,
      stats: canViewStats ? bundle?.stats : null,
      caps,
      canEdit: caps.editBody || caps.manageStaff || caps.editWinners || caps.editCheckpoints || access.staffRole === 'organizer',
      canEditBody: caps.editBody || access.staffRole === 'organizer',
      canManageStaff: caps.manageStaff || access.staffRole === 'organizer',
      canEditWinners: caps.editWinners || access.staffRole === 'organizer',
      canEditCheckpoints: caps.editCheckpoints || access.staffRole === 'organizer',
      canViewStats,
      canMark: (await canMark(user, eventId)) && bundle?.event.status !== 'closed',
      canCreate: caps.create,
    });
  }

  if (key === 'gmp-players' && method === 'POST') {
    const user = await required();
    if (user instanceof NextResponse) return user;
    if (!(await canMark(user, eventId))) return jsonError('Недостаточно прав.', 403);
    const closed = await assertNotClosed(eventId);
    if (closed) return closed;
    const staticId = String(body.staticId || body.static_id || '').replace(/\D/g, '');
    if (staticId.length < 2 || staticId.length > 6) {
      return jsonError('StaticID: 2–6 цифр.', 400);
    }
    const inserted = await query<{ id: number }>(
      `INSERT INTO gmp_players(event_id,static_id) VALUES($1,$2)
       ON CONFLICT (event_id,static_id) DO NOTHING
       RETURNING id`,
      [eventId, staticId],
    );
    if (!inserted.rows[0]) return jsonError('Такой StaticID уже добавлен.', 400);
    return ok({ id: inserted.rows[0].id, staticId });
  }

  if (key === 'gmp-players' && method === 'DELETE') {
    const user = await required();
    if (user instanceof NextResponse) return user;
    if (!(await canMark(user, eventId))) return jsonError('Недостаточно прав.', 403);
    const closed = await assertNotClosed(eventId);
    if (closed) return closed;
    const playerId = asInt(body.playerId ?? body.player_id ?? params.playerId);
    if (!playerId) return jsonError('Укажите игрока.', 400);
    await query('DELETE FROM gmp_players WHERE id=$1 AND event_id=$2', [playerId, eventId]);
    await recomputePlaces(eventId);
    await syncWinnersFromPlaces(eventId);
    return ok();
  }

  if (key === 'gmp-players' && method === 'PUT') {
    const user = await required();
    if (user instanceof NextResponse) return user;
    if (!(await canMark(user, eventId))) return jsonError('Недостаточно прав.', 403);
    const closed = await assertNotClosed(eventId);
    if (closed) return closed;
    const playerId = asInt(body.playerId ?? body.player_id ?? params.playerId);
    if (!playerId) return jsonError('Укажите игрока.', 400);
    const action = String(body.action || '').trim();
    const existing = await query<{ id: number; is_blocked: boolean }>(
      'SELECT id, is_blocked FROM gmp_players WHERE id=$1 AND event_id=$2',
      [playerId, eventId],
    );
    if (!existing.rows[0]) return jsonError('Игрок не найден.', 404);

    if (action === 'block') {
      const reason = String(body.reason || '').trim();
      if (!reason) return jsonError('Укажите причину блокировки.', 400);
      if (reason.length > 300) return jsonError('Причина слишком длинная (максимум 300 символов).', 400);
      await query(
        `UPDATE gmp_players
         SET is_blocked=TRUE, block_reason=$3, blocked_by=$4, blocked_at=now()
         WHERE id=$1 AND event_id=$2`,
        [playerId, eventId, reason, user.id],
      );
      await writeAudit({
        actorId: user.id,
        action: 'gmp.player_block',
        entityType: 'gmp',
        entityId: eventId,
        details: { playerId, reason },
      });
    } else if (action === 'unblock') {
      await query(
        `UPDATE gmp_players
         SET is_blocked=FALSE, block_reason='', blocked_by=NULL, blocked_at=NULL
         WHERE id=$1 AND event_id=$2`,
        [playerId, eventId],
      );
      await writeAudit({
        actorId: user.id,
        action: 'gmp.player_unblock',
        entityType: 'gmp',
        entityId: eventId,
        details: { playerId },
      });
    } else {
      return jsonError('Неизвестное действие.', 400);
    }

    const bundle = await loadEventBundle(eventId);
    return NextResponse.json({
      ok: true,
      players: bundle?.players || [],
      marks: bundle?.marks || [],
      winners: bundle?.winners || [],
      stats: bundle?.stats || null,
      liveStamp: bundle?.liveStamp || null,
    });
  }

  if (key === 'gmp-marks' && method === 'PUT') {
    const user = await required();
    if (user instanceof NextResponse) return user;
    if (!(await canMark(user, eventId))) return jsonError('Недостаточно прав.', 403);
    const closed = await assertNotClosed(eventId);
    if (closed) return closed;
    const playerId = asInt(body.playerId ?? body.player_id);
    const checkpointId = asInt(body.checkpointId ?? body.checkpoint_id);
    const marked = body.marked !== false && body.marked !== 'false';
    if (!playerId || !checkpointId) return jsonError('Укажите игрока и чекпоинт.', 400);

    const player = await query<{ id: number; is_blocked: boolean }>(
      'SELECT id, is_blocked FROM gmp_players WHERE id=$1 AND event_id=$2',
      [playerId, eventId],
    );
    if (!player.rows[0]) return jsonError('Игрок не найден.', 404);
    if (player.rows[0].is_blocked) {
      return jsonError('Игрок заблокирован: отметки заморожены.', 400);
    }
    const checkpoint = await query(
      'SELECT id FROM gmp_checkpoints WHERE id=$1 AND event_id=$2',
      [checkpointId, eventId],
    );
    if (!checkpoint.rows[0]) return jsonError('Чекпоинт не найден.', 404);

    if (marked) {
      await query(
        `INSERT INTO gmp_marks(player_id,checkpoint_id,marked_by)
         VALUES($1,$2,$3)
         ON CONFLICT (player_id,checkpoint_id) DO UPDATE SET marked_at=now(), marked_by=EXCLUDED.marked_by`,
        [playerId, checkpointId, user.id],
      );
    } else {
      await query('DELETE FROM gmp_marks WHERE player_id=$1 AND checkpoint_id=$2', [
        playerId,
        checkpointId,
      ]);
    }
    const finishChanged = await syncPlayerFinish(playerId, eventId);
    if (finishChanged) {
      await writeAudit({
        actorId: user.id,
        action: 'gmp.mark',
        entityType: 'gmp',
        entityId: eventId,
        details: { playerId, checkpointId, marked, finishChanged: true },
      });
    }
    const bundle = await loadEventBundle(eventId);
    return NextResponse.json({
      ok: true,
      players: bundle?.players || [],
      marks: bundle?.marks || [],
      winners: bundle?.winners || [],
      stats: bundle?.stats || null,
      liveStamp: bundle?.liveStamp || null,
    });
  }

  return jsonError('Метод не поддерживается.', 405);
};
