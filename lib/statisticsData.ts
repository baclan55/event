import { query } from '@/lib/db';
import {
  buildStatsRange,
  chartBucket,
  sqlStatsRange,
  statsRangeParams,
  type StatsPeriod,
  type StatsRange,
  type StatsRangeInput,
} from '@/lib/statisticsRange';

function n(v: unknown) {
  return Number(v) || 0;
}

function rangeOrDefault(input?: StatsRangeInput | StatsRange): StatsRange {
  if (input && 'fromIso' in input && 'tz' in input) return input as StatsRange;
  return buildStatsRange(input || { period: 'week' });
}

async function seriesFor(
  exprTable: string,
  timeExpr: string,
  whereExtra: string,
  range: StatsRange,
  extraParams: unknown[] = [],
) {
  const bucket = chartBucket(range.period);
  const trunc = bucket === 'hour'
    ? `to_char(date_trunc('hour', (${timeExpr} AT TIME ZONE $1)), 'YYYY-MM-DD HH24:00')`
    : bucket === 'day'
      ? `to_char((${timeExpr} AT TIME ZONE $1)::date, 'YYYY-MM-DD')`
      : bucket === 'week'
        ? `to_char(date_trunc('week', ${timeExpr} AT TIME ZONE $1), 'IYYY-"W"IW')`
        : `to_char(date_trunc('month', ${timeExpr} AT TIME ZONE $1), 'YYYY-MM')`;
  const rangeSql = sqlStatsRange(timeExpr);
  const baseParams = statsRangeParams(range);
  const result = await query<{ bucket: string; c: string }>(
    `SELECT ${trunc} AS bucket, COUNT(*)::text AS c
     FROM ${exprTable}
     WHERE ${rangeSql} ${whereExtra ? `AND ${whereExtra}` : ''}
     GROUP BY 1
     ORDER BY 1 ASC
     LIMIT 120`,
    [...baseParams, ...extraParams],
  ).catch(() => ({ rows: [] as { bucket: string; c: string }[] }));
  return result.rows.map((r) => ({ label: r.bucket, value: n(r.c) }));
}

export async function loadStatisticsOverview(input?: StatsRangeInput) {
  const range = rangeOrDefault(input);
  const p = statsRangeParams(range);
  const mpRange = sqlStatsRange('e.message_created_at');
  const appRange = sqlStatsRange('a.created_at');
  const rpRange = sqlStatsRange('rp.created_at');
  const gmpRange = sqlStatsRange('g.created_at');
  const achRange = sqlStatsRange('ua.awarded_at');

  const [mp, apps, rp, gmp, grants, users, seriesMp] = await Promise.all([
    query<{ c: string; open: string; abandoned: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE e.status='completed')::text AS c,
         COUNT(*) FILTER (WHERE e.status='open')::text AS open,
         COUNT(*) FILTER (WHERE e.status='abandoned')::text AS abandoned
       FROM discord_gather_events e
       WHERE ${mpRange}`,
      p,
    ).catch(() => ({ rows: [{ c: '0', open: '0', abandoned: '0' }] })),
    query<{ c: string; pending: string; approved: string; rejected: string }>(
      `SELECT
         COUNT(*)::text AS c,
         COUNT(*) FILTER (WHERE status='pending')::text AS pending,
         COUNT(*) FILTER (WHERE status='approved')::text AS approved,
         COUNT(*) FILTER (WHERE status='rejected')::text AS rejected
       FROM applications a
       WHERE ${appRange}`,
      p,
    ).catch(() => ({ rows: [{ c: '0', pending: '0', approved: '0', rejected: '0' }] })),
    query<{ c: string; active: string }>(
      `SELECT
         COUNT(*)::text AS c,
         COUNT(*) FILTER (WHERE NOT (type='verbal' AND converted=TRUE))::text AS active
       FROM reprimands rp
       WHERE ${rpRange}`,
      p,
    ).catch(() => ({ rows: [{ c: '0', active: '0' }] })),
    query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM gmp_events g WHERE ${gmpRange}`,
      p,
    ).catch(() => ({ rows: [{ c: '0' }] })),
    query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM user_achievements ua WHERE ${achRange}`,
      p,
    ).catch(() => ({ rows: [{ c: '0' }] })),
    query<{ all: string; candidates: string; blocked: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM users) AS all,
         (SELECT COUNT(*)::text FROM users WHERE status='candidate') AS candidates,
         (SELECT COUNT(*)::text FROM users WHERE is_blocked=TRUE) AS blocked`,
    ).catch(() => ({ rows: [{ all: '0', candidates: '0', blocked: '0' }] })),
    seriesFor('discord_gather_events e', 'e.message_created_at', `e.status='completed'`, range),
  ]);

  const m = mp.rows[0] || { c: '0', open: '0', abandoned: '0' };
  const a = apps.rows[0] || { c: '0', pending: '0', approved: '0', rejected: '0' };
  const r = rp.rows[0] || { c: '0', active: '0' };
  const u = users.rows[0] || { all: '0', candidates: '0', blocked: '0' };

  return {
    range,
    totals: {
      mpCompleted: n(m.c),
      mpOpen: n(m.open),
      mpAbandoned: n(m.abandoned),
      applications: n(a.c),
      appsPending: n(a.pending),
      appsApproved: n(a.approved),
      appsRejected: n(a.rejected),
      reprimands: n(r.c),
      reprimandsActive: n(r.active),
      gmp: n(gmp.rows[0]?.c),
      achievementGrants: n(grants.rows[0]?.c),
      users: n(u.all),
      candidates: n(u.candidates),
      blocked: n(u.blocked),
    },
    series: { mp: seriesMp },
  };
}

