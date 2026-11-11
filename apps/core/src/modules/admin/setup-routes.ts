import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb } from '../../db';
import { sectionEnrollments, sections, users } from '../../db/schema';
import { config } from '../../config';
import { TEACHER_ROLES } from '../../lib/access';
import type { TokenPayload } from '../../lib/jwt';
import { assertCanAddHalaqa } from '../../lib/plan';
import { sendEmail } from '../../lib/email';
import { auditLog } from '../audit/service';
import { generateJoinCode } from '../section/routes';

/** Who may add teachers and halaqat. Advisors see the admin console but do not staff the institution. */
const MANAGER_ROLES: readonly string[] = ['dean', 'operator', 'superadmin'];
/** The staff a dean manages here: whoever can be given a halaqa. */
const ASSIGNABLE_ROLES: readonly string[] = [...TEACHER_ROLES, 'dean'];

const name = z.string().trim().min(2).max(120);
const addStaffSchema = z.object({
  displayNameAr: name,
  email: z.string().trim().toLowerCase().email().max(320),
  role: z.enum(['lecturer', 'muhaffiza']).default('lecturer'),
});
const editStaffSchema = z.object({ displayNameAr: name.optional(), active: z.boolean().optional() })
  .refine((b) => b.displayNameAr !== undefined || b.active !== undefined, 'Nothing to change');
const addHalaqaSchema = z.object({
  nameAr: name,
  teacherId: z.string().uuid(),
  maxStudents: z.number().int().min(1).max(100).default(25),
});
const editHalaqaSchema = z.object({
  nameAr: name.optional(),
  teacherId: z.string().uuid().optional(),
  maxStudents: z.number().int().min(1).max(100).optional(),
  /** false closes the halaqa: no one can join it and it leaves its teacher's and students' lists. Nothing is deleted. */
  active: z.boolean().optional(),
}).refine((b) => Object.values(b).some((v) => v !== undefined), 'Nothing to change');
const idParam = z.object({ id: z.string().uuid() });

