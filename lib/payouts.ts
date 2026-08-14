import { query } from '@/lib/db';
import { weekTimeZone } from '@/lib/weekBounds';
import { helperRoleAtNow } from '@/lib/roleHistory';

export type PayoutRoleSettings = {
  role_id: number;
  mp_rate_mc: number;
  mp_rate_dollars: number;
  gmp_rate_mc: number;
  gmp_rate_dollars: number;
  min_mp: number;
  fixed_mc: number;
  fixed_dollars: number;
  verbal_penalty_pct: number;
  strict_penalty_pct: number;
};

export type PayoutWeekStatus = 'pending_events' | 'ready' | 'locked';

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function sqlWeekStart(offsetWeeks = 0, tz = weekTimeZone()): Promise<string> {
  const { rows } = await query<{ week_start: string }>(
    `SELECT (
       date_trunc('week', (now() AT TIME ZONE $1)) - ($2::int * interval '7 days')
     )::date::text AS week_start`,
    [tz, offsetWeeks],
  );
  return rows[0]?.week_start || '';
}

export async function weekBounds(weekStart: string, tz = weekTimeZone()) {
  const { rows } = await query<{ start_at: string; end_at: string }>(
    `SELECT
       (($1::date)::timestamp AT TIME ZONE $2) AS start_at,
       ((($1::date + 7)::timestamp) AT TIME ZONE $2) AS end_at`,
    [weekStart, tz],
  );
  return {
    startAt: rows[0].start_at,
    endAt: rows[0].end_at,
    tz,
  };
}

