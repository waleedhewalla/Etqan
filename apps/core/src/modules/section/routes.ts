import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, count, isNull, desc } from 'drizzle-orm';
import { getDb } from '../../db';
import {
  sections, sectionEnrollments, users, assignments, attendance, guardianLinks,
  studentCards, reviewLogs, streaks, tenants,
} from '../../db/schema';
import { canManageSection, isStaff, isTenantAdmin, loadManagedSection, GUARDIAN_ROLE } from '../../lib/access';
import { localDate } from '../../lib/dates';
import { loadStudentSignals, riskReasons } from '../../lib/risk';
import { assertCanAddHalaqa, assertCanAddStudent } from '../../lib/plan';
import { enrollStudent } from '../auth/routes';
import { auditLog } from '../audit/service';
import { notifyGuardiansOfAbsence } from '../notification/service';

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

const joinSchema = z.object({
  code: z.string().trim().min(3).max(20).regex(/^[A-Za-z0-9-]+$/),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const attendanceQuerySchema = z.object({ date: isoDate.optional() });

const markAttendanceSchema = z.object({
  date: isoDate,
  records: z.array(z.object({
    studentId: z.string().uuid(),
    present: z.boolean(),
    notes: z.string().max(500).optional(),
  })).min(1).max(200),
});

const addGuardianSchema = z.object({
  displayNameAr: z.string().trim().min(2).max(100),
  whatsapp: z.string().regex(/^\+[1-9]\d{6,14}$/),
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

  const activeRoster = (sectionId: string) => db.select({ studentId: sectionEnrollments.studentId })
    .from(sectionEnrollments)
    .where(and(eq(sectionEnrollments.sectionId, sectionId), isNull(sectionEnrollments.droppedAt)));

  // GET /v1/sections/lookup/:code — public: confirms a join code before sign-up.
  app.get('/sections/lookup/:code', {
    config: { rateLimit: { max: 30, timeWindow: '15 minutes' } },
  }, async (request) => {
    const { code } = request.params as { code: string };
    const [row] = await db.select({ nameAr: sections.nameAr, tenantNameAr: tenants.nameAr })
      .from(sections).innerJoin(tenants, eq(sections.tenantId, tenants.id))
      .where(and(eq(sections.joinCode, code.trim().toUpperCase()), eq(sections.active, true)))
      .limit(1);
    if (!row) return request.server.httpErrors.notFound('Invalid join code');
    return row;
  });

  // GET /v1/sections — sections the user teaches (staff) or is enrolled in (student).
  app.get('/sections', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const user = request.user;

    if (isStaff(user)) {
      const where = isTenantAdmin(user)
        ? eq(sections.tenantId, user.facultyId!)
        : and(eq(sections.teacherId, user.sub), eq(sections.tenantId, user.facultyId!));
      return db.select().from(sections).where(where).orderBy(sections.nameAr);
    }

    const enrolled = await db.select({ section: sections })
      .from(sectionEnrollments)
      .innerJoin(sections, eq(sectionEnrollments.sectionId, sections.id))
      .where(and(eq(sectionEnrollments.studentId, user.sub), isNull(sectionEnrollments.droppedAt)));
    return enrolled.map((e) => ({ ...e.section, joinCode: undefined }));
  });

  // POST /v1/sections — create a halaqa.
  app.post('/sections', {
    schema: { body: createSectionSchema },
    preHandler: [app.authenticate],
  }, async (request) => {
    const user = request.user;
    if (!isStaff(user) || !user.facultyId) return request.server.httpErrors.forbidden('Staff only');
    const body = request.body as z.infer<typeof createSectionSchema>;
    await assertCanAddHalaqa(db, user.facultyId);

    const [section] = await db.insert(sections).values({
      tenantId: user.facultyId,
      nameAr: body.nameAr,
      nameEn: body.nameEn,
      joinCode: generateJoinCode(),
      teacherId: user.sub,
      maxStudents: body.maxStudents,
    }).returning();
    return section;
  });

  // POST /v1/sections/join — a signed-in student joins with a code.
  app.post('/sections/join', {
    schema: { body: joinSchema },
    preHandler: [app.authenticate],
  }, async (request) => {
    const user = request.user;
    if (user.role !== 'student') return request.server.httpErrors.forbidden('Only students join halaqat');
    const { code } = request.body as z.infer<typeof joinSchema>;

    const [section] = await db.select().from(sections)
      .where(and(eq(sections.joinCode, code.toUpperCase()), eq(sections.active, true))).limit(1);
    if (!section || section.tenantId !== user.facultyId) {
      return request.server.httpErrors.notFound('Invalid join code');
    }

    const [ct] = await db.select({ count: count() }).from(sectionEnrollments)
      .where(and(eq(sectionEnrollments.sectionId, section.id), isNull(sectionEnrollments.droppedAt)));
    if ((ct?.count ?? 0) >= section.maxStudents) return request.server.httpErrors.conflict('Section is full');

    await assertCanAddStudent(db, section.tenantId, user.sub);
    await enrollStudent(db, section.id, user.sub);
    await auditLog({
      actorId: user.sub, actorRole: user.role, action: 'section.join',
      targetType: 'section', targetId: section.id,
    });
    return { section: { id: section.id, nameAr: section.nameAr } };
  });

  // GET /v1/sections/:id — details and roster (teacher/admin), or basic info (enrolled student).
  app.get('/sections/:id', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const user = request.user;

    const [section] = await db.select().from(sections).where(eq(sections.id, id)).limit(1);
    if (!section) return request.server.httpErrors.notFound('Section not found');

    if (!canManageSection(user, section)) {
      const [enrolled] = await db.select({ id: sectionEnrollments.id }).from(sectionEnrollments)
        .where(and(
          eq(sectionEnrollments.sectionId, id),
          eq(sectionEnrollments.studentId, user.sub),
          isNull(sectionEnrollments.droppedAt),
        )).limit(1);
      if (!enrolled) return request.server.httpErrors.notFound('Section not found');
      return { id: section.id, nameAr: section.nameAr, nameEn: section.nameEn };
    }

    const roster = await db.select({ enrollment: sectionEnrollments, student: users })
      .from(sectionEnrollments)
      .innerJoin(users, eq(sectionEnrollments.studentId, users.id))
      .where(and(eq(sectionEnrollments.sectionId, id), isNull(sectionEnrollments.droppedAt)))
      .orderBy(users.displayNameAr);

    return {
      ...section,
      studentCount: roster.length,
      roster: roster.map((r) => ({
        studentId: r.student.id,
        displayNameAr: r.student.displayNameAr,
        whatsappE164: r.student.whatsappE164,
        enrolledAt: r.enrollment.enrolledAt,
      })),
    };
  });

  // GET /v1/sections/:id/students — per-student progress summary for the teacher.
  app.get('/sections/:id/students', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const section = await loadManagedSection(db, request.user, id);
    if (!section) return request.server.httpErrors.notFound('Section not found');

    const students = await db.select({ id: users.id, displayNameAr: users.displayNameAr })
      .from(sectionEnrollments)
      .innerJoin(users, eq(sectionEnrollments.studentId, users.id))
      .where(and(eq(sectionEnrollments.sectionId, id), isNull(sectionEnrollments.droppedAt)))
      .orderBy(users.displayNameAr);
    const ids = students.map((s) => s.id);
    if (ids.length === 0) return { sectionId: id, students: [], summary: emptySummary() };

    const signals = await loadStudentSignals(db, ids, { sectionId: id });

    const rows = students.map((s) => {
      const sig = signals.get(s.id)!;
      const reasons = riskReasons(sig);
      return {
        studentId: s.id,
        displayNameAr: s.displayNameAr,
        masteryPercent: sig.masteryPercent,
        cardsTotal: sig.cardsTotal,
        cardsDue: sig.cardsDue,
        reviewsToday: sig.reviewsToday,
        lastActiveAt: sig.lastActiveAt,
        inactiveDays: sig.inactiveDays,
        attendanceRate: sig.attendanceRate,
        currentStreak: sig.currentStreak,
        atRisk: reasons.length > 0,
        riskReasons: reasons,
      };
    });

    return {
      sectionId: id,
      students: rows,
      summary: {
        totalStudents: rows.length,
        activeToday: rows.filter((r) => r.reviewsToday > 0).length,
        atRisk: rows.filter((r) => r.atRisk).length,
        avgMastery: Math.round(rows.reduce((sum, r) => sum + r.masteryPercent, 0) / rows.length),
      },
    };
  });

  // GET /v1/sections/:id/attendance?date= — roster with that day's marks.
  app.get('/sections/:id/attendance', {
    schema: { querystring: attendanceQuerySchema },
    preHandler: [app.authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const section = await loadManagedSection(db, request.user, id);
    if (!section) return request.server.httpErrors.notFound('Section not found');
    const date = (request.query as z.infer<typeof attendanceQuerySchema>).date ?? localDate();

    const rows = await db.select({
      studentId: users.id,
      displayNameAr: users.displayNameAr,
      present: attendance.present,
      notes: attendance.notes,
    })
      .from(sectionEnrollments)
      .innerJoin(users, eq(sectionEnrollments.studentId, users.id))
      .leftJoin(attendance, and(
        eq(attendance.studentId, users.id),
        eq(attendance.sectionId, id),
        eq(attendance.date, date),
      ))
      .where(and(eq(sectionEnrollments.sectionId, id), isNull(sectionEnrollments.droppedAt)))
      .orderBy(users.displayNameAr);

    return { sectionId: id, date, records: rows };
  });

  // PUT /v1/sections/:id/attendance — mark a day's attendance; alerts guardians of new absences.
  app.put('/sections/:id/attendance', {
    schema: { body: markAttendanceSchema },
    preHandler: [app.authenticate],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const user = request.user;
    const section = await loadManagedSection(db, user, id);
    if (!section) return request.server.httpErrors.notFound('Section not found');
    const { date, records } = request.body as z.infer<typeof markAttendanceSchema>;

    if (date > localDate()) return request.server.httpErrors.badRequest('Cannot mark attendance for a future date');

    const enrolled = new Set((await activeRoster(id)).map((r) => r.studentId));
    const unknown = records.filter((r) => !enrolled.has(r.studentId));
    if (unknown.length) return request.server.httpErrors.badRequest('Some students are not in this halaqa');

    const previous = await db.select({ studentId: attendance.studentId, present: attendance.present })
      .from(attendance)
      .where(and(eq(attendance.sectionId, id), eq(attendance.date, date)));
    const wasAbsent = new Set(previous.filter((p) => !p.present).map((p) => p.studentId));

    for (const r of records) {
      await db.insert(attendance)
        .values({ sectionId: id, studentId: r.studentId, date, present: r.present, notes: r.notes, markedBy: user.sub })
        .onConflictDoUpdate({
          target: [attendance.sectionId, attendance.studentId, attendance.date],
          set: { present: r.present, notes: r.notes ?? null, markedBy: user.sub },
        });
    }

    // Alert only on absences that are new for this day, so re-saving doesn't resend.
    const newlyAbsent = records.filter((r) => !r.present && !wasAbsent.has(r.studentId)).map((r) => r.studentId);
    const alerts = newlyAbsent.length
      ? await notifyGuardiansOfAbsence(db, { section, date, studentIds: newlyAbsent })
      : { sent: 0, skipped: 0, failed: 0, noGuardian: 0 };

    await auditLog({
      actorId: user.sub, actorRole: user.role, action: 'attendance.marked',
      targetType: 'section', targetId: id, metadata: { date, count: records.length, newlyAbsent: newlyAbsent.length },
    });

    return { sectionId: id, date, saved: records.length, alerts };
  });

  // POST /v1/sections/:id/students/:studentId/guardians — link a guardian (by WhatsApp) to a student.
  app.post('/sections/:id/students/:studentId/guardians', {
    schema: { body: addGuardianSchema },
    preHandler: [app.authenticate],
  }, async (request) => {
    const { id, studentId } = request.params as { id: string; studentId: string };
    const user = request.user;
    const section = await loadManagedSection(db, user, id);
    if (!section) return request.server.httpErrors.notFound('Section not found');
    if (!(await activeRoster(id)).some((r) => r.studentId === studentId)) {
      return request.server.httpErrors.notFound('Student not found in this halaqa');
    }
    const body = request.body as z.infer<typeof addGuardianSchema>;
    const whatsapp = body.whatsapp.replace(/[\s-]+/g, '');

    let [guardian] = await db.select().from(users)
      .where(and(eq(users.whatsappE164, whatsapp), eq(users.tenantId, section.tenantId))).limit(1);
    if (guardian && guardian.role !== GUARDIAN_ROLE) {
      return request.server.httpErrors.conflict('This number belongs to a non-guardian account');
    }
    if (!guardian) {
      [guardian] = await db.insert(users).values({
        tenantId: section.tenantId, role: GUARDIAN_ROLE, displayNameAr: body.displayNameAr, whatsappE164: whatsapp,
      }).returning();
    }

    const [existing] = await db.select({ id: guardianLinks.id }).from(guardianLinks)
      .where(and(eq(guardianLinks.studentId, studentId), eq(guardianLinks.guardianId, guardian.id))).limit(1);
    if (!existing) {
      await db.insert(guardianLinks).values({ studentId, guardianId: guardian.id, otpVerifiedAt: null });
    }

    await auditLog({
      actorId: user.sub, actorRole: user.role, action: 'guardian.linked',
      targetType: 'user', targetId: studentId, metadata: { guardianId: guardian.id },
    });
    return { guardian: { id: guardian.id, displayNameAr: guardian.displayNameAr, whatsappE164: guardian.whatsappE164 } };
  });

  // GET /v1/sections/:id/students/:studentId/guardians
  app.get('/sections/:id/students/:studentId/guardians', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const { id, studentId } = request.params as { id: string; studentId: string };
    const section = await loadManagedSection(db, request.user, id);
    if (!section) return request.server.httpErrors.notFound('Section not found');

    return db.select({ id: users.id, displayNameAr: users.displayNameAr, whatsappE164: users.whatsappE164 })
      .from(guardianLinks).innerJoin(users, eq(guardianLinks.guardianId, users.id))
      .where(eq(guardianLinks.studentId, studentId));
  });

  // POST /v1/sections/:id/assign — teacher assigns sabaq / sabqi / manzil.
  app.post('/sections/:id/assign', {
    schema: { body: assignSchema },
    preHandler: [app.authenticate],
  }, async (request) => {
    const user = request.user;
    const { id: sectionId } = request.params as { id: string };
    const section = await loadManagedSection(db, user, sectionId);
    if (!section) return request.server.httpErrors.notFound('Section not found');
    const body = request.body as z.infer<typeof assignSchema>;
    if (!(await activeRoster(sectionId)).some((r) => r.studentId === body.studentId)) {
      return request.server.httpErrors.badRequest('Student is not in this halaqa');
    }

    const [assignment] = await db.insert(assignments).values({
      sectionId,
      studentId: body.studentId,
      assignedBy: user.sub,
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
    const section = await loadManagedSection(db, request.user, id);
    if (!section) return request.server.httpErrors.notFound('Section not found');
    return db.select().from(assignments).where(eq(assignments.sectionId, id)).orderBy(desc(assignments.createdAt));
  });
}

function emptySummary() {
  return { totalStudents: 0, activeToday: 0, atRisk: 0, avgMastery: 0 };
}
