export interface AuditEntry {
  actorId?: string;
  actorRole?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}

export async function auditLog(entry: AuditEntry): Promise<void> {
  // TODO: write to audit_logs table once DB is set up
  console.log('[AUDIT]', entry.action, entry.targetType, entry.targetId);
}
