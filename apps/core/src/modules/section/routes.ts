import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, count, isNull } from 'drizzle-orm';
import { getDb } from '../../db';
import { sections, sectionEnrollments, users, assignments } from '../../db/schema';

const createSectionSchema = z.object({
  nameAr: z.string().min(2),
  nameEn: z.string().optional(),
  maxStudents: z.number().int().min(1).max(100).default(25),
});

const assignSchema = z.object({
  studentId: z.string().uuid(),
  type: z.enum(['sabaq', 'sabqi', 'manzil']),
  startRef: z.string().regex(/^\d+:\d+$/),
  endRef: z.string().regex(/^\d+:\d+$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().optional(),
});

function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export async function sectionRoutes(app: FastifyInstance) {
  const db = getDb();

  // GET /v1/sections — List sections for current user
  app.get('/sections', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const userId = request.user.sub;
    const role = request.user.role;

    if (['lecturer', 'muhaffiza', 'advisor', 'dean', 'operator', 'superadmin'].includes(role)) {
      return db.select().from(sections).where(eq(sections.teacherId, userId));
    }

    const enrolled = await db.select({ section: sections })
      .from(sectionEnrollments)
      .innerJoin(sections, eq(sectionEnrollments.sectionId, sections.id))
      .where(and(
        eq(sectionEnrollments.studentId, userId),
        isNull(sectionEnrollments.droppedAt),
      ));

    return enrolled.map(e => e.section);
  });

  // POST /v1/sections — Create a section (halaqah)
  app.post('/sections', {
    schema: { body: createSectionSchema },
    preHandler: [app.authenticate],
  }, async (request) => {
    const userId = request.user.sub;
    const tenantId = request.user.facultyId;
    const body = request.body as z.infer<typeof createSectionSchema>;

    if (!tenantId) {
      return request.server.httpErrors.badRequest('Faculty/tenant ID required');
    }

    const [section] = await db.insert(sections).values({
      tenantId,
      nameAr: body.nameAr,
      nameEn: body.nameEn,
      joinCode: generateJoinCode(),
      teacherId: userId,
      maxStudents: body.maxStudents,
    }).returning();

    return section;
  });

  // GET /v1/sections/:id — Section details with roster
  app.get('/sections/:id', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };

    const [section] = await db.select()
      .from(sections)
      .where(eq(sections.id, id))
      .limit(1);

    if (!section) return request.server.httpErrors.notFound('Section not found');

    const roster = await db.select({ enrollment: sectionEnrollments, student: users })
      .from(sectionEnrollments)
      .innerJoin(users, eq(sectionEnrollments.studentId, users.id))
      .where(and(eq(sectionEnrollments.sectionId, id), isNull(sectionEnrollments.droppedAt)));

    return {
      ...section,
      studentCount: roster.length,
      roster: roster.map(r => ({
        studentId: r.student.id,
        displayNameAr: r.student.displayNameAr,
        enrolledAt: r.enrollment.enrolledAt,
      })),
    };
  });

  // POST /v1/sections/:id/join — Student joins by code
  app.post('/sections/:id/join', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const { joinCode } = request.body as { joinCode: string };

    const [section] = await db.select()
      .from(sections)
      .where(and(eq(sections.id, id), eq(sections.joinCode, joinCode)))
      .limit(1);

    if (!section) return request.server.httpErrors.notFound('Invalid section or join code');

    const [ct] = await db.select({ count: count() })
      .from(sectionEnrollments)
      .where(and(eq(sectionEnrollments.sectionId, id), isNull(sectionEnrollments.droppedAt)));

    if ((ct?.count ?? 0) >= section.maxStudents) {
      return request.server.httpErrors.conflict('Section is full');
    }

    const [enrollment] = await db.insert(sectionEnrollments).values({
      sectionId: id,
      studentId: userId,
    }).returning();

    return enrollment;
  });

  // POST /v1/sections/:id/assign — Teacher assigns Sabaq/Sabqi/Manzil
  app.post('/sections/:id/assign', {
    schema: { body: assignSchema },
    preHandler: [app.authenticate],
  }, async (request) => {
    const userId = request.user.sub;
    const { id: sectionId } = request.params as { id: string };
    const body = request.body as z.infer<typeof assignSchema>;

    const [assignment] = await db.insert(assignments).values({
      sectionId,
      studentId: body.studentId,
      assignedBy: userId,
      type: body.type,
      startRef: body.startRef,
      endRef: body.endRef,
      dueDate: body.dueDate,
      notes: body.notes,
    }).returning();

    return assignment;
  });

  // GET /v1/sections/:id/assignments
  app.get('/sections/:id/assignments', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };
    return db.select().from(assignments).where(eq(assignments.sectionId, id));
  });
}