export async function loadStatisticsEvents(input?: StatsRangeInput) {
  const range = rangeOrDefault(input);
  const p = statsRangeParams(range);
  const mpRange = sqlStatsRange('e.message_created_at');

  const [totals, byTitle, byDay, topHelpers, participants] = await Promise.all([
    query<{ completed: string; open: string; abandoned: string; participants: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE e.status='completed')::text AS completed,
         COUNT(*) FILTER (WHERE e.status='open')::text AS open,
         COUNT(*) FILTER (WHERE e.status='abandoned')::text AS abandoned,
         (SELECT COUNT(*)::text FROM discord_gather_participants p
            JOIN discord_gather_events e2 ON e2.message_id=p.message_id
           WHERE ${sqlStatsRange('e2.message_created_at')} AND e2.status='completed') AS participants
       FROM discord_gather_events e
       WHERE ${mpRange}`,
      p,
    ).catch(() => ({ rows: [{ completed: '0', open: '0', abandoned: '0', participants: '0' }] })),
    query<{ title: string; c: string }>(
      `SELECT COALESCE(NULLIF(TRIM(e.title), ''), 'Без названия') AS title, COUNT(*)::text AS c
       FROM discord_gather_events e
       WHERE e.status='completed' AND ${mpRange}
       GROUP BY 1 ORDER BY COUNT(*) DESC, title ASC LIMIT 25`,
      p,
    ).catch(() => ({ rows: [] as { title: string; c: string }[] })),
    seriesFor('discord_gather_events e', 'e.message_created_at', `e.status='completed'`, range),
    query<{ nickname: string; user_id: number; c: string }>(
      `SELECT u.id AS user_id, COALESCE(u.first_name, u.nickname, '—') AS nickname, COUNT(*)::text AS c
       FROM discord_gather_participants p
       JOIN discord_gather_events e ON e.message_id=p.message_id
       JOIN users u ON u.discord_id = p.discord_id
       WHERE e.status='completed' AND ${mpRange}
       GROUP BY u.id, COALESCE(u.first_name, u.nickname, '—')
       ORDER BY COUNT(*) DESC, nickname ASC
       LIMIT 15`,
      p,
    ).catch(() => ({ rows: [] as { nickname: string; user_id: number; c: string }[] })),
    query<{ avg: string }>(
      `SELECT COALESCE(AVG(cnt),0)::text AS avg FROM (
         SELECT COUNT(p.discord_id)::float AS cnt
         FROM discord_gather_events e
         LEFT JOIN discord_gather_participants p ON p.message_id=e.message_id
         WHERE e.status='completed' AND ${mpRange}
         GROUP BY e.message_id
       ) t`,
      p,
    ).catch(() => ({ rows: [{ avg: '0' }] })),
  ]);

  const t = totals.rows[0] || { completed: '0', open: '0', abandoned: '0', participants: '0' };
  return {
    range,
    totals: {
      completed: n(t.completed),
      open: n(t.open),
      abandoned: n(t.abandoned),
      participants: n(t.participants),
      avgParticipants: Math.round(n(participants.rows[0]?.avg) * 10) / 10,
    },
    byTitle: byTitle.rows.map((r) => ({ label: r.title, value: n(r.c) })),
    series: byDay,
    topHelpers: topHelpers.rows.map((r) => ({
      label: r.nickname,
      value: n(r.c),
      href: `/app/profile/${r.user_id}`,
    })),
  };
}

export async function loadStatisticsUsers(input?: StatsRangeInput) {
  const range = rangeOrDefault(input);
  const p = statsRangeParams(range);
  // Пользователи: срез на сейчас + активности в периоде (МП-участие, заявки)
  const [totals, byRole, byStatus, joinSeries, topActive] = await Promise.all([
    query<{ all: string; with_role: string; candidates: string; blocked: string; helpers: string; admins: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM users) AS all,
         (SELECT COUNT(*)::text FROM users u WHERE EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id=u.id)) AS with_role,
         (SELECT COUNT(*)::text FROM users WHERE status='candidate') AS candidates,
         (SELECT COUNT(*)::text FROM users WHERE is_blocked=TRUE) AS blocked,
         (SELECT COUNT(DISTINCT ur.user_id)::text FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE COALESCE(r.is_event_helper,FALSE)) AS helpers,
         (SELECT COUNT(DISTINCT ur.user_id)::text FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE COALESCE(r.is_administrator,FALSE)) AS admins`,
    ).catch(() => ({
      rows: [{ all: '0', with_role: '0', candidates: '0', blocked: '0', helpers: '0', admins: '0' }],
    })),
    query<{ name: string; c: string }>(
      `SELECT r.name, COUNT(DISTINCT ur.user_id)::text AS c
       FROM roles r LEFT JOIN user_roles ur ON ur.role_id=r.id
       GROUP BY r.id, r.name, r.priority ORDER BY r.priority ASC`,
    ).catch(() => ({ rows: [] as { name: string; c: string }[] })),
    query<{ status: string; c: string }>(
      `SELECT COALESCE(status,'member') AS status, COUNT(*)::text AS c FROM users GROUP BY 1 ORDER BY 1`,
    ).catch(() => ({ rows: [] as { status: string; c: string }[] })),
    seriesFor('user_roles ur', 'COALESCE(ur.assigned_at, NOW())', '', range),
    query<{ nickname: string; user_id: number; c: string }>(
      `SELECT u.id AS user_id, COALESCE(u.first_name, u.nickname, '—') AS nickname, COUNT(*)::text AS c
       FROM discord_gather_participants p
       JOIN discord_gather_events e ON e.message_id=p.message_id
       JOIN users u ON u.discord_id=p.discord_id
       WHERE e.status='completed' AND ${sqlStatsRange('e.message_created_at')}
       GROUP BY u.id, COALESCE(u.first_name, u.nickname, '—')
       ORDER BY COUNT(*) DESC LIMIT 15`,
      p,
    ).catch(() => ({ rows: [] as { nickname: string; user_id: number; c: string }[] })),
  ]);

  const t = totals.rows[0] || {
    all: '0', with_role: '0', candidates: '0', blocked: '0', helpers: '0', admins: '0',
  };

  return {
    range,
    totals: {
      all: n(t.all),
      withRole: n(t.with_role),
      candidates: n(t.candidates),
      blocked: n(t.blocked),
      helpers: n(t.helpers),
      admins: n(t.admins),
    },
    byRole: byRole.rows.map((r) => ({ label: r.name, value: n(r.c) })),
    byStatus: byStatus.rows.map((r) => ({ label: r.status, value: n(r.c) })),
    series: joinSeries,
    topActive: topActive.rows.map((r) => ({
      label: r.nickname,
      value: n(r.c),
      href: `/app/profile/${r.user_id}`,
    })),
  };
}

