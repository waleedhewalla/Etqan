import { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { getDb } from '../../db';
import { studentBadges } from '../../db/schema';
import { BADGE_CATALOG, isEarned, loadMetrics, progressFor } from '../../lib/badges';

export async function badgeRoutes(app: FastifyInstance) {
  const db = getDb();

  // GET /v1/badges — the whole catalog with what the signed-in student has earned and how far she is from the rest
  app.get('/badges', { preHandler: [app.authenticate] }, async (request) => {
    const studentId = request.user.sub;
    const [metrics, earned] = await Promise.all([
      loadMetrics(db, studentId),
      db.select({ id: studentBadges.badgeId, at: studentBadges.earnedAt }).from(studentBadges).where(eq(studentBadges.studentId, studentId)),
    ]);
    const earnedAt = new Map(earned.map((e) => [e.id, e.at]));

    return BADGE_CATALOG.map((b) => ({
      id: b.id, nameAr: b.nameAr, descriptionAr: b.descriptionAr, icon: b.icon, tier: b.tier, category: b.category,
      // A badge counts as earned once awarded, even if progress later dips (for example a card slipping from "mastered").
      earned: earnedAt.has(b.id), earnedAt: earnedAt.get(b.id) ?? null,
      progress: earnedAt.has(b.id) ? { current: b.conditionValue, target: b.conditionValue } : progressFor(b, metrics),
      ready: !earnedAt.has(b.id) && isEarned(b, metrics),
    }));
  });
}
