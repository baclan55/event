import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { jsonError } from '@/lib/auth';
import { fieldLabel, humanValue } from '@/lib/auditShared';
import { userHasPermission } from '@/lib/roleAccess';
import {
  buildExportCommands,
  computeUserPayoutForWeek,
  ensurePayoutWeek,
  recomputeRowEvents,
  rebuildPayoutWeekRows,
  sqlWeekStart,
  writePayoutLog,
} from '@/lib/payouts';
import { ok, parseId, requiredPerm } from './helpers';
import type { ApiHandler } from './types';

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? Math.round(x) : 0;
}

export const handlePayouts: ApiHandler = async ({ key, params, method, body, request }) => {
  if (!key.startsWith('payout')) return undefined;

  if (key === 'payouts-settings') {
    const user = await requiredPerm('manage_payouts', { level: method === 'GET' ? 'view' : 'edit' });
    if (user instanceof NextResponse) return user;

    if (method === 'GET') {
      const roles = await query<Record<string, unknown>>(
        `SELECT r.id, r.name, r.priority,
                COALESCE(s.mp_rate_mc, 0) AS mp_rate_mc,
                COALESCE(s.mp_rate_dollars, 0) AS mp_rate_dollars,
                COALESCE(s.gmp_rate_mc, 0) AS gmp_rate_mc,
                COALESCE(s.gmp_rate_dollars, 0) AS gmp_rate_dollars,
                COALESCE(s.min_mp, 0) AS min_mp,
                COALESCE(s.fixed_mc, 0) AS fixed_mc,
                COALESCE(s.fixed_dollars, 0) AS fixed_dollars,
                COALESCE(s.verbal_penalty_pct, 50) AS verbal_penalty_pct,
                COALESCE(s.strict_penalty_pct, 100) AS strict_penalty_pct
         FROM roles r
         LEFT JOIN payout_role_settings s ON s.role_id = r.id
         WHERE r.include_in_helper_payouts = TRUE
         ORDER BY r.priority ASC`,
      );
      return NextResponse.json({
        roles: roles.rows,
        canEdit: userHasPermission(user, 'manage_payouts', 'edit'),
      });
    }

    if (method === 'PUT') {
      const items = Array.isArray(body.roles) ? body.roles : [];
      for (const item of items) {
        const roleId = Number(item.roleId ?? item.role_id);
        if (!Number.isFinite(roleId)) continue;
        await query(
          `INSERT INTO payout_role_settings (
             role_id, mp_rate_mc, mp_rate_dollars, gmp_rate_mc, gmp_rate_dollars,
             min_mp, fixed_mc, fixed_dollars, verbal_penalty_pct, strict_penalty_pct, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
           ON CONFLICT (role_id) DO UPDATE SET
             mp_rate_mc=EXCLUDED.mp_rate_mc,
             mp_rate_dollars=EXCLUDED.mp_rate_dollars,
             gmp_rate_mc=EXCLUDED.gmp_rate_mc,
             gmp_rate_dollars=EXCLUDED.gmp_rate_dollars,
             min_mp=EXCLUDED.min_mp,
             fixed_mc=EXCLUDED.fixed_mc,
             fixed_dollars=EXCLUDED.fixed_dollars,
             verbal_penalty_pct=EXCLUDED.verbal_penalty_pct,
             strict_penalty_pct=EXCLUDED.strict_penalty_pct,
             updated_at=now()`,
          [
            roleId,
            n(item.mp_rate_mc ?? item.mpRateMc),
            n(item.mp_rate_dollars ?? item.mpRateDollars),
            n(item.gmp_rate_mc ?? item.gmpRateMc),
            n(item.gmp_rate_dollars ?? item.gmpRateDollars),
            Math.max(0, Math.floor(n(item.min_mp ?? item.minMp))),
            n(item.fixed_mc ?? item.fixedMc),
            n(item.fixed_dollars ?? item.fixedDollars),
            n(item.verbal_penalty_pct ?? item.verbalPenaltyPct),
            n(item.strict_penalty_pct ?? item.strictPenaltyPct),
          ],
        );
      }
      return ok({ saved: true });
    }
    return jsonError('Метод не поддерживается.', 405);
  }

  if (key === 'payouts' && method === 'GET') {
    const user = await requiredPerm('manage_payouts');
    if (user instanceof NextResponse) return user;
    const weeks = await query<Record<string, unknown>>(
      `SELECT pw.*,
              (SELECT COUNT(*)::int FROM payout_rows pr WHERE pr.week_id = pw.id) AS row_count
       FROM payout_weeks pw
       ORDER BY pw.week_start DESC
       LIMIT 52`,
    );
    return NextResponse.json({
      weeks: weeks.rows,
      canEdit: userHasPermission(user, 'manage_payouts', 'edit'),
    });
  }

  if (key === 'payouts-generate' && method === 'POST') {
    const user = await requiredPerm('manage_payouts', { level: 'edit' });
    if (user instanceof NextResponse) return user;
    const weekStart = String(body.weekStart || '').trim() || (await sqlWeekStart(1));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return jsonError('Некорректная дата недели.', 400);
    }
    const result = await ensurePayoutWeek(weekStart, {
      actorId: user.id,
      forceRebuild: body.force === true,
    });
    return ok(result);
  }

  if (key === 'payout' && method === 'GET') {
    const user = await requiredPerm('manage_payouts');
    if (user instanceof NextResponse) return user;
    const weekId = parseId(params.id);
    const week = await query<Record<string, unknown>>(
      'SELECT * FROM payout_weeks WHERE id=$1',
      [weekId],
    );
    if (!week.rows[0]) return jsonError('Неделя не найдена.', 404);

    const rows = await query<Record<string, unknown>>(
      `SELECT pr.*,
              COALESCE(NULLIF(TRIM(pr.static_id), ''), NULLIF(TRIM(u.static_id), ''), '') AS export_static_id
       FROM payout_rows pr
       LEFT JOIN roles r ON r.id = pr.role_id
       LEFT JOIN users u ON u.id = pr.user_id
       WHERE pr.week_id = $1
       ORDER BY COALESCE(r.priority, 999), pr.nickname`,
      [weekId],
    );

    const rowIds = rows.rows.map((r) => Number(r.id));
    const reps = rowIds.length
      ? await query<Record<string, unknown>>(
          `SELECT prr.*, rp.reason, rp.created_at
           FROM payout_row_reprimands prr
           JOIN reprimands rp ON rp.id = prr.reprimand_id
           WHERE prr.row_id = ANY($1::int[])
           ORDER BY rp.created_at ASC`,
          [rowIds],
        )
      : { rows: [] as Record<string, unknown>[] };

    const byRow = new Map<number, Record<string, unknown>[]>();
    for (const r of reps.rows) {
      const id = Number(r.row_id);
      const list = byRow.get(id) || [];
      list.push(r);
      byRow.set(id, list);
    }

    return NextResponse.json({
      week: week.rows[0],
      rows: rows.rows.map((r) => ({
        ...r,
        static_id: String(r.static_id || r.export_static_id || ''),
        reprimands: byRow.get(Number(r.id)) || [],
      })),
      canEdit: userHasPermission(user, 'manage_payouts', 'edit'),
      export: buildExportCommands(
        rows.rows.map((r) => ({
          include_in_payout: !!r.include_in_payout,
          static_id: String(r.export_static_id || r.static_id || ''),
          nickname: String(r.nickname || ''),
          events_mc: n(r.events_mc),
          events_dollars: n(r.events_dollars),
          fixed_mc: n(r.fixed_mc),
          fixed_dollars: n(r.fixed_dollars),
          bonus_mc: n(r.bonus_mc),
          bonus_dollars: n(r.bonus_dollars),
          comp_static_id: String(r.comp_static_id || ''),
          comp_dollars: n(r.comp_dollars),
        })),
      ),
    });
  }

  if (key === 'payout' && method === 'PATCH') {
    const user = await requiredPerm('manage_payouts', { level: 'edit' });
    if (user instanceof NextResponse) return user;
    const weekId = parseId(params.id);
    const week = await query<{ status: string; week_start: string }>(
      'SELECT status, week_start::text AS week_start FROM payout_weeks WHERE id=$1',
      [weekId],
    );
    if (!week.rows[0]) return jsonError('Неделя не найдена.', 404);
    if (week.rows[0].status === 'locked') return jsonError('Неделя заблокирована.', 400);

    const action = String(body.action || 'update_row');

    if (action === 'lock') {
      await query(
        `UPDATE payout_weeks SET status='locked', locked_at=now(), locked_by=$2, updated_at=now() WHERE id=$1`,
        [weekId, user.id],
      );
      await writePayoutLog(weekId, user.id, 'week.lock', {
        summary: 'Неделя выплат закрыта для правок',
      });
      return ok({ status: 'locked' });
    }

    if (action === 'unlock') {
      await query(
        `UPDATE payout_weeks SET status='ready', locked_at=NULL, locked_by=NULL, updated_at=now() WHERE id=$1`,
        [weekId],
      );
      await writePayoutLog(weekId, user.id, 'week.unlock', {
        summary: 'Неделя выплат снова открыта для правок',
      });
      return ok({ status: 'ready' });
    }

    if (action === 'add_user') {
      const userId = Number(body.userId);
      if (!Number.isFinite(userId)) return jsonError('Укажите сотрудника.', 400);
      const named = await query<{ nickname: string }>(
        'SELECT nickname FROM users WHERE id=$1',
        [userId],
      );
      await rebuildPayoutWeekRows(weekId, week.rows[0].week_start, {
        actorId: user.id,
        onlyUserId: userId,
        forceAll: true,
      });
      await query(
        `UPDATE payout_rows SET manual=TRUE WHERE week_id=$1 AND user_id=$2`,
        [weekId, userId],
      );
      if (body.staticId != null) {
        await query(
          `UPDATE payout_rows SET static_id=$3 WHERE week_id=$1 AND user_id=$2`,
          [weekId, userId, String(body.staticId)],
        );
      }
      await writePayoutLog(weekId, user.id, 'row.add', {
        userId,
        nickname: named.rows[0]?.nickname || `#${userId}`,
        summary: 'Сотрудник вручную добавлен в ведомость',
      });
      return ok({ added: true });
    }

    if (action === 'toggle_reprimand_type') {
      const rowId = Number(body.rowId);
      const kind = String(body.kind || '');
      const counted = body.counted === true || body.counted === 'true';
      if (kind !== 'verbal' && kind !== 'strict') {
        return jsonError('kind: verbal или strict.', 400);
      }
      const prev = await query<{ nickname: string; count_verbal: boolean; count_strict: boolean }>(
        `SELECT nickname,
                COALESCE(count_verbal, TRUE) AS count_verbal,
                COALESCE(count_strict, TRUE) AS count_strict
         FROM payout_rows WHERE id=$1 AND week_id=$2`,
        [rowId, weekId],
      );
      if (!prev.rows[0]) return jsonError('Строка не найдена.', 404);
      const col = kind === 'verbal' ? 'count_verbal' : 'count_strict';
      const before = kind === 'verbal' ? prev.rows[0].count_verbal : prev.rows[0].count_strict;
      await query(
        `UPDATE payout_rows SET ${col}=$2 WHERE id=$1 AND week_id=$3`,
        [rowId, counted, weekId],
      );
      await query(
        `UPDATE payout_row_reprimands SET counted=$2 WHERE row_id=$1 AND type=$3`,
        [rowId, counted, kind],
      );
      const recomputed = await recomputeRowEvents(rowId, user.id);
      await writePayoutLog(weekId, user.id, 'reprimand.type_toggle', {
        rowId,
        nickname: prev.rows[0].nickname,
        kind,
        counted,
        eventsMc: recomputed?.events_mc,
        eventsDollars: recomputed?.events_dollars,
        changes: [{
          label: kind === 'verbal' ? 'Учёт устных выговоров (−50% за шт.)' : 'Учёт строгих выговоров (−100% за шт.)',
          before,
          after: counted,
        }],
        summary: `${prev.rows[0].nickname}: ${kind === 'verbal' ? 'устные' : 'строгие'} ${counted ? 'учтены' : 'сняты'} → ${recomputed?.events_mc ?? '—'} MC / ${recomputed?.events_dollars ?? '—'} $`,
      });
      return ok({
        updated: true,
        row: {
          id: rowId,
          count_verbal: kind === 'verbal' ? counted : prev.rows[0].count_verbal,
          count_strict: kind === 'strict' ? counted : prev.rows[0].count_strict,
          events_mc: recomputed?.events_mc,
          events_dollars: recomputed?.events_dollars,
          fixed_mc: recomputed?.fixed_mc,
          fixed_dollars: recomputed?.fixed_dollars,
        },
      });
    }

    if (action === 'toggle_reprimand') {
      // совместимость: переключает тип целиком
      const rowId = Number(body.rowId);
      const reprimandId = Number(body.reprimandId);
      const counted = body.counted === true || body.counted === 'true';
      const hit = await query<{ type: string }>(
        'SELECT type FROM payout_row_reprimands WHERE row_id=$1 AND reprimand_id=$2',
        [rowId, reprimandId],
      );
      const kind = hit.rows[0]?.type;
      const prev = await query<{ nickname: string; count_verbal: boolean; count_strict: boolean }>(
        `SELECT nickname,
                COALESCE(count_verbal, TRUE) AS count_verbal,
                COALESCE(count_strict, TRUE) AS count_strict
         FROM payout_rows WHERE id=$1 AND week_id=$2`,
        [rowId, weekId],
      );
      let recomputed: Awaited<ReturnType<typeof recomputeRowEvents>> = null;
      if (kind === 'verbal' || kind === 'strict') {
        const col = kind === 'verbal' ? 'count_verbal' : 'count_strict';
        await query(`UPDATE payout_rows SET ${col}=$2 WHERE id=$1 AND week_id=$3`, [rowId, counted, weekId]);
        await query(
          `UPDATE payout_row_reprimands SET counted=$2 WHERE row_id=$1 AND type=$3`,
          [rowId, counted, kind],
        );
        recomputed = await recomputeRowEvents(rowId, user.id);
      }
      await writePayoutLog(weekId, user.id, 'reprimand.toggle', {
        rowId,
        reprimandId,
        nickname: prev.rows[0]?.nickname,
        kind,
        counted,
        eventsMc: recomputed?.events_mc,
        eventsDollars: recomputed?.events_dollars,
        changes: kind ? [{
          label: kind === 'verbal' ? 'Учёт устных выговоров (−50% за шт.)' : 'Учёт строгих выговоров (−100% за шт.)',
          before: !counted,
          after: counted,
        }] : [],
      });
      return ok({
        updated: true,
        row: recomputed ? {
          id: rowId,
          count_verbal: kind === 'verbal' ? counted : prev.rows[0]?.count_verbal,
          count_strict: kind === 'strict' ? counted : prev.rows[0]?.count_strict,
          events_mc: recomputed.events_mc,
          events_dollars: recomputed.events_dollars,
          fixed_mc: recomputed.fixed_mc,
          fixed_dollars: recomputed.fixed_dollars,
        } : undefined,
      });
    }

    if (action === 'update_row') {
      const rowId = Number(body.rowId);
      if (!Number.isFinite(rowId)) return jsonError('rowId обязателен.', 400);
      const current = await query<Record<string, unknown>>(
        'SELECT * FROM payout_rows WHERE id=$1 AND week_id=$2',
        [rowId, weekId],
      );
      if (!current.rows[0]) return jsonError('Строка не найдена.', 404);
      const beforeRow = current.rows[0];

      const fields: string[] = [];
      const values: unknown[] = [];
      const changes: Array<{ field: string; label: string; before: unknown; after: unknown }> = [];
      const push = (col: string, val: unknown) => {
        values.push(val);
        fields.push(`${col}=$${values.length}`);
        const prev = beforeRow[col];
        if (humanValue(prev) !== humanValue(val)) {
          changes.push({
            field: col,
            label: fieldLabel(col),
            before: prev,
            after: val,
          });
        }
      };

      if (body.static_id != null || body.staticId != null) {
        push('static_id', String(body.static_id ?? body.staticId ?? ''));
      }
      if (body.events_mc != null || body.eventsMc != null) {
        push('events_mc', n(body.events_mc ?? body.eventsMc));
        push('events_override', true);
      }
      if (body.events_dollars != null || body.eventsDollars != null) {
        push('events_dollars', n(body.events_dollars ?? body.eventsDollars));
        push('events_override', true);
      }
      if (body.bonus_mc != null || body.bonusMc != null) push('bonus_mc', n(body.bonus_mc ?? body.bonusMc));
      if (body.bonus_dollars != null || body.bonusDollars != null) {
        push('bonus_dollars', n(body.bonus_dollars ?? body.bonusDollars));
      }
      if (body.bonus_note != null || body.bonusNote != null) {
        push('bonus_note', String(body.bonus_note ?? body.bonusNote ?? ''));
      }
      if (body.comp_static_id != null || body.compStaticId != null) {
        push('comp_static_id', String(body.comp_static_id ?? body.compStaticId ?? ''));
      }
      if (body.comp_dollars != null || body.compDollars != null) {
        push('comp_dollars', n(body.comp_dollars ?? body.compDollars));
      }
      if (body.include_in_payout != null || body.includeInPayout != null) {
        push(
          'include_in_payout',
          body.include_in_payout === true
            || body.include_in_payout === 'true'
            || body.includeInPayout === true
            || body.includeInPayout === 'true',
        );
      }
      if (body.mp_count != null || body.mpCount != null) {
        push('mp_count', Math.max(0, Math.floor(n(body.mp_count ?? body.mpCount))));
      }
      if (body.gmp_count != null || body.gmpCount != null) {
        push('gmp_count', Math.max(0, Math.floor(n(body.gmp_count ?? body.gmpCount))));
      }
      if (body.role_name != null || body.roleName != null) {
        push('role_name', String(body.role_name ?? body.roleName ?? ''));
      }
      if (body.count_verbal != null || body.countVerbal != null) {
        push(
          'count_verbal',
          body.count_verbal === true || body.count_verbal === 'true' || body.countVerbal === true,
        );
      }
      if (body.count_strict != null || body.countStrict != null) {
        push(
          'count_strict',
          body.count_strict === true || body.count_strict === 'true' || body.countStrict === true,
        );
      }

      if (!fields.length) return jsonError('Нет полей для обновления.', 400);
      values.push(rowId, weekId);
      await query(
        `UPDATE payout_rows SET ${fields.join(', ')} WHERE id=$${values.length - 1} AND week_id=$${values.length}`,
        values,
      );
      await writePayoutLog(weekId, user.id, 'row.update', {
        rowId,
        nickname: beforeRow.nickname,
        changes: changes.filter((c) => c.field !== 'events_override'),
      });
      return ok({ updated: true });
    }

    if (action === 'delete_row') {
      const rowId = Number(body.rowId);
      const prev = await query<{ nickname: string }>(
        'SELECT nickname FROM payout_rows WHERE id=$1 AND week_id=$2',
        [rowId, weekId],
      );
      await query('DELETE FROM payout_rows WHERE id=$1 AND week_id=$2', [rowId, weekId]);
      await writePayoutLog(weekId, user.id, 'row.delete', {
        rowId,
        nickname: prev.rows[0]?.nickname,
        summary: 'Сотрудник убран из ведомости',
      });
      return ok({ deleted: true });
    }

    return jsonError('Неизвестное действие.', 400);
  }

  if (key === 'payout-rebuild' && method === 'POST') {
    const user = await requiredPerm('manage_payouts', { level: 'edit' });
    if (user instanceof NextResponse) return user;
    const weekId = parseId(params.id);
    const week = await query<{ status: string; week_start: string }>(
      'SELECT status, week_start::text AS week_start FROM payout_weeks WHERE id=$1',
      [weekId],
    );
    if (!week.rows[0]) return jsonError('Неделя не найдена.', 404);
    if (week.rows[0].status === 'locked') return jsonError('Неделя заблокирована.', 400);
    await rebuildPayoutWeekRows(weekId, week.rows[0].week_start, {
      actorId: user.id,
      forceAll: body.force === true,
    });
    return ok({ rebuilt: true });
  }

  if (key === 'payout-breakdown' && method === 'GET') {
    const user = await requiredPerm('manage_payouts');
    if (user instanceof NextResponse) return user;
    const weekId = parseId(params.id);
    const rowId = Number(request.nextUrl.searchParams.get('rowId') || 0);
    if (!Number.isFinite(rowId) || rowId <= 0) return jsonError('Укажите строку.', 400);

    const week = await query<{ week_start: string }>(
      'SELECT week_start::text AS week_start FROM payout_weeks WHERE id=$1',
      [weekId],
    );
    if (!week.rows[0]) return jsonError('Неделя не найдена.', 404);

    const row = await query<{
      id: number;
      user_id: number;
      nickname: string;
      role_name: string;
      role_color: string;
      mp_count: number;
      gmp_count: number;
      events_mc: number;
      events_dollars: number;
      events_override: boolean;
      count_verbal: boolean;
      count_strict: boolean;
      breakdown: unknown;
    }>(
      `SELECT id, user_id, nickname, role_name, role_color, mp_count, gmp_count,
              events_mc, events_dollars, events_override,
              COALESCE(count_verbal, TRUE) AS count_verbal,
              COALESCE(count_strict, TRUE) AS count_strict,
              breakdown
       FROM payout_rows WHERE id=$1 AND week_id=$2`,
      [rowId, weekId],
    );
    if (!row.rows[0]) return jsonError('Строка не найдена.', 404);

    const r = row.rows[0];
    const reps = await query<{ type: string; counted: boolean }>(
      `SELECT type, COALESCE(counted, TRUE) AS counted FROM payout_row_reprimands WHERE row_id=$1`,
      [rowId],
    );
    const verbalCount = reps.rows.filter((x) => x.type === 'verbal' && x.counted).length;
    const strictCount = reps.rows.filter((x) => x.type === 'strict' && x.counted).length;

    const computed = await computeUserPayoutForWeek(
      r.user_id,
      week.rows[0].week_start,
      {
        countVerbal: true,
        countStrict: true,
        verbalCount,
        strictCount,
      },
    );

    return NextResponse.json({
      row: {
        id: r.id,
        userId: r.user_id,
        nickname: r.nickname,
        roleName: r.role_name,
        roleColor: r.role_color,
        mpCount: r.mp_count,
        gmpCount: r.gmp_count,
        eventsMc: n(r.events_mc),
        eventsDollars: n(r.events_dollars),
        eventsOverride: !!r.events_override,
      },
      breakdown: computed.breakdown,
      computedTotals: {
        mpCount: computed.mp_count,
        gmpCount: computed.gmp_count,
        eventsMc: computed.events_mc,
        eventsDollars: computed.events_dollars,
        roleName: computed.role_name,
        roleColor: computed.role_color,
      },
    });
  }

  if (key === 'payout-export' && method === 'GET') {
    const user = await requiredPerm('manage_payouts');
    if (user instanceof NextResponse) return user;
    const weekId = parseId(params.id);
    const rows = await query<Record<string, unknown>>(
      `SELECT pr.*,
              COALESCE(NULLIF(TRIM(pr.static_id), ''), NULLIF(TRIM(u.static_id), ''), '') AS export_static_id
       FROM payout_rows pr
       LEFT JOIN users u ON u.id = pr.user_id
       WHERE pr.week_id=$1
       ORDER BY pr.nickname`,
      [weekId],
    );
    return NextResponse.json({
      export: buildExportCommands(
        rows.rows.map((r) => ({
          include_in_payout: !!r.include_in_payout,
          static_id: String(r.export_static_id || r.static_id || ''),
          nickname: String(r.nickname || ''),
          events_mc: n(r.events_mc),
          events_dollars: n(r.events_dollars),
          fixed_mc: n(r.fixed_mc),
          fixed_dollars: n(r.fixed_dollars),
          bonus_mc: n(r.bonus_mc),
          bonus_dollars: n(r.bonus_dollars),
          comp_static_id: String(r.comp_static_id || ''),
          comp_dollars: n(r.comp_dollars),
        })),
      ),
    });
  }

  if (key === 'payout-log' && method === 'GET') {
    const user = await requiredPerm('manage_payouts');
    if (user instanceof NextResponse) return user;
    const weekId = parseId(params.id);
    const logs = await query<Record<string, unknown>>(
      `SELECT pl.*, u.nickname AS actor_nickname
       FROM payout_log pl
       LEFT JOIN users u ON u.id = pl.actor_id
       WHERE pl.week_id = $1
       ORDER BY pl.created_at DESC
       LIMIT 500`,
      [weekId],
    );
    return NextResponse.json({ log: logs.rows });
  }

  // candidates for add-user
  if (key === 'payout-members' && method === 'GET') {
    const user = await requiredPerm('manage_payouts');
    if (user instanceof NextResponse) return user;
    const weekId = Number(request.nextUrl.searchParams.get('weekId') || 0);
    const members = await query<Record<string, unknown>>(
      `SELECT u.id, u.nickname, u.static_id, r.name AS role_name
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.status = 'member'
         AND EXISTS (
           SELECT 1 FROM user_roles ur
           JOIN roles rr ON rr.id = ur.role_id
           WHERE ur.user_id = u.id AND rr.include_in_helper_payouts = TRUE
         )
         AND NOT EXISTS (
           SELECT 1 FROM payout_rows pr WHERE pr.week_id = $1 AND pr.user_id = u.id
         )
       ORDER BY u.nickname`,
      [weekId || 0],
    );
    return NextResponse.json({ members: members.rows });
  }

  return undefined;
};
