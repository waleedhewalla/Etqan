import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { compareRefs, parseRef } from '@itqan/quran';
import { getDb } from '../../db';
import { mutashabihatClusters, mutashabihatDrills, mutashabihatLinks, quranAyat, studentCards } from '../../db/schema';
import type { TokenPayload } from '../../lib/jwt';
import { ADMIN_ROLES, isStaff } from '../../lib/access';
import { applyRating } from '../../lib/cards';
import { buildChoice, buildCloze, distinctAyat, type ClusterAyah } from '../../lib/mutashabihat';

const MAX_CLUSTER_AYAT = 6;

const createClusterSchema = z.object({
  ayahRefs: z.array(z.string()).min(2).max(MAX_CLUSTER_AYAT),
  source: z.enum(['kirmani', 'ansari', 'sakhawi', 'other']).default('other'),
  tawjihAr: z.string().trim().max(1000).optional(),
});
const reviewSchema = z.object({ decision: z.enum(['approved', 'rejected']) });
const generateSchema = z.object({
  clusterId: z.string().uuid(),
  drillType: z.enum(['cloze', 'timed-choice']),
  /** Ask about this verse in particular (it must belong to the cluster). */
  targetRef: z.string().optional(),
});
const answerDrillSchema = z.object({ answer: z.string().min(1).max(200) });

/** Scholars who may approve: the sheikha reviewer, or an administrator of the institution. */
const canApprove = (user: TokenPayload) => user.role === 'sheikh_reviewer' || (ADMIN_ROLES as readonly string[]).includes(user.role);

type Cluster = typeof mutashabihatClusters.$inferSelect;

/** Clusters this user may know about: shared ones and her own institution's. */
const visibleTo = (user: TokenPayload) => {
  const mine = user.facultyId ? or(isNull(mutashabihatClusters.tenantId), eq(mutashabihatClusters.tenantId, user.facultyId)) : isNull(mutashabihatClusters.tenantId);
  return user.role === 'superadmin' ? undefined : mine;
};