/** Setting an institution up from the admin console: its teachers and its halaqat. */
export async function adminSetupRoutes(app: FastifyInstance) {
  const db = getDb();

  /** The manager's institution, or null when the caller may not manage one. */
  const tenantOf = (user: TokenPayload) => (MANAGER_ROLES.includes(user.role) && user.facultyId ? user.facultyId : null);
  const forbidden = (request: { server: FastifyInstance }) => request.server.httpErrors.forbidden('Institution managers only');

  /** A teacher of this institution who can still sign in, or undefined. */
  const activeTeacher = async (tenantId: string, id: string) => {
    const [row] = await db.select().from(users)
      .where(and(eq(users.id, id), eq(users.tenantId, tenantId), eq(users.active, true))).limit(1);
    return row && ASSIGNABLE_ROLES.includes(row.role) ? row : undefined;
  };

  const listStaff = async (tenantId: string) => {
    const rows = await db.select({
      id: users.id, displayNameAr: users.displayNameAr, email: users.email, role: users.role, active: users.active,
    }).from(users)
      .where(and(eq(users.tenantId, tenantId), inArray(users.role, ASSIGNABLE_ROLES as typeof users.$inferSelect['role'][])))
      .orderBy(asc(users.displayNameAr));
    const halaqat = await db.select({ teacherId: sections.teacherId, n: count() }).from(sections)
      .where(and(eq(sections.tenantId, tenantId), eq(sections.active, true))).groupBy(sections.teacherId);
    const byTeacher = new Map(halaqat.map((h) => [h.teacherId, h.n]));
    return rows.map((r) => ({ ...r, halaqat: byTeacher.get(r.id) ?? 0 }));
  };

  const listHalaqat = async (tenantId: string) => {
    const rows = await db.select({
      id: sections.id, nameAr: sections.nameAr, joinCode: sections.joinCode, maxStudents: sections.maxStudents, active: sections.active,
      teacherId: sections.teacherId, teacherName: users.displayNameAr, teacherActive: users.active,
    }).from(sections).leftJoin(users, eq(sections.teacherId, users.id))
      .where(eq(sections.tenantId, tenantId)).orderBy(asc(sections.nameAr));
    const enrolled = await db.select({ sectionId: sectionEnrollments.sectionId, n: count() }).from(sectionEnrollments)
      .innerJoin(sections, eq(sectionEnrollments.sectionId, sections.id))
      .where(and(eq(sections.tenantId, tenantId), isNull(sectionEnrollments.droppedAt))).groupBy(sectionEnrollments.sectionId);
    const bySection = new Map(enrolled.map((e) => [e.sectionId, e.n]));
    return rows.map((r) => ({ ...r, students: bySection.get(r.id) ?? 0 }));
  };

  // GET /v1/admin/setup — the institution's teachers and halaqat
  app.get('/admin/setup', { preHandler: [app.authenticate] }, async (request) => {
    const tenantId = tenantOf(request.user);
    if (!tenantId) return forbidden(request);
    return { staff: await listStaff(tenantId), halaqat: await listHalaqat(tenantId) };
  });

  // POST /v1/admin/staff — add a teacher; she signs in with a link sent to her email
  app.post('/admin/staff', { schema: { body: addStaffSchema }, preHandler: [app.authenticate] }, async (request, reply) => {
    const tenantId = tenantOf(request.user);
    if (!tenantId) return forbidden(request);
    const body = request.body as z.infer<typeof addStaffSchema>;

    // An email signs in to exactly one account, in any institution.
    const [taken] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${body.email}`).limit(1);
    if (taken) return request.server.httpErrors.conflict('This email already has an account');

    const [teacher] = await db.insert(users)
      .values({ tenantId, role: body.role, displayNameAr: body.displayNameAr, email: body.email }).returning();
    const invite = await sendEmail({
      to: body.email,
      subject: 'أُضيفتِ إلى إتقان',
      text: `السلام عليكم ${body.displayNameAr}،\n\nأُضيف حسابك معلمةً في إتقان. للدخول افتحي الصفحة التالية واكتبي بريدك هذا، وسيصلك رابط الدخول:\n${config.FRONTEND_URL}/auth/login/faculty`,
    });
    if (invite.status === 'failed') request.log.error({ error: invite.error }, 'Teacher invitation email failed');
    await auditLog({
      actorId: request.user.sub, actorRole: request.user.role, action: 'staff.added',
      targetType: 'user', targetId: teacher.id, metadata: { role: body.role, invitation: invite.status },
    });
    return reply.code(201).send({
      id: teacher.id, displayNameAr: teacher.displayNameAr, email: teacher.email, role: teacher.role, active: true, halaqat: 0,
      invitation: invite.status,
    });
  });

  // PATCH /v1/admin/staff/:id — rename a teacher, or stop or restore her access
  app.patch('/admin/staff/:id', { schema: { params: idParam, body: editStaffSchema }, preHandler: [app.authenticate] }, async (request) => {
    const tenantId = tenantOf(request.user);
    if (!tenantId) return forbidden(request);
    const { id } = request.params as z.infer<typeof idParam>;
    const body = request.body as z.infer<typeof editStaffSchema>;

    const [target] = await db.select().from(users).where(and(eq(users.id, id), eq(users.tenantId, tenantId))).limit(1);
    if (!target || !ASSIGNABLE_ROLES.includes(target.role)) return request.server.httpErrors.notFound('Teacher not found');
    if (body.active === false && id === request.user.sub) return request.server.httpErrors.badRequest('You cannot stop your own access');
    if (body.active !== undefined && target.role === 'dean' && id !== request.user.sub && request.user.role === 'dean') {
      return request.server.httpErrors.forbidden('A dean cannot change another dean\'s access');
    }

    await db.update(users).set({
      ...(body.displayNameAr !== undefined ? { displayNameAr: body.displayNameAr } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
      updatedAt: new Date(),
    }).where(eq(users.id, id));
    if (body.active !== undefined && body.active !== target.active) {
      await auditLog({
        actorId: request.user.sub, actorRole: request.user.role, action: body.active ? 'staff.restored' : 'staff.stopped',
        targetType: 'user', targetId: id,
      });
    }
    return (await listStaff(tenantId)).find((s) => s.id === id);
  });

  // POST /v1/admin/halaqat — open a halaqa for a teacher
  app.post('/admin/halaqat', { schema: { body: addHalaqaSchema }, preHandler: [app.authenticate] }, async (request, reply) => {
    const tenantId = tenantOf(request.user);
    if (!tenantId) return forbidden(request);
    const body = request.body as z.infer<typeof addHalaqaSchema>;
    if (!(await activeTeacher(tenantId, body.teacherId))) return request.server.httpErrors.badRequest('Choose a teacher of this institution');
    await assertCanAddHalaqa(db, tenantId);

    const [section] = await db.insert(sections).values({
      tenantId, nameAr: body.nameAr, teacherId: body.teacherId, maxStudents: body.maxStudents, joinCode: generateJoinCode(),
    }).returning();
    await auditLog({
      actorId: request.user.sub, actorRole: request.user.role, action: 'halaqa.added',
      targetType: 'section', targetId: section.id, metadata: { teacherId: body.teacherId },
    });
    return reply.code(201).send((await listHalaqat(tenantId)).find((h) => h.id === section.id));
  });

  // PATCH /v1/admin/halaqat/:id — rename a halaqa, resize it, hand it to another teacher, or close or reopen it
  app.patch('/admin/halaqat/:id', { schema: { params: idParam, body: editHalaqaSchema }, preHandler: [app.authenticate] }, async (request) => {
    const tenantId = tenantOf(request.user);
    if (!tenantId) return forbidden(request);
    const { id } = request.params as z.infer<typeof idParam>;
    const body = request.body as z.infer<typeof editHalaqaSchema>;

    const [section] = await db.select().from(sections).where(and(eq(sections.id, id), eq(sections.tenantId, tenantId))).limit(1);
    if (!section) return request.server.httpErrors.notFound('Halaqa not found');
    if (body.teacherId && !(await activeTeacher(tenantId, body.teacherId))) {
      return request.server.httpErrors.badRequest('Choose a teacher of this institution');
    }
    // Reopening takes a place in the plan again, like opening a new halaqa.
    if (body.active === true && !section.active) await assertCanAddHalaqa(db, tenantId);

    await db.update(sections).set({
      ...(body.nameAr !== undefined ? { nameAr: body.nameAr } : {}),
      ...(body.teacherId !== undefined ? { teacherId: body.teacherId } : {}),
      ...(body.maxStudents !== undefined ? { maxStudents: body.maxStudents } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
      updatedAt: new Date(),
    }).where(eq(sections.id, id));
    if (body.teacherId && body.teacherId !== section.teacherId) {
      await auditLog({
        actorId: request.user.sub, actorRole: request.user.role, action: 'halaqa.reassigned',
        targetType: 'section', targetId: id, metadata: { from: section.teacherId, to: body.teacherId },
      });
    }
    if (body.active !== undefined && body.active !== section.active) {
      await auditLog({
        actorId: request.user.sub, actorRole: request.user.role, action: body.active ? 'halaqa.reopened' : 'halaqa.closed',
        targetType: 'section', targetId: id,
      });
    }
    return (await listHalaqat(tenantId)).find((h) => h.id === id);
  });
}
