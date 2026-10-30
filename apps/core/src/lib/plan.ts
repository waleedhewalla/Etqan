import { and, count, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db';
import { sectionEnrollments, sections, tenants } from '../db/schema';
import { config } from '../config';
import { ItqanError } from './errors';

type Tenant = typeof tenants.$inferSelect;
type Tier = Tenant['planTier'];

/** What each tier includes, before anything the institution's own `plan_features` adds. */
export const TIER_FEATURES: Record<Tier, string[]> = {
  free: [],
  madrasa_basic: ['analytics'],
  madrasa_pro: ['analytics', 'ai_checking', 'priority_support'],
  enterprise: ['analytics', 'ai_checking', 'priority_support'],
};

/** From this share of the limit, an institution is told it is nearly full. */
export const NEAR_LIMIT = 0.9;

export type LimitState = 'ok' | 'near' | 'full' | 'over';

export function limitState(used: number, limit: number): LimitState {
  if (limit > 0 && used > limit) return 'over';
  if (limit > 0 && used === limit) return 'full';
  if (limit > 0 && used / limit >= NEAR_LIMIT) return 'near';
  return 'ok';
}

export function planExpired(tenant: Pick<Tenant, 'planValidUntil'>, now = new Date()) {
  return Boolean(tenant.planValidUntil && tenant.planValidUntil.getTime() < now.getTime());
}

/** Features in effect: the tier's, plus any added for this institution. An expired plan includes none. */
export function planFeatures(tenant: Pick<Tenant, 'planTier' | 'planFeatures' | 'planValidUntil'>, now = new Date()) {
  if (planExpired(tenant, now)) return new Set<string>();
  return new Set([...TIER_FEATURES[tenant.planTier], ...(tenant.planFeatures ?? [])]);
}

export const planIncludes = (tenant: Pick<Tenant, 'planTier' | 'planFeatures' | 'planValidUntil'>, feature: string, now = new Date()) =>
  planFeatures(tenant, now).has(feature);

export interface PlanUsage { students: number; halaqat: number }

/** Students in a halaqa of the institution (each counted once) and its active halaqat. */
export async function loadUsage(db: Database, tenantId: string): Promise<PlanUsage> {
  const [s] = await db.select({ n: sql<number>`count(distinct ${sectionEnrollments.studentId})`.mapWith(Number) })
    .from(sectionEnrollments)
    .innerJoin(sections, eq(sectionEnrollments.sectionId, sections.id))
    .where(and(eq(sections.tenantId, tenantId), isNull(sectionEnrollments.droppedAt)));
  const [h] = await db.select({ n: count() }).from(sections).where(and(eq(sections.tenantId, tenantId), eq(sections.active, true)));
  return { students: s?.n ?? 0, halaqat: h?.n ?? 0 };
}

export interface PlanStatus {
  enforcement: 'warn' | 'block';
  expired: boolean;
  students: { used: number; limit: number; state: LimitState };
  halaqat: { used: number; limit: number; state: LimitState };
}

export function planStatus(tenant: Tenant, usage: PlanUsage, now = new Date()): PlanStatus {
  return {
    enforcement: config.PLAN_ENFORCEMENT,
    expired: planExpired(tenant, now),
    students: { used: usage.students, limit: tenant.planMaxStudents, state: limitState(usage.students, tenant.planMaxStudents) },
    halaqat: { used: usage.halaqat, limit: tenant.planMaxHalaqat, state: limitState(usage.halaqat, tenant.planMaxHalaqat) },
  };
}

export class PlanLimitError extends ItqanError {
  constructor(reason: 'students' | 'halaqat' | 'expired') {
    super(
      reason === 'expired' ? 'This institution\'s plan has expired' : `This institution has reached its plan limit of ${reason}`,
      'PLAN_LIMIT_REACHED', 403, { reason },
    );
  }
}

async function loadTenant(db: Database, tenantId: string) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return tenant ?? null;
}

/**
 * Called before a student is added to a halaqa. Only when PLAN_ENFORCEMENT=block, and only for a student who would
 * take a NEW seat: someone already in a halaqa of the institution moving to another is not counted again.
 */
export async function assertCanAddStudent(db: Database, tenantId: string, studentId?: string) {
  if (config.PLAN_ENFORCEMENT !== 'block') return;
  const tenant = await loadTenant(db, tenantId);
  if (!tenant) return;
  if (studentId) {
    const [already] = await db.select({ id: sectionEnrollments.id }).from(sectionEnrollments)
      .innerJoin(sections, eq(sectionEnrollments.sectionId, sections.id))
      .where(and(eq(sectionEnrollments.studentId, studentId), eq(sections.tenantId, tenantId), isNull(sectionEnrollments.droppedAt))).limit(1);
    if (already) return;
  }
  if (planExpired(tenant)) throw new PlanLimitError('expired');
  const { students } = await loadUsage(db, tenantId);
  if (students >= tenant.planMaxStudents) throw new PlanLimitError('students');
}

/** Called before a halaqa is created. Only when PLAN_ENFORCEMENT=block. */
export async function assertCanAddHalaqa(db: Database, tenantId: string) {
  if (config.PLAN_ENFORCEMENT !== 'block') return;
  const tenant = await loadTenant(db, tenantId);
  if (!tenant) return;
  if (planExpired(tenant)) throw new PlanLimitError('expired');
  const { halaqat } = await loadUsage(db, tenantId);
  if (halaqat >= tenant.planMaxHalaqat) throw new PlanLimitError('halaqat');
}