export async function hasOpenGathersInWeek(weekStart: string, tz = weekTimeZone()): Promise<boolean> {
  const { startAt, endAt } = await weekBounds(weekStart, tz);
  const { rows } = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM discord_gather_events e
     WHERE e.status = 'open'
       AND e.message_created_at >= $1::timestamptz
       AND e.message_created_at < $2::timestamptz`,
    [startAt, endAt],
  );
  return Number(rows[0]?.n || 0) > 0;
}

export async function loadRoleSettingsMap(): Promise<Map<number, PayoutRoleSettings>> {
  const { rows } = await query<Record<string, unknown>>(
    `SELECT * FROM payout_role_settings`,
  );
  const map = new Map<number, PayoutRoleSettings>();
  for (const row of rows) {
    const roleId = Number(row.role_id);
    map.set(roleId, {
      role_id: roleId,
      mp_rate_mc: num(row.mp_rate_mc),
      mp_rate_dollars: num(row.mp_rate_dollars),
      gmp_rate_mc: num(row.gmp_rate_mc),
      gmp_rate_dollars: num(row.gmp_rate_dollars),
      min_mp: Math.max(0, Math.floor(num(row.min_mp))),
      fixed_mc: num(row.fixed_mc),
      fixed_dollars: num(row.fixed_dollars),
      verbal_penalty_pct: num(row.verbal_penalty_pct),
      strict_penalty_pct: num(row.strict_penalty_pct),
    });
  }
  return map;
}

function emptySettings(roleId: number): PayoutRoleSettings {
  return {
    role_id: roleId,
    mp_rate_mc: 0,
    mp_rate_dollars: 0,
    gmp_rate_mc: 0,
    gmp_rate_dollars: 0,
    min_mp: 0,
    fixed_mc: 0,
    fixed_dollars: 0,
    verbal_penalty_pct: 0,
    strict_penalty_pct: 0,
  };
}

async function writePayoutLog(
  weekId: number,
  actorId: number | null,
  action: string,
  details: Record<string, unknown> = {},
) {
  await query(
    `INSERT INTO payout_log (week_id, actor_id, action, details) VALUES ($1, $2, $3, $4::jsonb)`,
    [weekId, actorId, action, JSON.stringify(details)],
  );
}

type EventHit = { at: string; kind: 'mp' | 'gmp'; messageId?: string; eventId?: number };

async function loadUserMpEvents(userId: number, startAt: string, endAt: string): Promise<EventHit[]> {
  const { rows } = await query<{ message_id: string; at: string }>(
    `SELECT e.message_id, e.message_created_at::text AS at
     FROM discord_gather_participants p
     JOIN discord_gather_events e ON e.message_id = p.message_id
     JOIN users u ON u.discord_id = p.discord_id
     WHERE u.id = $1
       AND u.discord_id IS NOT NULL
       AND e.status = 'completed'
       AND e.message_created_at >= $2::timestamptz
       AND e.message_created_at < $3::timestamptz`,
    [userId, startAt, endAt],
  );
  return rows.map((r) => ({ at: r.at, kind: 'mp' as const, messageId: r.message_id }));
}

async function loadUserGmpEvents(userId: number, startAt: string, endAt: string): Promise<EventHit[]> {
  const { rows } = await query<{ event_id: number; at: string }>(
    `SELECT e.id AS event_id, e.starts_at::text AS at
     FROM gmp_staff s
     JOIN gmp_events e ON e.id = s.event_id
     WHERE s.user_id = $1
       AND e.status = 'closed'
       AND e.starts_at >= $2::timestamptz
       AND e.starts_at < $3::timestamptz`,
    [userId, startAt, endAt],
  );
  return rows.map((r) => ({ at: r.at, kind: 'gmp' as const, eventId: r.event_id }));
}

export type ComputedPayout = {
  role_id: number | null;
  role_name: string;
  mp_count: number;
  gmp_count: number;
  breakdown: Record<string, unknown>;
  events_mc: number;
  events_dollars: number;
};

export async function computeUserPayoutForWeek(
  userId: number,
  weekStart: string,
  countedReprimands: Array<{ type: string; counted: boolean }>,
  settingsMap?: Map<number, PayoutRoleSettings>,
): Promise<ComputedPayout> {
  const tz = weekTimeZone();
  const { startAt, endAt } = await weekBounds(weekStart, tz);
  const settings = settingsMap || (await loadRoleSettingsMap());
  const mpEvents = await loadUserMpEvents(userId, startAt, endAt);
  const gmpEvents = await loadUserGmpEvents(userId, startAt, endAt);

  let rawMc = 0;
  let rawDollars = 0;
  const byRole: Record<string, { roleId: number; roleName: string; mp: number; gmp: number; mc: number; dollars: number }> = {};

  for (const hit of [...mpEvents, ...gmpEvents]) {
    const role = await helperRoleAtNow(userId, hit.at);
    const roleId = role?.id || 0;
    const roleName = role?.name || '—';
    const cfg = settings.get(roleId) || emptySettings(roleId);
    const key = String(roleId || 'none');
    if (!byRole[key]) {
      byRole[key] = { roleId, roleName, mp: 0, gmp: 0, mc: 0, dollars: 0 };
    }
    if (hit.kind === 'mp') {
      byRole[key].mp += 1;
      byRole[key].mc += cfg.mp_rate_mc;
      byRole[key].dollars += cfg.mp_rate_dollars;
      rawMc += cfg.mp_rate_mc;
      rawDollars += cfg.mp_rate_dollars;
    } else {
      byRole[key].gmp += 1;
      byRole[key].mc += cfg.gmp_rate_mc;
      byRole[key].dollars += cfg.gmp_rate_dollars;
      rawMc += cfg.gmp_rate_mc;
      rawDollars += cfg.gmp_rate_dollars;
    }
  }

  const displayRole = await helperRoleAtNow(userId, endAt);
  // чуть раньше конца недели — роль на вс 23:59
  const endMinus = new Date(new Date(endAt).getTime() - 1000);
  const roleAtEnd = (await helperRoleAtNow(userId, endMinus)) || displayRole;
  const primaryCfg = roleAtEnd
    ? (settings.get(roleAtEnd.id) || emptySettings(roleAtEnd.id))
    : emptySettings(0);

  const mpCount = mpEvents.length;
  const gmpCount = gmpEvents.length;
  const eligible = mpCount >= primaryCfg.min_mp;

  let eventsMc = 0;
  let eventsDollars = 0;
  if (eligible) {
    let penaltyPct = 0;
    for (const r of countedReprimands) {
      if (!r.counted) continue;
      if (r.type === 'verbal') penaltyPct += primaryCfg.verbal_penalty_pct;
      if (r.type === 'strict') penaltyPct += primaryCfg.strict_penalty_pct;
    }
    penaltyPct = Math.min(100, Math.max(0, penaltyPct));
    const factor = 1 - penaltyPct / 100;
    eventsMc = roundMoney(rawMc * factor + primaryCfg.fixed_mc);
    eventsDollars = roundMoney(rawDollars * factor + primaryCfg.fixed_dollars);
  }

  return {
    role_id: roleAtEnd?.id || null,
    role_name: roleAtEnd?.name || '',
    mp_count: mpCount,
    gmp_count: gmpCount,
    breakdown: {
      byRole: Object.values(byRole),
      rawMc,
      rawDollars,
      minMp: primaryCfg.min_mp,
      eligible,
      fixedMc: eligible ? primaryCfg.fixed_mc : 0,
      fixedDollars: eligible ? primaryCfg.fixed_dollars : 0,
    },
    events_mc: eventsMc,
    events_dollars: eventsDollars,
  };
}

async function helperUserIdsForWeek(weekStart: string): Promise<number[]> {
  const tz = weekTimeZone();
  const { startAt, endAt } = await weekBounds(weekStart, tz);
  const { rows } = await query<{ id: number }>(
    `SELECT DISTINCT u.id
     FROM users u
     WHERE u.status = 'member'
       AND (
         EXISTS (
           SELECT 1 FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id
           WHERE ur.user_id = u.id AND r.is_event_helper = TRUE
         )
         OR EXISTS (
           SELECT 1 FROM discord_gather_participants p
           JOIN discord_gather_events e ON e.message_id = p.message_id
           WHERE p.discord_id = u.discord_id
             AND u.discord_id IS NOT NULL
             AND e.status = 'completed'
             AND e.message_created_at >= $1::timestamptz
             AND e.message_created_at < $2::timestamptz
         )
         OR EXISTS (
           SELECT 1 FROM gmp_staff s
           JOIN gmp_events e ON e.id = s.event_id
           WHERE s.user_id = u.id
             AND e.status = 'closed'
             AND e.starts_at >= $1::timestamptz
             AND e.starts_at < $2::timestamptz
         )
       )
     ORDER BY u.id`,
    [startAt, endAt],
  );
  return rows.map((r) => r.id);
}

async function activeHelperReprimands(userId: number, startAt: string, endAt: string) {
  const { rows } = await query<{ id: number; type: string }>(
    `SELECT id, type FROM reprimands
     WHERE user_id = $1
       AND type IN ('verbal', 'strict')
       AND COALESCE(converted, FALSE) = FALSE
       AND created_at >= $2::timestamptz
       AND created_at < $3::timestamptz
     ORDER BY created_at ASC`,
    [userId, startAt, endAt],
  );
  return rows;
}

/** Создать или обновить неделю выплат. */
export async function ensurePayoutWeek(
  weekStart: string,
  opts: { actorId?: number | null; forceRebuild?: boolean } = {},
): Promise<{ weekId: number; status: PayoutWeekStatus; created: boolean }> {
  const pending = await hasOpenGathersInWeek(weekStart);
  const status: PayoutWeekStatus = pending ? 'pending_events' : 'ready';

  const existing = await query<{ id: number; status: string }>(
    'SELECT id, status FROM payout_weeks WHERE week_start = $1::date',
    [weekStart],
  );

  let weekId: number;
  let created = false;
  if (existing.rows[0]) {
    weekId = existing.rows[0].id;
    if (existing.rows[0].status === 'locked' && !opts.forceRebuild) {
      return { weekId, status: 'locked', created: false };
    }
    await query(
      `UPDATE payout_weeks SET status = $2, updated_at = now() WHERE id = $1`,
      [weekId, status === 'pending_events' ? 'pending_events' : (existing.rows[0].status === 'locked' ? 'locked' : 'ready')],
    );
  } else {
    const ins = await query<{ id: number }>(
      `INSERT INTO payout_weeks (week_start, status) VALUES ($1::date, $2) RETURNING id`,
      [weekStart, status],
    );
    weekId = ins.rows[0].id;
    created = true;
    await writePayoutLog(weekId, opts.actorId ?? null, 'week.create', { weekStart, status });
  }

  const effectiveStatus = (await query<{ status: string }>(
    'SELECT status FROM payout_weeks WHERE id=$1',
    [weekId],
  )).rows[0]?.status as PayoutWeekStatus;

  if (effectiveStatus === 'locked' && !opts.forceRebuild) {
    return { weekId, status: 'locked', created };
  }

  await rebuildPayoutWeekRows(weekId, weekStart, {
    actorId: opts.actorId ?? null,
    forceAll: !!opts.forceRebuild,
  });

  return { weekId, status: effectiveStatus, created };
}

export async function rebuildPayoutWeekRows(
  weekId: number,
  weekStart: string,
  opts: { actorId?: number | null; forceAll?: boolean; onlyUserId?: number } = {},
) {
  const tz = weekTimeZone();
  const { startAt, endAt } = await weekBounds(weekStart, tz);
  const settingsMap = await loadRoleSettingsMap();
  const userIds = opts.onlyUserId
    ? [opts.onlyUserId]
    : await helperUserIdsForWeek(weekStart);

  for (const userId of userIds) {
    const existing = await query<{
      id: number;
      manual: boolean;
      events_override: boolean;
      include_in_payout: boolean;
      bonus_mc: string;
      bonus_dollars: string;
      bonus_note: string;
      comp_static_id: string;
      comp_dollars: string;
      static_id: string;
      nickname: string;
    }>(
      `SELECT id, manual, events_override, include_in_payout, bonus_mc, bonus_dollars, bonus_note,
              comp_static_id, comp_dollars, static_id, nickname
       FROM payout_rows WHERE week_id=$1 AND user_id=$2`,
      [weekId, userId],
    );

    const user = await query<{ nickname: string; static_id: string | null }>(
      'SELECT nickname, static_id FROM users WHERE id=$1',
      [userId],
    );
    if (!user.rows[0]) continue;

    let counted: Array<{ type: string; counted: boolean }> = [];
    const reps = await activeHelperReprimands(userId, startAt, endAt);

    if (existing.rows[0] && !opts.forceAll) {
      const prev = await query<{ reprimand_id: number; type: string; counted: boolean }>(
        'SELECT reprimand_id, type, counted FROM payout_row_reprimands WHERE row_id=$1',
        [existing.rows[0].id],
      );
      const prevMap = new Map(prev.rows.map((r) => [r.reprimand_id, r.counted]));
      counted = reps.map((r) => ({
        type: r.type,
        counted: prevMap.has(r.id) ? !!prevMap.get(r.id) : true,
      }));
    } else {
      counted = reps.map((r) => ({ type: r.type, counted: true }));
    }

    const computed = await computeUserPayoutForWeek(userId, weekStart, counted, settingsMap);
    const nickname = user.rows[0].nickname;
    const staticId = String(user.rows[0].static_id || existing.rows[0]?.static_id || '');

    if (existing.rows[0]) {
      const row = existing.rows[0];
      const skipEvents = row.events_override && !opts.forceAll;
      await query(
        `UPDATE payout_rows SET
           role_id = $2,
           role_name = $3,
           nickname = $4,
           static_id = CASE WHEN $5 = '' THEN static_id ELSE $5 END,
           mp_count = $6,
           gmp_count = $7,
           breakdown = $8::jsonb,
           events_mc = CASE WHEN $9 THEN events_mc ELSE $10 END,
           events_dollars = CASE WHEN $9 THEN events_dollars ELSE $11 END,
           events_override = CASE WHEN $12 THEN FALSE ELSE events_override END
         WHERE id = $1`,
        [
          row.id,
          computed.role_id,
          computed.role_name,
          nickname,
          staticId,
          computed.mp_count,
          computed.gmp_count,
          JSON.stringify(computed.breakdown),
          skipEvents,
          computed.events_mc,
          computed.events_dollars,
          !!opts.forceAll,
        ],
      );

      await query('DELETE FROM payout_row_reprimands WHERE row_id=$1', [row.id]);
      for (let i = 0; i < reps.length; i++) {
        await query(
          `INSERT INTO payout_row_reprimands (row_id, reprimand_id, type, counted)
           VALUES ($1, $2, $3, $4)`,
          [row.id, reps[i].id, reps[i].type, counted[i]?.counted ?? true],
        );
      }
    } else {
      const ins = await query<{ id: number }>(
        `INSERT INTO payout_rows (
           week_id, user_id, role_id, role_name, nickname, static_id,
           mp_count, gmp_count, breakdown, events_mc, events_dollars,
           bonus_mc, bonus_dollars, bonus_note, comp_static_id, comp_dollars,
           manual, include_in_payout, events_override
         ) VALUES (
           $1,$2,$3,$4,$5,$6,
           $7,$8,$9::jsonb,$10,$11,
           0,0,'','',0,
           FALSE, TRUE, FALSE
         ) RETURNING id`,
        [
          weekId,
          userId,
          computed.role_id,
          computed.role_name,
          nickname,
          staticId,
          computed.mp_count,
          computed.gmp_count,
          JSON.stringify(computed.breakdown),
          computed.events_mc,
          computed.events_dollars,
        ],
      );
      for (const r of reps) {
        await query(
          `INSERT INTO payout_row_reprimands (row_id, reprimand_id, type, counted)
           VALUES ($1, $2, $3, TRUE)`,
          [ins.rows[0].id, r.id, r.type],
        );
      }
    }
  }

  // Обновить статус pending/ready
  const pending = await hasOpenGathersInWeek(weekStart, tz);
  const week = await query<{ status: string }>(
    'SELECT status FROM payout_weeks WHERE id=$1',
    [weekId],
  );
  if (week.rows[0]?.status !== 'locked') {
    await query(
      `UPDATE payout_weeks SET status=$2, updated_at=now() WHERE id=$1`,
      [weekId, pending ? 'pending_events' : 'ready'],
    );
  }

  await writePayoutLog(weekId, opts.actorId ?? null, 'week.rebuild', {
    forceAll: !!opts.forceAll,
    onlyUserId: opts.onlyUserId || null,
    users: userIds.length,
  });
}

export async function recomputeRowEvents(rowId: number, actorId?: number | null) {
  const { rows } = await query<{
    id: number;
    week_id: number;
    user_id: number;
    week_start: string;
  }>(
    `SELECT pr.id, pr.week_id, pr.user_id, pw.week_start::text AS week_start
     FROM payout_rows pr
     JOIN payout_weeks pw ON pw.id = pr.week_id
     WHERE pr.id = $1`,
    [rowId],
  );
  const row = rows[0];
  if (!row) return;

  const reps = await query<{ type: string; counted: boolean }>(
    'SELECT type, counted FROM payout_row_reprimands WHERE row_id=$1',
    [rowId],
  );
  const computed = await computeUserPayoutForWeek(
    row.user_id,
    row.week_start,
    reps.rows.map((r) => ({ type: r.type, counted: !!r.counted })),
  );
  const user = await query<{ nickname: string; static_id: string | null }>(
    'SELECT nickname, static_id FROM users WHERE id=$1',
    [row.user_id],
  );
  await query(
    `UPDATE payout_rows SET
       role_id=$2, role_name=$3, nickname=$4,
       static_id=CASE WHEN COALESCE($5,'')='' THEN static_id ELSE $5 END,
       mp_count=$6, gmp_count=$7, breakdown=$8::jsonb,
       events_mc=$9, events_dollars=$10, events_override=FALSE
     WHERE id=$1`,
    [
      rowId,
      computed.role_id,
      computed.role_name,
      user.rows[0]?.nickname || '',
      user.rows[0]?.static_id || '',
      computed.mp_count,
      computed.gmp_count,
      JSON.stringify(computed.breakdown),
      computed.events_mc,
      computed.events_dollars,
    ],
  );
  await writePayoutLog(row.week_id, actorId ?? null, 'row.recompute', { rowId, userId: row.user_id });
}

export function buildExportCommands(rows: Array<{
  include_in_payout: boolean;
  static_id: string;
  events_mc: number;
  events_dollars: number;
  bonus_mc: number;
  bonus_dollars: number;
  comp_static_id: string;
  comp_dollars: number;
}>) {
  const mc: string[] = [];
  const dollars: string[] = [];
  const comp: string[] = [];
  for (const row of rows) {
    if (!row.include_in_payout) continue;
    const sid = String(row.static_id || '').trim();
    const mcSum = roundMoney(num(row.events_mc) + num(row.bonus_mc));
    const dSum = roundMoney(num(row.events_dollars) + num(row.bonus_dollars));
    const cSum = roundMoney(num(row.comp_dollars));
    const cSid = String(row.comp_static_id || sid).trim();
    if (sid && mcSum > 0) mc.push(`/givedonate ${sid} ${Math.round(mcSum)} eventhelper`);
    if (sid && dSum > 0) dollars.push(`/givemoney ${sid} ${Math.round(dSum)} eventhelper`);
    if (cSid && cSum > 0) comp.push(`/givemoney ${cSid} ${Math.round(cSum)} compenseh`);
  }
  return {
    mc: mc.join('\n'),
    dollars: dollars.join('\n'),
    compensation: comp.join('\n'),
    all: [...mc, ...dollars, ...comp].join('\n'),
  };
}

export { writePayoutLog };
