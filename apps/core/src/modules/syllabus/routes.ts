import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, asc } from 'drizzle-orm';
import { getDb } from '../../db';
import { syllabi, syllabusPassages } from '../../db/schema';

const createSyllabusSchema = z.object({
  nameAr: z.string().min(2),
  nameEn: z.string().optional(),
  riwayahId: z.string().default('hafs'),
  passages: z.array(z.object({
    nameAr: z.string(),
    startRef: z.string().regex(/^\d+:\d+$/),
    endRef: z.string().regex(/^\d+:\d+$/),
  })).min(1),
});

export async function syllabusRoutes(app: FastifyInstance) {
  const db = getDb();

  // GET /v1/syllabi — List all syllabi for tenant
  app.get('/syllabi', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const tenantId = request.user.facultyId;
    if (!tenantId) return request.server.httpErrors.forbidden('No faculty assigned to this account');
    return db.select().from(syllabi).where(eq(syllabi.tenantId, tenantId));
  });

  // POST /v1/syllabi — Create syllabus with passages
  app.post('/syllabi', {
    schema: { body: createSyllabusSchema },
    preHandler: [app.authenticate],
  }, async (request) => {
    const userId = request.user.sub;
    const tenantId = request.user.facultyId;
    if (!tenantId) return request.server.httpErrors.forbidden('No faculty assigned to this account');
    const body = request.body as z.infer<typeof createSyllabusSchema>;

    const [syllabus] = await db.insert(syllabi).values({
      tenantId,
      nameAr: body.nameAr,
      nameEn: body.nameEn,
      riwayahId: body.riwayahId,
      createdBy: userId,
    }).returning();

    const passageRows = body.passages.map((p, i) => ({
      syllabusId: syllabus.id,
      nameAr: p.nameAr,
      startRef: p.startRef,
      endRef: p.endRef,
      sortOrder: i,
    }));

    await db.insert(syllabusPassages).values(passageRows);

    const passages = await db.select()
      .from(syllabusPassages)
      .where(eq(syllabusPassages.syllabusId, syllabus.id))
      .orderBy(asc(syllabusPassages.sortOrder));

    return { ...syllabus, passages };
  });

  // GET /v1/syllabi/:id — Get syllabus with passages
  app.get('/syllabi/:id', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };

    const [syllabus] = await db.select()
      .from(syllabi)
      .where(eq(syllabi.id, id))
      .limit(1);

    if (!syllabus) return request.server.httpErrors.notFound('Syllabus not found');

    const passages = await db.select()
      .from(syllabusPassages)
      .where(eq(syllabusPassages.syllabusId, id))
      .orderBy(asc(syllabusPassages.sortOrder));

    return { ...syllabus, passages };
  });

  // DELETE /v1/syllabi/:id
  app.delete('/syllabi/:id', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };
    await db.delete(syllabi).where(eq(syllabi.id, id));
    return { success: true };
  });
}