export async function loadStatisticsAchievements(input?: StatsRangeInput) {
  const range = rangeOrDefault(input);
  const p = statsRangeParams(range);
  const achRange = sqlStatsRange('ua.awarded_at');
  const [totals, byAchievement, series, topUsers] = await Promise.all([
    query<{ defs: string; grants: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM achievements) AS defs,
         (SELECT COUNT(*)::text FROM user_achievements ua WHERE ${achRange}) AS grants`,
      p,
    ).catch(() => ({ rows: [{ defs: '0', grants: '0' }] })),
    query<{ title: string; c: string }>(
      `SELECT a.name AS title, COUNT(ua.user_id)::text AS c
       FROM achievements a
       LEFT JOIN user_achievements ua ON ua.achievement_id=a.id AND ${achRange}
       GROUP BY a.id, a.name
       ORDER BY COUNT(ua.user_id) DESC, a.name ASC
       LIMIT 25`,
      p,
    ).catch(() => ({ rows: [] as { title: string; c: string }[] })),
    seriesFor('user_achievements ua', 'ua.awarded_at', '', range),
    query<{ nickname: string; user_id: number; c: string }>(
      `SELECT u.id AS user_id, COALESCE(u.first_name, u.nickname, '—') AS nickname, COUNT(*)::text AS c
       FROM user_achievements ua
       JOIN users u ON u.id=ua.user_id
       WHERE ${achRange}
       GROUP BY u.id, COALESCE(u.first_name, u.nickname, '—')
       ORDER BY COUNT(*) DESC LIMIT 15`,
      p,
    ).catch(() => ({ rows: [] as { nickname: string; user_id: number; c: string }[] })),
  ]);
  const t = totals.rows[0] || { defs: '0', grants: '0' };
  return {
    range,
    totals: { defs: n(t.defs), grants: n(t.grants) },
    byAchievement: byAchievement.rows.map((r) => ({ label: r.title, value: n(r.c) })),
    series,
    topUsers: topUsers.rows.map((r) => ({
      label: r.nickname,
      value: n(r.c),
      href: `/app/profile/${r.user_id}`,
    })),
  };
}

export async function loadStatisticsGmp(input?: StatsRangeInput) {
  const range = rangeOrDefault(input);
  const p = statsRangeParams(range);
  const gmpRange = sqlStatsRange('g.created_at');
  const [totals, byStatus, series, recent] = await Promise.all([
    query<{ all: string; checkpoints: string; staff: string; players: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM gmp_events g WHERE ${gmpRange}) AS all,
         (SELECT COUNT(*)::text FROM gmp_checkpoints c
            JOIN gmp_events g ON g.id=c.event_id WHERE ${gmpRange}) AS checkpoints,
         (SELECT COUNT(*)::text FROM gmp_staff s
            JOIN gmp_events g ON g.id=s.event_id WHERE ${gmpRange}) AS staff,
         (SELECT COUNT(*)::text FROM gmp_players pl
            JOIN gmp_events g ON g.id=pl.event_id WHERE ${gmpRange}) AS players`,
      p,
    ).catch(() => ({ rows: [{ all: '0', checkpoints: '0', staff: '0', players: '0' }] })),
    query<{ status: string; c: string }>(
      `SELECT COALESCE(status,'—') AS status, COUNT(*)::text AS c
       FROM gmp_events g WHERE ${gmpRange}
       GROUP BY 1 ORDER BY COUNT(*) DESC`,
      p,
    ).catch(() => ({ rows: [] as { status: string; c: string }[] })),
    seriesFor('gmp_events g', 'g.created_at', '', range),
    query<{ id: number; title: string; status: string; created_at: string }>(
      `SELECT id, COALESCE(NULLIF(TRIM(title), ''), 'Без названия') AS title,
              COALESCE(status,'—') AS status, created_at::text
       FROM gmp_events g WHERE ${gmpRange}
       ORDER BY created_at DESC NULLS LAST LIMIT 20`,
      p,
    ).catch(() => ({ rows: [] as { id: number; title: string; status: string; created_at: string }[] })),
  ]);
  const t = totals.rows[0] || { all: '0', checkpoints: '0', staff: '0', players: '0' };
  return {
    range,
    totals: {
      all: n(t.all),
      checkpoints: n(t.checkpoints),
      staff: n(t.staff),
      players: n(t.players),
    },
    byStatus: byStatus.rows.map((r) => ({ label: r.status, value: n(r.c) })),
    series,
    recent: recent.rows.map((r) => ({
      label: r.title,
      value: r.status,
      href: `/app/gmp/${r.id}`,
    })),
  };
}