export async function mutashabihatRoutes(app: FastifyInstance) {
  const db = getDb();

  async function ayatFor(refs: string[]) {
    if (refs.length === 0) return new Map<string, string>();
    const rows = await db.select({ ref: quranAyat.ref, text: quranAyat.textUthmani }).from(quranAyat).where(inArray(quranAyat.ref, refs));
    return new Map(rows.map((r) => [r.ref, r.text]));
  }

  /** Adds the verse text to each cluster (empty when the Quran text is not loaded). */
  async function withAyat(clusters: Cluster[]) {
    const texts = await ayatFor([...new Set(clusters.flatMap((c) => c.ayahRefs))]);
    return clusters.map((c) => ({
      ...c,
      ayat: [...c.ayahRefs].sort((a, b) => compareRefs(parseRef(a)!, parseRef(b)!))
        .map((ref) => ({ ref, text: texts.get(ref) ?? null })),
    }));
  }

  async function loadVisible(user: TokenPayload, id: string, { approvedOnly }: { approvedOnly: boolean }) {
    const [cluster] = await db.select().from(mutashabihatClusters)
      .where(and(eq(mutashabihatClusters.id, id), visibleTo(user))).limit(1);
    if (!cluster) return null;
    if (cluster.approvalStatus !== 'approved' && (approvedOnly || !isStaff(user))) return null;
    return cluster;
  }

  // GET /v1/mutashabihat/clusters?status= — approved clusters; staff can also see their institution's drafts
  app.get('/mutashabihat/clusters', { preHandler: [app.authenticate] }, async (request) => {
    const user = request.user;
    const { status } = request.query as { status?: string };
    const wanted = isStaff(user) && status && ['pending_review', 'approved', 'rejected', 'draft'].includes(status) ? status : 'approved';
    const rows = await db.select().from(mutashabihatClusters)
      .where(and(eq(mutashabihatClusters.approvalStatus, wanted as Cluster['approvalStatus']), visibleTo(user)))
      .orderBy(desc(mutashabihatClusters.createdAt)).limit(200);
    return withAyat(rows);
  });

  // POST /v1/mutashabihat/clusters — a teacher proposes a group of look-alike verses; a scholar approves it
  app.post('/mutashabihat/clusters', { schema: { body: createClusterSchema }, preHandler: [app.authenticate] }, async (request) => {
    const user = request.user;
    if (!isStaff(user) || !user.facultyId) return request.server.httpErrors.forbidden('Teachers only');
    const body = request.body as z.infer<typeof createClusterSchema>;

    const parsed = body.ayahRefs.map((r) => ({ r, p: parseRef(r) }));
    const bad = parsed.find((x) => !x.p);
    if (bad) return request.server.httpErrors.badRequest(`Invalid reference: ${bad.r}`);
    const refs = [...new Set(body.ayahRefs)];
    if (refs.length < 2) return request.server.httpErrors.badRequest('A cluster needs at least two different ayat');

    const [cluster] = await db.insert(mutashabihatClusters).values({
      ayahRefs: refs, source: body.source, tawjihAr: body.tawjihAr || null,
      tenantId: user.facultyId, createdBy: user.sub, approvalStatus: 'pending_review',
    }).returning();

    const links = refs.flatMap((a, i) => refs.slice(i + 1).map((b) => ({ clusterId: cluster.id, ayahRefA: a, ayahRefB: b, strength: 0.5 })));
    await db.insert(mutashabihatLinks).values(links);
    return (await withAyat([cluster]))[0];
  });

  // POST /v1/mutashabihat/clusters/:id/review — approve or reject (scholar or administrator of the same institution)
  app.post('/mutashabihat/clusters/:id/review', { schema: { body: reviewSchema }, preHandler: [app.authenticate] }, async (request) => {
    const user = request.user;
    const { id } = request.params as { id: string };
    const { decision } = request.body as z.infer<typeof reviewSchema>;
    const cluster = canApprove(user) ? await loadVisible(user, id, { approvedOnly: false }) : null;
    // A shared (curated) cluster belongs to no institution, so only the superadmin may rule on it.
    if (!cluster || (cluster.tenantId === null && user.role !== 'superadmin')) return request.server.httpErrors.notFound('Cluster not found');

    const [updated] = await db.update(mutashabihatClusters)
      .set({ approvalStatus: decision, approvedBy: user.sub, approvedAt: new Date() })
      .where(eq(mutashabihatClusters.id, id)).returning();
    return (await withAyat([updated]))[0];
  });

  // DELETE /v1/mutashabihat/clusters/:id — remove a proposal that was not approved
  app.delete('/mutashabihat/clusters/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user;
    const { id } = request.params as { id: string };
    const cluster = isStaff(user) ? await loadVisible(user, id, { approvedOnly: false }) : null;
    if (!cluster || cluster.tenantId === null || (cluster.createdBy !== user.sub && !canApprove(user))) {
      return request.server.httpErrors.notFound('Cluster not found');
    }
    if (cluster.approvalStatus === 'approved') return request.server.httpErrors.conflict('An approved cluster cannot be deleted; reject it instead');
    await db.delete(mutashabihatClusters).where(eq(mutashabihatClusters.id, id));
    return reply.code(204).send();
  });

  // GET /v1/mutashabihat/clusters/:id — one cluster with its verses
  app.get('/mutashabihat/clusters/:id', { preHandler: [app.authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    const cluster = await loadVisible(request.user, id, { approvedOnly: false });
    if (!cluster) return request.server.httpErrors.notFound('Cluster not found');
    return (await withAyat([cluster]))[0];
  });

  // GET /v1/mutashabihat/for-ayah/:ref — approved clusters that contain a verse
  app.get('/mutashabihat/for-ayah/:ref', { preHandler: [app.authenticate] }, async (request) => {
    const { ref } = request.params as { ref: string };
    if (!parseRef(ref)) return request.server.httpErrors.badRequest('Invalid reference');
    const rows = await db.select().from(mutashabihatClusters)
      .where(and(eq(mutashabihatClusters.approvalStatus, 'approved'), visibleTo(request.user)));
    // Filtered here rather than with a jsonb operator: drizzle stores this column as a JSON string, which
    // `@>` does not see into. Clusters are few (hundreds), so this is cheap.
    return withAyat(rows.filter((c) => c.ayahRefs.includes(ref)));
  });

  // GET /v1/mutashabihat/mine — approved clusters that include verses the student is memorizing
  app.get('/mutashabihat/mine', { preHandler: [app.authenticate] }, async (request) => {
    const cards = await db.select({ ref: studentCards.ayahRef }).from(studentCards).where(eq(studentCards.studentId, request.user.sub));
    if (cards.length === 0) return [];
    const mine = new Set(cards.map((c) => c.ref));
    const rows = await db.select().from(mutashabihatClusters)
      .where(and(eq(mutashabihatClusters.approvalStatus, 'approved'), visibleTo(request.user)));
    return withAyat(rows.filter((c) => c.ayahRefs.some((r) => mine.has(r))));
  });

  // POST /v1/mutashabihat/drills/generate — a question about one cluster
  app.post('/mutashabihat/drills/generate', { schema: { body: generateSchema }, preHandler: [app.authenticate] }, async (request) => {
    const { clusterId, drillType, targetRef } = request.body as z.infer<typeof generateSchema>;
    const cluster = await loadVisible(request.user, clusterId, { approvedOnly: true });
    if (!cluster) return request.server.httpErrors.notFound('Cluster not found');
    if (targetRef && !cluster.ayahRefs.includes(targetRef)) return request.server.httpErrors.badRequest('That verse is not in this cluster');

    const texts = await ayatFor(cluster.ayahRefs);
    const ayat: ClusterAyah[] = cluster.ayahRefs.flatMap((ref) => (texts.has(ref) ? [{ ref, text: texts.get(ref)! }] : []));
    if (ayat.length !== cluster.ayahRefs.length) return request.server.httpErrors.conflict('The Quran text is not loaded for this cluster yet');

    // "Which verse is this?" can only ask about verses worded differently from all the others in the cluster.
    const askable = drillType === 'cloze' ? ayat : distinctAyat(ayat);
    const pick = targetRef ? ayat.find((a) => a.ref === targetRef)! : askable[Math.floor(Math.random() * askable.length)];
    if (!pick) return request.server.httpErrors.conflict('These verses are worded identically, so the text cannot tell them apart');
    const others = ayat.filter((a) => a.ref !== pick.ref);
    const built = drillType === 'cloze' ? buildCloze(pick, others) : buildChoice(pick, ayat);
    if (!built) {
      return request.server.httpErrors.conflict(drillType === 'cloze'
        ? 'These verses differ by more than one swapped word; try the choice question'
        : 'Another verse in this cluster is worded identically, so the text cannot tell them apart');
    }

    const [drill] = await db.insert(mutashabihatDrills).values({
      studentId: request.user.sub, clusterId, drillType, targetRef: built.targetRef, question: built.question, options: built.options, correctAnswer: built.correctAnswer,
    }).returning();
    // The answer stays on the server until she has answered.
    const { correctAnswer: _hidden, studentAnswer: _a, wasCorrect: _w, ...safe } = drill;
    return safe;
  });

  // POST /v1/mutashabihat/drills/:id/answer — answer once; a wrong answer makes that verse come back sooner
  app.post('/mutashabihat/drills/:id/answer', { schema: { body: answerDrillSchema }, preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const { answer } = request.body as z.infer<typeof answerDrillSchema>;

    const [drill] = await db.select().from(mutashabihatDrills)
      .where(and(eq(mutashabihatDrills.id, id), eq(mutashabihatDrills.studentId, userId))).limit(1);
    if (!drill) return request.server.httpErrors.notFound('Drill not found');
    if (drill.answeredAt) return request.server.httpErrors.conflict('This question was already answered');
    if (!(drill.options ?? []).includes(answer)) return request.server.httpErrors.badRequest('Choose one of the options');

    const wasCorrect = drill.correctAnswer === answer;
    await db.update(mutashabihatDrills).set({ studentAnswer: answer, wasCorrect, answeredAt: new Date() }).where(eq(mutashabihatDrills.id, id));

    // Mixing up look-alikes means she does not know this verse apart from its twin yet: bring its card back sooner.
    let rescheduled = false;
    if (!wasCorrect) {
      if (drill.targetRef) {
        const [card] = await db.select().from(studentCards).where(and(eq(studentCards.studentId, userId), eq(studentCards.ayahRef, drill.targetRef))).limit(1);
        if (card) { await applyRating(db, card, 'hard'); rescheduled = true; }
      }
    }
    return { drillId: id, wasCorrect, correctAnswer: drill.correctAnswer, rescheduled };
  });
}
