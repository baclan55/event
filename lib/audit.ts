import { query } from '@/lib/db';

type AuditEvent = {
  actorId: number;
  action: string;
  entityType: string;
  entityId?: number | string | null;
  details?: Record<string, unknown>;
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

export async function listAudit(limit = 100) {
  try {
    const result = await query(
      `SELECT al.id, al.action, al.entity_type, al.entity_id, al.details, al.created_at,
              actor.nickname AS actor_nickname
       FROM audit_log al
       LEFT JOIN users actor ON actor.id=al.actor_id
       ORDER BY al.created_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  } catch (error) {
    if (isMissingAuditTable(error)) {
      console.warn('[audit] Таблица audit_log ещё не создана. Выполните npm run db:migrate');
      return [];
    }
    throw error;
  }
}