export async function loadStatisticsApplications(input?: StatsRangeInput) {
  const range = rangeOrDefault(input);
  const p = statsRangeParams(range);
  const appRange = sqlStatsRange('a.created_at');
  const [totals, byStatus, series] = await Promise.all([
    query<{ all: string; pending: string; approved: string; rejected: string; candidates: string }>(
      `SELECT
         COUNT(*)::text AS all,
         COUNT(*) FILTER (WHERE status='pending')::text AS pending,
         COUNT(*) FILTER (WHERE status='approved')::text AS approved,
         COUNT(*) FILTER (WHERE status='rejected')::text AS rejected,
         (SELECT COUNT(*)::text FROM users WHERE status='candidate') AS candidates
       FROM applications a WHERE ${appRange}`,
      p,
    ).catch(() => ({
      rows: [{ all: '0', pending: '0', approved: '0', rejected: '0', candidates: '0' }],
    })),
    query<{ status: string; c: string }>(
      `SELECT status, COUNT(*)::text AS c FROM applications a WHERE ${appRange}
       GROUP BY 1 ORDER BY COUNT(*) DESC`,
      p,
    ).catch(() => ({ rows: [] as { status: string; c: string }[] })),
    seriesFor('applications a', 'a.created_at', '', range),
  ]);
  const t = totals.rows[0] || {
    all: '0', pending: '0', approved: '0', rejected: '0', candidates: '0',
  };
  return {
    range,
    totals: {
      all: n(t.all),
      pending: n(t.pending),
      approved: n(t.approved),
      rejected: n(t.rejected),
      candidates: n(t.candidates),
    },
    byStatus: byStatus.rows.map((r) => ({ label: r.status, value: n(r.c) })),
    series,
  };
}

