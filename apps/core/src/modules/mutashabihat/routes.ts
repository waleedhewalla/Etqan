import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { getDb } from '../../db';
import { mutashabihatClusters, mutashabihatLinks, mutashabihatDrills } from '../../db/schema';

const createClusterSchema = z.object({
  ayahRefs: z.array(z.string().regex(/^\d+:\d+$/)).min(2),
  source: z.enum(['kirmani', 'ansari', 'sakhawi', 'other']).default('other'),
  tawjihAr: z.string().optional(),
});

const answerDrillSchema = z.object({
  answer: z.string(),
});

export async function mutashabihatRoutes(app: FastifyInstance) {
  const db = getDb();

  // GET /v1/mutashabihat/clusters — List clusters
  app.get('/mutashabihat/clusters', {
    preHandler: [app.authenticate],
  }, async () => {
    return db.select().from(mutashabihatClusters)
      .where(eq(mutashabihatClusters.approvalStatus, 'approved'));
  });

  // POST /v1/mutashabihat/clusters — Create cluster
  app.post('/mutashabihat/clusters', {
    schema: { body: createClusterSchema },
    preHandler: [app.authenticate],
  }, async (request) => {
    const body = request.body as z.infer<typeof createClusterSchema>;

    const [cluster] = await db.insert(mutashabihatClusters).values({
      ayahRefs: body.ayahRefs,
      source: body.source,
      tawjihAr: body.tawjihAr,
      approvalStatus: 'draft',
    }).returning();

    // Auto-generate pairwise links
    const links = [];
    for (let i = 0; i < body.ayahRefs.length; i++) {
      for (let j = i + 1; j < body.ayahRefs.length; j++) {
        links.push({
          clusterId: cluster.id,
          ayahRefA: body.ayahRefs[i],
          ayahRefB: body.ayahRefs[j],
          strength: 0.5,
        });
      }
    }

    if (links.length > 0) {
      await db.insert(mutashabihatLinks).values(links);
    }

    return cluster;
  });

  // GET /v1/mutashabihat/clusters/:id — Get cluster with links
  app.get('/mutashabihat/clusters/:id', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };

    const [cluster] = await db.select()
      .from(mutashabihatClusters)
      .where(eq(mutashabihatClusters.id, id))
      .limit(1);

    if (!cluster) return request.server.httpErrors.notFound('Cluster not found');

    const links = await db.select()
      .from(mutashabihatLinks)
      .where(eq(mutashabihatLinks.clusterId, id));

    return { ...cluster, links };
  });

  // GET /v1/mutashabihat/for-ayah/:ref — Find clusters containing an ayah
  app.get('/mutashabihat/for-ayah/:ref', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { ref } = request.params as { ref: string };

    const clusters = await db.select()
      .from(mutashabihatClusters)
      .where(sql`${mutashabihatClusters.ayahRefs} @> ${JSON.stringify([ref])}::jsonb`);

    return clusters;
  });

  // POST /v1/mutashabihat/drills/generate — Generate a drill for a cluster
  app.post('/mutashabihat/drills/generate', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const userId = request.user.sub;
    const { clusterId, drillType } = request.body as {
      clusterId: string;
      drillType: 'drag-drop' | 'cloze' | 'timed-choice' | 'split-comparison';
    };

    const [cluster] = await db.select()
      .from(mutashabihatClusters)
      .where(eq(mutashabihatClusters.id, clusterId))
      .limit(1);

    if (!cluster) return request.server.httpErrors.notFound('Cluster not found');

    const refs = cluster.ayahRefs as string[];
    const correctIdx = Math.floor(Math.random() * refs.length);
    const correctRef = refs[correctIdx];

    const [drill] = await db.insert(mutashabihatDrills).values({
      studentId: userId,
      clusterId,
      drillType,
      question: `أي آية هي: ${correctRef}؟`,
      options: refs,
      correctAnswer: correctRef,
    }).returning();

    return drill;
  });

  // POST /v1/mutashabihat/drills/:id/answer — Answer a drill
  app.post('/mutashabihat/drills/:id/answer', {
    schema: { body: answerDrillSchema },
    preHandler: [app.authenticate],
  }, async (request) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const { answer } = request.body as z.infer<typeof answerDrillSchema>;

    const [drill] = await db.select()
      .from(mutashabihatDrills)
      .where(and(eq(mutashabihatDrills.id, id), eq(mutashabihatDrills.studentId, userId)))
      .limit(1);

    if (!drill) return request.server.httpErrors.notFound('Drill not found');

    const wasCorrect = drill.correctAnswer === answer;

    await db.update(mutashabihatDrills)
      .set({ studentAnswer: answer, wasCorrect, answeredAt: new Date() })
      .where(eq(mutashabihatDrills.id, id));

    return { drillId: id, wasCorrect, correctAnswer: drill.correctAnswer };
  });
}
