import { query } from '@/lib/db';
import { auditHref } from '@/lib/auditShared';

export { AUDIT_LABELS, DEFAULT_CLOSED_MESSAGE, auditHref } from '@/lib/auditShared';

type AuditEvent = {
  actorId: number;
  action: string;
  entityType: string;
  entityId?: number | string | null;
  details?: Record<string, unknown>;
};

export type AuditFilters = {
  limit?: number;
  action?: string | null;
  actor?: string | null;
  /** Фильтр по участнику: как актёр или как цель записи. */
  userId?: number | null;
  from?: string | null;
  to?: string | null;
};

function isMissingAuditTable(error: unknown): boolean {
  return (error as { code?: string })?.code === '42P01';
}

export async function writeAudit({
  actorId,
  action,
  entityType,
  entityId = null,
  details = {},
}: AuditEvent): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_log(actor_id, action, entity_type, entity_id, details)
       VALUES($1, $2, $3, $4, $5::jsonb)`,
      [actorId, action, entityType, entityId == null ? null : String(entityId), JSON.stringify(details)]
    );
  } catch (error) {
    if (isMissingAuditTable(error)) {
      console.warn('[audit] Таблица audit_log ещё не создана. Выполните npm run db:migrate');
      return;
    }
    throw error;
  }
}

export async function listAudit(filters: AuditFilters | number = 100) {
  const opts: AuditFilters = typeof filters === 'number' ? { limit: filters } : filters;
  const limit = Math.min(Math.max(Number(opts.limit) || 150, 1), 300);
  const values: unknown[] = [];
  const where: string[] = [];

  if (opts.action) {
    values.push(opts.action);
    where.push(`al.action = $${values.length}`);
  }
  if (opts.actor) {
    values.push(`%${opts.actor.trim()}%`);
    where.push(`actor.nickname ILIKE $${values.length}`);
  }
  if (opts.userId != null && Number.isFinite(Number(opts.userId))) {
    values.push(Number(opts.userId));
    const i = values.length;
    where.push(`(
      al.actor_id = $${i}
      OR (al.entity_type = 'user' AND al.entity_id = $${i}::text)
      OR (al.details->>'userId') = $${i}::text
      OR (al.details->>'candidateUserId') = $${i}::text
    )`);
  }
  if (opts.from && /^\d{4}-\d{2}-\d{2}$/.test(opts.from)) {
    values.push(opts.from);
    where.push(`al.created_at >= $${values.length}::date`);
  }
  if (opts.to && /^\d{4}-\d{2}-\d{2}$/.test(opts.to)) {
    values.push(opts.to);
    where.push(`al.created_at < ($${values.length}::date + INTERVAL '1 day')`);
  }

  values.push(limit);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const result = await query<Record<string, unknown>>(
      `SELECT al.id, al.action, al.entity_type, al.entity_id, al.details, al.created_at,
              actor.id AS actor_id, actor.nickname AS actor_nickname,
              CASE
                WHEN al.entity_type = 'user' AND al.entity_id ~ '^[0-9]+$'
                  THEN (SELECT nickname FROM users WHERE id = al.entity_id::int)
                WHEN (al.details->>'userId') ~ '^[0-9]+$'
                  THEN (SELECT nickname FROM users WHERE id = (al.details->>'userId')::int)
                WHEN (al.details->>'candidateUserId') ~ '^[0-9]+$'
                  THEN (SELECT nickname FROM users WHERE id = (al.details->>'candidateUserId')::int)
                WHEN (al.details->>'nickname') IS NOT NULL
                  THEN al.details->>'nickname'
                ELSE NULL
              END AS target_nickname
       FROM audit_log al
       LEFT JOIN users actor ON actor.id=al.actor_id
       ${whereSql}
       ORDER BY al.created_at DESC
       LIMIT $${values.length}`,
      values
    );
    return result.rows.map((row) => ({
      ...row,
      href: auditHref({
        entity_type: row.entity_type as string,
        entity_id: row.entity_id as string | null,
        details: (row.details || {}) as Record<string, unknown>,
      }),
    }));
  } catch (error) {
    if (isMissingAuditTable(error)) {
      console.warn('[audit] Таблица audit_log ещё не создана. Выполните npm run db:migrate');
      return [];
    }
    throw error;
  }
}

export async function listAuditActions() {
  try {
    const result = await query<{ action: string }>(
      `SELECT DISTINCT action FROM audit_log ORDER BY action`,
    );
    return result.rows.map((row) => row.action);
  } catch (error) {
    if (isMissingAuditTable(error)) return [];
    throw error;
  }
}
