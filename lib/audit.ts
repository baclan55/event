import { query } from '@/lib/db';

type AuditEvent = {
  actorId: number;
  action: string;
  entityType: string;
  entityId?: number | string | null;
  details?: Record<string, unknown>;
};

export async function writeAudit({
  actorId,
  action,
  entityType,
  entityId = null,
  details = {},
}: AuditEvent): Promise<void> {
  await query(
    `INSERT INTO audit_log(actor_id, action, entity_type, entity_id, details)
     VALUES($1, $2, $3, $4, $5::jsonb)`,
    [actorId, action, entityType, entityId == null ? null : String(entityId), JSON.stringify(details)]
  );
}
