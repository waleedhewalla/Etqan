import { eq } from 'drizzle-orm';
import { getDb } from '../../db';
import { auditLogs, users } from '../../db/schema';

export interface AuditEntry {
  actorId?: string;
  actorRole?: string;
  tenantId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Records who did what to the audit_logs table. Never throws: a failed audit write
 * is logged but must not break the request it describes.
 */
export async function auditLog(entry: AuditEntry): Promise<void> {
  try {
    const db = getDb();
    const userId = entry.actorId && UUID.test(entry.actorId) ? entry.actorId : null;

    // Scope the entry to the actor's institution so admins only see their own.
    let tenantId = entry.tenantId ?? null;
    if (!tenantId && userId) {
      const [u] = await db.select({ tenantId: users.tenantId }).from(users).where(eq(users.id, userId)).limit(1);
      tenantId = u?.tenantId ?? null;
    }

    const targetIsId = Boolean(entry.targetId && UUID.test(entry.targetId));
    await db.insert(auditLogs).values({
      userId,
      tenantId,
      action: entry.action,
      resource: entry.targetType ?? 'unknown',
      resourceId: targetIsId ? entry.targetId : null,
      details: {
        ...(entry.actorRole ? { actorRole: entry.actorRole } : {}),
        ...(entry.actorId && !userId ? { actor: entry.actorId } : {}),
        ...(entry.targetId && !targetIsId ? { target: entry.targetId } : {}),
        ...entry.metadata,
      },
      ipAddress: entry.ip ?? null,
    });
  } catch (err) {
    console.error('[AUDIT] could not record', entry.action, err instanceof Error ? err.message : err);
  }
}