export async function loadStatisticsReprimands(input?: StatsRangeInput) {
  const range = rangeOrDefault(input);
  const p = statsRangeParams(range);
  const rpRange = sqlStatsRange('rp.created_at');
  const [totals, byType, series, topUsers, topReasons] = await Promise.all([
    query<{ all: string; active: string; converted: string }>(
      `SELECT
         COUNT(*)::text AS all,
         COUNT(*) FILTER (WHERE NOT (type='verbal' AND converted=TRUE))::text AS active,
         COUNT(*) FILTER (WHERE converted=TRUE)::text AS converted
       FROM reprimands rp WHERE ${rpRange}`,
      p,
    ).catch(() => ({ rows: [{ all: '0', active: '0', converted: '0' }] })),
    query<{ type: string; c: string }>(
      `SELECT COALESCE(type,'—') AS type, COUNT(*)::text AS c
       FROM reprimands rp WHERE ${rpRange}
       GROUP BY 1 ORDER BY COUNT(*) DESC`,
      p,
    ).catch(() => ({ rows: [] as { type: string; c: string }[] })),
    seriesFor('reprimands rp', 'rp.created_at', '', range),
    query<{ nickname: string; user_id: number; c: string }>(
      `SELECT u.id AS user_id, COALESCE(u.first_name, u.nickname, '—') AS nickname, COUNT(*)::text AS c
       FROM reprimands rp JOIN users u ON u.id=rp.user_id
       WHERE ${rpRange} AND NOT (rp.type='verbal' AND rp.converted=TRUE)
       GROUP BY u.id, COALESCE(u.first_name, u.nickname, '—')
       ORDER BY COUNT(*) DESC LIMIT 15`,
      p,
    ).catch(() => ({ rows: [] as { nickname: string; user_id: number; c: string }[] })),
    query<{ reason: string; c: string }>(
      `SELECT COALESCE(NULLIF(TRIM(reason), ''), 'Без причины') AS reason, COUNT(*)::text AS c
       FROM reprimands rp WHERE ${rpRange}
       GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 15`,
      p,
    ).catch(() => ({ rows: [] as { reason: string; c: string }[] })),
  ]);
  const t = totals.rows[0] || { all: '0', active: '0', converted: '0' };
  return {
    range,
    totals: { all: n(t.all), active: n(t.active), converted: n(t.converted) },
    byType: byType.rows.map((r) => ({ label: r.type, value: n(r.c) })),
    series,
    topUsers: topUsers.rows.map((r) => ({
      label: r.nickname,
      value: n(r.c),
      href: `/app/profile/${r.user_id}`,
    })),
    topReasons: topReasons.rows.map((r) => ({ label: r.reason, value: n(r.c) })),
  };
}

export type StatsSection =
  | 'overview'
  | 'events'
  | 'users'
  | 'achievements'
  | 'gmp'
  | 'applications'
  | 'reprimands';

export async function loadStatisticsSection(section: StatsSection, input?: StatsRangeInput) {
  switch (section) {
    case 'events': return loadStatisticsEvents(input);
    case 'users': return loadStatisticsUsers(input);
    case 'achievements': return loadStatisticsAchievements(input);
    case 'gmp': return loadStatisticsGmp(input);
    case 'applications': return loadStatisticsApplications(input);
    case 'reprimands': return loadStatisticsReprimands(input);
    default: return loadStatisticsOverview(input);
  }
}

export type { StatsPeriod, StatsRangeInput };
