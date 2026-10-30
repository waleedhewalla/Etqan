import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, count, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { getDb } from '../../db';
import { reviewLogs, sectionEnrollments, sections, studentCards, tenants, users } from '../../db/schema';
import { isTenantAdmin } from '../../lib/access';
import { planFeatures, planStatus } from '../../lib/plan';
import { loadStudentSignals, riskLevel, riskReasons } from '../../lib/risk';

const overviewQuery = z.object({ tenantId: z.string().uuid().optional() });
const MAX_LISTED = 50;

export async function adminRoutes(app: FastifyInstance) {
  const db = getDb();

  // GET /v1/admin/tenants — every institution (superadmin only), to pick one to look at
  app.get('/admin/tenants', { preHandler: [app.authenticate] }, async (request) => {
    if (request.user.role !== 'superadmin') return request.server.httpErrors.forbidden('Superadmin only');
    return db.select({ id: tenants.id, nameAr: tenants.nameAr, slug: tenants.slug, planTier: tenants.planTier, active: tenants.active })
      .from(tenants).orderBy(asc(tenants.nameAr));
  });

  // GET /v1/admin/overview — an institution at a glance: usage, activity, and the students who need follow-up
  app.get('/admin/overview', { schema: { querystring: overviewQuery }, preHandler: [app.authenticate] }, async (request) => {
    const user = request.user;
    if (!isTenantAdmin(user)) return request.server.httpErrors.forbidden('Administrators only');
    const { tenantId: requested } = request.query as z.infer<typeof overviewQuery>;
    // Only a superadmin may look at another institution; everyone else sees their own.
    const tenantId = user.role === 'superadmin' && requested ? requested : user.facultyId;
    if (!tenantId) return request.server.httpErrors.forbidden('No institution on this account');

    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) return request.server.httpErrors.notFound('Institution not found');

    const halaqat = await db.select({ id: sections.id, nameAr: sections.nameAr, active: sections.active })
      .from(sections).where(eq(sections.tenantId, tenantId));
    const sectionName = new Map(halaqat.map((h) => [h.id, h.nameAr]));

    // Students currently in a halaqa of this institution, with the halaqat they are in.
    const enrolled = await db.select({ studentId: users.id, displayNameAr: users.displayNameAr, sectionId: sectionEnrollments.sectionId })
      .from(sectionEnrollments)
      .innerJoin(users, eq(sectionEnrollments.studentId, users.id))
      .innerJoin(sections, eq(sectionEnrollments.sectionId, sections.id))
      .where(and(eq(sections.tenantId, tenantId), isNull(sectionEnrollments.droppedAt)));
    const students = new Map<string, { displayNameAr: string; halaqat: string[] }>();
    for (const e of enrolled) {
      const s = students.get(e.studentId) ?? { displayNameAr: e.displayNameAr, halaqat: [] };
      s.halaqat.push(sectionName.get(e.sectionId) ?? '');
      students.set(e.studentId, s);
    }
    const ids = [...students.keys()];
    const signals = await loadStudentSignals(db, ids);

    const now = Date.now();
    const weekAgo = new Date(now - 7 * 86_400_000);
    const twoWeeksAgo = new Date(now - 14 * 86_400_000);
    const reviewsIn = async (from: Date, to?: Date) => {
      if (ids.length === 0) return 0;
      const [r] = await db.select({ n: count() }).from(reviewLogs)
        .innerJoin(studentCards, eq(reviewLogs.cardId, studentCards.id))
        .where(and(inArray(studentCards.studentId, ids), gte(reviewLogs.reviewedAt, from), ...(to ? [lt(reviewLogs.reviewedAt, to)] : [])));
      return r?.n ?? 0;
    };
    const [reviewsThisWeek, reviewsLastWeek] = await Promise.all([reviewsIn(weekAgo), reviewsIn(twoWeeksAgo, weekAgo)]);

    const sigList = ids.map((id) => signals.get(id)!);
    const flagged = ids.flatMap((id) => {
      const sig = signals.get(id)!;
      const level = riskLevel(sig);
      if (level === 'none') return [];
      const s = students.get(id)!;
      return [{
        studentId: id, displayNameAr: s.displayNameAr, halaqat: [...new Set(s.halaqat)], level,
        reasons: riskReasons(sig), inactiveDays: sig.inactiveDays, attendanceRate: sig.attendanceRate,
        masteryPercent: sig.masteryPercent, lastActiveAt: sig.lastActiveAt,
      }];
    }).sort((a, b) =>
      (a.level === b.level ? 0 : a.level === 'high' ? -1 : 1) ||
      // never started first, then the longest away
      (a.inactiveDays === null ? -1 : b.inactiveDays === null ? 1 : b.inactiveDays - a.inactiveDays) ||
      a.displayNameAr.localeCompare(b.displayNameAr, 'ar'));

    const [{ activeThisWeek }] = ids.length
      ? await db.select({ activeThisWeek: sql<number>`count(distinct ${studentCards.studentId})`.mapWith(Number) }).from(reviewLogs)
        .innerJoin(studentCards, eq(reviewLogs.cardId, studentCards.id))
        .where(and(inArray(studentCards.studentId, ids), gte(reviewLogs.reviewedAt, weekAgo)))
      : [{ activeThisWeek: 0 }];

    return {
      institution: {
        id: tenant.id, nameAr: tenant.nameAr, slug: tenant.slug, domain: tenant.domain, active: tenant.active,
        plan: {
          tier: tenant.planTier, maxStudents: tenant.planMaxStudents, maxHalaqat: tenant.planMaxHalaqat,
          /** Features in effect: the tier's plus any added for this institution (none once the plan has expired). */
          features: [...planFeatures(tenant)].sort(), validUntil: tenant.planValidUntil,
          status: planStatus(tenant, { students: ids.length, halaqat: halaqat.filter((h) => h.active).length }),
        },
      },
      usage: { students: ids.length, halaqat: halaqat.filter((h) => h.active).length },
      activity: {
        reviewsThisWeek, reviewsLastWeek, activeThisWeek,
        activeToday: sigList.filter((s) => s.reviewsToday > 0).length,
        avgMastery: sigList.length ? Math.round(sigList.reduce((a, s) => a + s.masteryPercent, 0) / sigList.length) : 0,
      },
      atRisk: {
        high: flagged.filter((f) => f.level === 'high').length,
        medium: flagged.filter((f) => f.level === 'medium').length,
        students: flagged.slice(0, MAX_LISTED),
        truncated: flagged.length > MAX_LISTED,
      },
    };
  });
}
