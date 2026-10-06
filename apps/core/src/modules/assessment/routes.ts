import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { getDb } from '../../db';
import { tasmiSubmissions } from '../../db/schema';

const submitTasmiSchema = z.object({
  sectionId: z.string().uuid().optional(),
  startRef: z.string().regex(/^\d+:\d+$/),
  endRef: z.string().regex(/^\d+:\d+$/),
  audioUrl: z.string().url(),
  durationMs: z.number().int().min(0).optional(),
});

const reviewTasmiSchema = z.object({
  hifzScore: z.number().min(0).max(100),
  tajweedScore: z.number().min(0).max(100),
  fluencyScore: z.number().min(0).max(100),
  verdict: z.enum(['approved', 'redo', 'flagged']),
  notes: z.string().optional(),
});

export async function assessmentRoutes(app: FastifyInstance) {
  const db = getDb();

  // POST /v1/tasmi — Submit a recitation for assessment
  app.post('/tasmi', {
    schema: { body: submitTasmiSchema },
    preHandler: [app.authenticate],
  }, async (request) => {
    const userId = request.user.sub;
    const body = request.body as z.infer<typeof submitTasmiSchema>;

    const [submission] = await db.insert(tasmiSubmissions).values({
      studentId: userId,
      sectionId: body.sectionId,
      startRef: body.startRef,
      endRef: body.endRef,
      audioUrl: body.audioUrl,
      durationMs: body.durationMs,
    }).returning();

    return submission;
  });

  // GET /v1/tasmi — List student's submissions
  app.get('/tasmi', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const userId = request.user.sub;
    return db.select()
      .from(tasmiSubmissions)
      .where(eq(tasmiSubmissions.studentId, userId))
      .orderBy(desc(tasmiSubmissions.submittedAt))
      .limit(50);
  });

  // GET /v1/tasmi/pending — List pending submissions for teacher review
  app.get('/tasmi/pending', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { sectionId } = request.query as { sectionId?: string };

    let query = db.select()
      .from(tasmiSubmissions)
      .where(eq(tasmiSubmissions.reviewVerdict, null as any))
      .orderBy(desc(tasmiSubmissions.submittedAt))
      .limit(50);

    if (sectionId) {
      query = db.select()
        .from(tasmiSubmissions)
        .where(and(
          eq(tasmiSubmissions.sectionId, sectionId),
          eq(tasmiSubmissions.reviewVerdict, null as any),
        ))
        .orderBy(desc(tasmiSubmissions.submittedAt))
        .limit(50);
    }

    return query;
  });

  // GET /v1/tasmi/:id — Get single submission
  app.get('/tasmi/:id', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };

    const [submission] = await db.select()
      .from(tasmiSubmissions)
      .where(eq(tasmiSubmissions.id, id))
      .limit(1);

    if (!submission) return request.server.httpErrors.notFound('Submission not found');
    return submission;
  });

  // POST /v1/tasmi/:id/review — Teacher reviews a submission
  app.post('/tasmi/:id/review', {
    schema: { body: reviewTasmiSchema },
    preHandler: [app.authenticate],
  }, async (request) => {
    const reviewerId = request.user.sub;
    const { id } = request.params as { id: string };
    const body = request.body as z.infer<typeof reviewTasmiSchema>;

    const weightedTotal = body.hifzScore * 0.5 + body.tajweedScore * 0.3 + body.fluencyScore * 0.2;

    const [updated] = await db.update(tasmiSubmissions)
      .set({
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        reviewHifzScore: body.hifzScore,
        reviewTajweedScore: body.tajweedScore,
        reviewFluencyScore: body.fluencyScore,
        reviewWeightedTotal: weightedTotal,
        reviewVerdict: body.verdict,
        reviewNotes: body.notes,
      })
      .where(eq(tasmiSubmissions.id, id))
      .returning();

    if (!updated) return request.server.httpErrors.notFound('Submission not found');
    return updated;
  });
}
