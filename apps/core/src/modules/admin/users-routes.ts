/**
 * The institution's people, managed from the admin console: everyone in one directory, creating a student,
 * guardian or member of staff, correcting a name or a number, stopping or restoring an account, putting a student
 * in a halaqa or taking her out, and linking her guardians. Also the audit log, so an admin can see who did what.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, count, desc, eq, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { getDb } from '../../db';
import { auditLogs, guardianLinks, sectionEnrollments, sections, users } from '../../db/schema';
import { forgetStopped } from '../../lib/active-users';
import type { TokenPayload } from '../../lib/jwt';
import { assertCanAddStudent } from '../../lib/plan';
import { inviteStaff } from '../../lib/staff-invite';
import { auditLog } from '../audit/service';
import { enrollStudent } from '../auth/routes';

/** Who may manage the institution's people. Advisors see the console but do not manage accounts. */
const MANAGER_ROLES: readonly string[] = ['dean', 'operator', 'superadmin'];
/** Accounts that belong to the platform, not to an institution: never listed or changed here. */
const PLATFORM_ROLES = ['operator', 'superadmin'] as const;
const STAFF_ROLES = ['lecturer', 'muhaffiza', 'sheikh_reviewer', 'advisor', 'dean'] as const;
/** Roles that sign in with an email link; the others sign in with a WhatsApp code. */
const isStaffRole = (role: string) => (STAFF_ROLES as readonly string[]).includes(role);
type Role = typeof users.$inferSelect['role'];

const PAGE = 50;
const MAX_BULK = 100;

const name = z.string().trim().min(2).max(100);
const whatsapp = z.string().trim().transform((v) => v.replace(/[\s-]+/g, '')).pipe(z.string().regex(/^\+[1-9]\d{6,14}$/, 'Use international format, e.g. +201001234567'));
const email = z.string().trim().toLowerCase().email().max(320);
const guardianInput = z.object({ displayNameAr: name, whatsapp });

const createSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('student'), displayNameAr: name, whatsapp, sectionId: z.string().uuid().optional(), guardian: guardianInput.optional() }),
  z.object({ role: z.literal('mahram'), displayNameAr: name, whatsapp, studentId: z.string().uuid().optional() }),
  z.object({ role: z.enum(STAFF_ROLES), displayNameAr: name, email }),
]);
const editSchema = z.object({
  displayNameAr: name.optional(),
  email: email.optional(),
  whatsapp: whatsapp.optional(),
  active: z.boolean().optional(),
}).refine((b) => Object.values(b).some((v) => v !== undefined), 'Nothing to change');
const listQuery = z.object({
  role: z.string().optional(),
  q: z.string().trim().max(100).optional(),
  active: z.enum(['true', 'false', 'all']).default('all'),
  offset: z.coerce.number().int().min(0).default(0),
});
const bulkSchema = z.object({
  sectionId: z.string().uuid().optional(),
  students: z.array(z.object({ displayNameAr: z.string().trim().max(100), whatsapp: z.string().trim().max(40) })).min(1).max(MAX_BULK),
});
const auditQuery = z.object({
  action: z.string().max(128).optional(),
  actorId: z.string().uuid().optional(),
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const idParam = z.object({ id: z.string().uuid() });
const idSection = z.object({ id: z.string().uuid(), sectionId: z.string().uuid() });
const idGuardian = z.object({ id: z.string().uuid(), guardianId: z.string().uuid() });

type User = typeof users.$inferSelect;

export async function adminUsersRoutes(app: FastifyInstance) {
  const db = getDb();

  const tenantOf = (user: TokenPayload) => (MANAGER_ROLES.includes(user.role) && user.facultyId ? user.facultyId : null);
  const forbidden = (request: { server: FastifyInstance }) => request.server.httpErrors.forbidden('Institution managers only');
  const canGovern = (actor: TokenPayload, role: string) => role !== 'dean' || actor.role === 'operator' || actor.role === 'superadmin';

  /** One user as the directory shows them, with what they are attached to. */
  const describe = async (tenantId: string, rows: User[]) => {
    const ids = rows.map((r) => r.id);
    const studentIds = rows.filter((r) => r.role === 'student').map((r) => r.id);
    const guardianIds = rows.filter((r) => r.role === 'mahram').map((r) => r.id);
    const teacherIds = rows.filter((r) => ['lecturer', 'muhaffiza', 'sheikh_reviewer', 'dean'].includes(r.role)).map((r) => r.id);

    const halaqat = studentIds.length ? await db.select({ userId: sectionEnrollments.studentId, id: sections.id, nameAr: sections.nameAr })
      .from(sectionEnrollments).innerJoin(sections, eq(sectionEnrollments.sectionId, sections.id))
      .where(and(inArray(sectionEnrollments.studentId, studentIds), isNull(sectionEnrollments.droppedAt), eq(sections.tenantId, tenantId))) : [];
    const guardians = studentIds.length ? await db.select({ userId: guardianLinks.studentId, id: users.id, displayNameAr: users.displayNameAr, whatsappE164: users.whatsappE164 })
      .from(guardianLinks).innerJoin(users, eq(guardianLinks.guardianId, users.id)).where(inArray(guardianLinks.studentId, studentIds)) : [];
    const children = guardianIds.length ? await db.select({ userId: guardianLinks.guardianId, id: users.id, displayNameAr: users.displayNameAr })
      .from(guardianLinks).innerJoin(users, eq(guardianLinks.studentId, users.id)).where(inArray(guardianLinks.guardianId, guardianIds)) : [];
    const taught = teacherIds.length ? await db.select({ userId: sections.teacherId, id: sections.id, nameAr: sections.nameAr })
      .from(sections).where(and(inArray(sections.teacherId, teacherIds), eq(sections.active, true), eq(sections.tenantId, tenantId))) : [];

    const by = <T extends { userId: string | null }>(list: T[]) => {
      const map = new Map<string, Omit<T, 'userId'>[]>();
      for (const { userId, ...rest } of list) { if (userId) map.set(userId, [...(map.get(userId) ?? []), rest]); }
      return map;
    };
    const h = by(halaqat); const g = by(guardians); const c = by(children); const t = by(taught);
    return rows.map((r) => ({
      id: r.id, displayNameAr: r.displayNameAr, role: r.role, email: r.email, whatsappE164: r.whatsappE164, active: r.active, createdAt: r.createdAt,
      halaqat: (r.role === 'student' ? h.get(r.id) : t.get(r.id)) ?? [],
      guardians: g.get(r.id) ?? [],
      children: c.get(r.id) ?? [],
    })).filter((r) => ids.includes(r.id));
  };

  const numberTaken = async (number: string) =>
    Boolean((await db.select({ id: users.id }).from(users).where(eq(users.whatsappE164, number)).limit(1))[0]);
  const emailTaken = async (address: string) =>
    Boolean((await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${address}`).limit(1))[0]);

  /** An active halaqa of the institution with room in it, or the reply to send when there is none. */
  const openHalaqa = async (request: { server: FastifyInstance }, tenantId: string, sectionId: string, studentId?: string) => {
    const [section] = await db.select().from(sections).where(and(eq(sections.id, sectionId), eq(sections.tenantId, tenantId), eq(sections.active, true))).limit(1);
    if (!section) return { error: request.server.httpErrors.notFound('Halaqa not found') };
    if (studentId) {
      const [already] = await db.select({ id: sectionEnrollments.id }).from(sectionEnrollments)
        .where(and(eq(sectionEnrollments.sectionId, sectionId), eq(sectionEnrollments.studentId, studentId), isNull(sectionEnrollments.droppedAt))).limit(1);
      if (already) return { section, already: true };
    }
    const [taken] = await db.select({ n: count() }).from(sectionEnrollments).where(and(eq(sectionEnrollments.sectionId, sectionId), isNull(sectionEnrollments.droppedAt)));
    if ((taken?.n ?? 0) >= section.maxStudents) return { error: request.server.httpErrors.conflict('This halaqa is full') };
    return { section, already: false };
  };

  /** The guardian with this number, made if there is none, linked to the student. Null when the number is another kind of account. */
  const linkGuardian = async (tenantId: string, studentId: string, input: z.infer<typeof guardianInput>) => {
    let [guardian] = await db.select().from(users).where(eq(users.whatsappE164, input.whatsapp)).limit(1);
    if (guardian && (guardian.role !== 'mahram' || guardian.tenantId !== tenantId)) return null;
    if (!guardian) [guardian] = await db.insert(users).values({ tenantId, role: 'mahram', displayNameAr: input.displayNameAr, whatsappE164: input.whatsapp }).returning();
    const [linked] = await db.select({ id: guardianLinks.id }).from(guardianLinks)
      .where(and(eq(guardianLinks.studentId, studentId), eq(guardianLinks.guardianId, guardian.id))).limit(1);
    if (!linked) await db.insert(guardianLinks).values({ studentId, guardianId: guardian.id, otpVerifiedAt: null });
    return guardian;
  };

  /** A user of this institution the caller may change, or the reply to send. */
  const governed = async (request: { server: FastifyInstance; user: TokenPayload }, tenantId: string, id: string) => {
    const [target] = await db.select().from(users).where(and(eq(users.id, id), eq(users.tenantId, tenantId))).limit(1);
    if (!target || (PLATFORM_ROLES as readonly string[]).includes(target.role)) return { error: request.server.httpErrors.notFound('User not found') };
    if (!canGovern(request.user, target.role) && target.id !== request.user.sub) return { error: request.server.httpErrors.forbidden('Only the platform operator changes a dean') };
    return { target };
  };

  // GET /v1/admin/users — the directory
  app.get('/admin/users', { schema: { querystring: listQuery }, preHandler: [app.authenticate] }, async (request) => {
    const tenantId = tenantOf(request.user);
    if (!tenantId) return forbidden(request);
    const q = request.query as z.infer<typeof listQuery>;
    const base = and(eq(users.tenantId, tenantId), sql`${users.role} not in ('operator','superadmin')`);
    const filters = and(
      base,
      q.role ? eq(users.role, q.role as Role) : undefined,
      q.active === 'all' ? undefined : eq(users.active, q.active === 'true'),
      q.q ? or(ilike(users.displayNameAr, `%${q.q}%`), ilike(users.email, `%${q.q}%`), ilike(users.whatsappE164, `%${q.q.replace(/[\s-]+/g, '')}%`)) : undefined,
    );
    const rows = await db.select().from(users).where(filters).orderBy(asc(users.displayNameAr)).limit(PAGE).offset(q.offset);
    const [total] = await db.select({ n: count() }).from(users).where(filters);
    const perRole = await db.select({ role: users.role, n: count() }).from(users).where(base).groupBy(users.role);
    return {
      users: await describe(tenantId, rows),
      total: total?.n ?? 0,
      offset: q.offset,
      pageSize: PAGE,
      counts: Object.fromEntries(perRole.map((r) => [r.role, r.n])),
    };
  });

  // POST /v1/admin/users — a student, a guardian or a member of staff
  app.post('/admin/users', { schema: { body: createSchema }, preHandler: [app.authenticate] }, async (request, reply) => {
    const tenantId = tenantOf(request.user);
    if (!tenantId) return forbidden(request);
    const body = request.body as z.infer<typeof createSchema>;
    const errors = request.server.httpErrors;
    if (!canGovern(request.user, body.role)) return errors.forbidden('Only the platform operator adds a dean');

    let created: User;
    let invitation: string | undefined;
    if ('email' in body) {
      if (await emailTaken(body.email)) return errors.conflict('This email already has an account');
      [created] = await db.insert(users).values({ tenantId, role: body.role, displayNameAr: body.displayNameAr, email: body.email }).returning();
      invitation = (await inviteStaff(body.email, body.displayNameAr, body.role)).status;
    } else {
      if (await numberTaken(body.whatsapp)) return errors.conflict('This number already has an account');
      if (body.role === 'student') {
        let target: Awaited<ReturnType<typeof openHalaqa>> | null = null;
        if (body.sectionId) {
          target = await openHalaqa(request, tenantId, body.sectionId);
          if ('error' in target) return target.error;
        }
        // Checked before the account exists, so a refused student leaves nothing behind.
        await assertCanAddStudent(db, tenantId);
        if (body.guardian && body.guardian.whatsapp === body.whatsapp) return errors.badRequest('The guardian needs her own number');
        if (body.guardian) {
          const [g] = await db.select({ role: users.role, tenantId: users.tenantId }).from(users).where(eq(users.whatsappE164, body.guardian.whatsapp)).limit(1);
          if (g && (g.role !== 'mahram' || g.tenantId !== tenantId)) return errors.conflict('The guardian\'s number belongs to another kind of account');
        }
        [created] = await db.insert(users).values({ tenantId, role: 'student', displayNameAr: body.displayNameAr, whatsappE164: body.whatsapp }).returning();
        if (body.sectionId) await enrollStudent(db, body.sectionId, created.id);
        if (body.guardian) await linkGuardian(tenantId, created.id, body.guardian);
      } else {
        if (body.studentId) {
          const [student] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, body.studentId), eq(users.tenantId, tenantId), eq(users.role, 'student'))).limit(1);
          if (!student) return errors.badRequest('Choose a student of this institution');
        }
        [created] = await db.insert(users).values({ tenantId, role: 'mahram', displayNameAr: body.displayNameAr, whatsappE164: body.whatsapp }).returning();
        if (body.studentId) await db.insert(guardianLinks).values({ studentId: body.studentId, guardianId: created.id, otpVerifiedAt: null });
      }
    }
    await auditLog({
      actorId: request.user.sub, actorRole: request.user.role, tenantId, action: 'user.created', targetType: 'user', targetId: created.id,
      metadata: { role: created.role },
    });
    const [described] = await describe(tenantId, [created]);
    return reply.code(201).send({ ...described, invitation });
  });

  // PATCH /v1/admin/users/:id — correct a name or a number, stop or restore an account
  app.patch('/admin/users/:id', { schema: { params: idParam, body: editSchema }, preHandler: [app.authenticate] }, async (request) => {
    const tenantId = tenantOf(request.user);
    if (!tenantId) return forbidden(request);
    const { id } = request.params as z.infer<typeof idParam>;
    const body = request.body as z.infer<typeof editSchema>;
    const errors = request.server.httpErrors;
    const found = await governed(request, tenantId, id);
    if ('error' in found) return found.error;
    const { target } = found;

    if (body.active === false && id === request.user.sub) return errors.badRequest('You cannot stop your own access');
    // Staff sign in by email and everyone else by WhatsApp: the other contact is not editable.
    if (body.email !== undefined && !isStaffRole(target.role)) return errors.badRequest('This account signs in with a WhatsApp number');
    if (body.whatsapp !== undefined && isStaffRole(target.role)) return errors.badRequest('This account signs in with an email');
    if (body.email !== undefined && body.email !== target.email?.toLowerCase() && await emailTaken(body.email)) return errors.conflict('This email already has an account');
    if (body.whatsapp !== undefined && body.whatsapp !== target.whatsappE164 && await numberTaken(body.whatsapp)) return errors.conflict('This number already has an account');

    await db.update(users).set({
      ...(body.displayNameAr !== undefined ? { displayNameAr: body.displayNameAr } : {}),
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.whatsapp !== undefined ? { whatsappE164: body.whatsapp } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
      updatedAt: new Date(),
    }).where(eq(users.id, id));
    if (body.active !== undefined) forgetStopped(id);
    const changed = Object.keys(body).filter((k) => k !== 'active');
    if (changed.length) {
      await auditLog({
        actorId: request.user.sub, actorRole: request.user.role, tenantId, action: 'user.updated', targetType: 'user', targetId: id,
        metadata: { fields: changed },
      });
    }
    if (body.active !== undefined && body.active !== target.active) {
      await auditLog({
        actorId: request.user.sub, actorRole: request.user.role, tenantId, action: body.active ? 'user.restored' : 'user.stopped', targetType: 'user', targetId: id,
        metadata: { role: target.role },
      });
    }
    const [updated] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return (await describe(tenantId, [updated]))[0];
  });

  // PUT /v1/admin/users/:id/halaqat/:sectionId — a student joins a halaqa
  app.put('/admin/users/:id/halaqat/:sectionId', { schema: { params: idSection }, preHandler: [app.authenticate] }, async (request) => {
    const tenantId = tenantOf(request.user);
    if (!tenantId) return forbidden(request);
    const { id, sectionId } = request.params as z.infer<typeof idSection>;
    const found = await governed(request, tenantId, id);
    if ('error' in found) return found.error;
    if (found.target.role !== 'student' || !found.target.active) return request.server.httpErrors.badRequest('Only an active student joins a halaqa');
    const target = await openHalaqa(request, tenantId, sectionId, id);
    if ('error' in target) return target.error;
    if (!target.already) {
      await assertCanAddStudent(db, tenantId, id);
      await enrollStudent(db, sectionId, id);
      await auditLog({
        actorId: request.user.sub, actorRole: request.user.role, tenantId, action: 'user.halaqa.joined', targetType: 'user', targetId: id,
        metadata: { sectionId },
      });
    }
    return (await describe(tenantId, [found.target]))[0];
  });

  // DELETE /v1/admin/users/:id/halaqat/:sectionId — a student leaves a halaqa; her work stays
  app.delete('/admin/users/:id/halaqat/:sectionId', { schema: { params: idSection }, preHandler: [app.authenticate] }, async (request) => {
    const tenantId = tenantOf(request.user);
    if (!tenantId) return forbidden(request);
    const { id, sectionId } = request.params as z.infer<typeof idSection>;
    const found = await governed(request, tenantId, id);
    if ('error' in found) return found.error;
    const [section] = await db.select({ id: sections.id }).from(sections).where(and(eq(sections.id, sectionId), eq(sections.tenantId, tenantId))).limit(1);
    if (!section) return request.server.httpErrors.notFound('Halaqa not found');
    const dropped = await db.update(sectionEnrollments).set({ droppedAt: new Date() })
      .where(and(eq(sectionEnrollments.sectionId, sectionId), eq(sectionEnrollments.studentId, id), isNull(sectionEnrollments.droppedAt)))
      .returning({ id: sectionEnrollments.id });
    if (dropped.length) {
      await auditLog({
        actorId: request.user.sub, actorRole: request.user.role, tenantId, action: 'user.halaqa.left', targetType: 'user', targetId: id,
        metadata: { sectionId },
      });
    }
    return (await describe(tenantId, [found.target]))[0];
  });

  // POST /v1/admin/users/:id/guardians — links a guardian to a student, making her account if the number is new
  app.post('/admin/users/:id/guardians', { schema: { params: idParam, body: guardianInput }, preHandler: [app.authenticate] }, async (request) => {
    const tenantId = tenantOf(request.user);
    if (!tenantId) return forbidden(request);
    const { id } = request.params as z.infer<typeof idParam>;
    const body = request.body as z.infer<typeof guardianInput>;
    const found = await governed(request, tenantId, id);
    if ('error' in found) return found.error;
    if (found.target.role !== 'student') return request.server.httpErrors.badRequest('Guardians are linked to students');
    if (body.whatsapp === found.target.whatsappE164) return request.server.httpErrors.badRequest('The guardian needs her own number');
    const guardian = await linkGuardian(tenantId, id, body);
    if (!guardian) return request.server.httpErrors.conflict('This number belongs to another kind of account');
    await auditLog({
      actorId: request.user.sub, actorRole: request.user.role, tenantId, action: 'guardian.linked', targetType: 'user', targetId: id,
      metadata: { guardianId: guardian.id },
    });
    return (await describe(tenantId, [found.target]))[0];
  });

  // DELETE /v1/admin/users/:id/guardians/:guardianId — unlinks; the guardian's account stays
  app.delete('/admin/users/:id/guardians/:guardianId', { schema: { params: idGuardian }, preHandler: [app.authenticate] }, async (request) => {
    const tenantId = tenantOf(request.user);
    if (!tenantId) return forbidden(request);
    const { id, guardianId } = request.params as z.infer<typeof idGuardian>;
    const found = await governed(request, tenantId, id);
    if ('error' in found) return found.error;
    const removed = await db.delete(guardianLinks).where(and(eq(guardianLinks.studentId, id), eq(guardianLinks.guardianId, guardianId))).returning({ id: guardianLinks.id });
    if (removed.length) {
      await auditLog({
        actorId: request.user.sub, actorRole: request.user.role, tenantId, action: 'guardian.unlinked', targetType: 'user', targetId: id,
        metadata: { guardianId },
      });
    }
    return (await describe(tenantId, [found.target]))[0];
  });

  // POST /v1/admin/users/students/bulk — a class at once: one student a row, each row succeeds or fails on its own
  app.post('/admin/users/students/bulk', { schema: { body: bulkSchema }, preHandler: [app.authenticate] }, async (request) => {
    const tenantId = tenantOf(request.user);
    if (!tenantId) return forbidden(request);
    const body = request.body as z.infer<typeof bulkSchema>;
    if (body.sectionId) {
      const target = await openHalaqa(request, tenantId, body.sectionId);
      if ('error' in target) return target.error;
    }
    type Status = 'created' | 'enrolled' | 'exists' | 'invalid' | 'full' | 'plan_limit';
    const results: { row: number; displayNameAr: string; whatsapp: string; status: Status }[] = [];
    const seen = new Set<string>();
    let stopped: Status | null = null;

    for (const [i, input] of body.students.entries()) {
      const row = i + 1;
      const number = input.whatsapp.replace(/[\s-]+/g, '');
      const add = (status: Status) => results.push({ row, displayNameAr: input.displayNameAr, whatsapp: number, status });
      if (input.displayNameAr.length < 2 || !/^\+[1-9]\d{6,14}$/.test(number)) { add('invalid'); continue; }
      if (stopped) { add(stopped); continue; }
      if (seen.has(number)) { add('exists'); continue; }
      seen.add(number);

      const [existing] = await db.select().from(users).where(eq(users.whatsappE164, number)).limit(1);
      if (existing && (existing.role !== 'student' || existing.tenantId !== tenantId)) { add('invalid'); continue; }
      const room = body.sectionId ? await openHalaqa(request, tenantId, body.sectionId, existing?.id) : null;
      if (room && 'error' in room) { stopped = 'full'; add('full'); continue; }
      try {
        if (existing) {
          if (!body.sectionId || (room && 'already' in room && room.already) || !existing.active) { add('exists'); continue; }
          await assertCanAddStudent(db, tenantId, existing.id);
          await enrollStudent(db, body.sectionId, existing.id);
          add('enrolled');
        } else {
          await assertCanAddStudent(db, tenantId);
          const [student] = await db.insert(users).values({ tenantId, role: 'student', displayNameAr: input.displayNameAr, whatsappE164: number }).returning();
          if (body.sectionId) await enrollStudent(db, body.sectionId, student.id);
          add('created');
        }
      } catch (err) {
        if ((err as { code?: string }).code === 'PLAN_LIMIT_REACHED') { stopped = 'plan_limit'; add('plan_limit'); continue; }
        throw err;
      }
    }
    const tally = (s: Status) => results.filter((r) => r.status === s).length;
    await auditLog({
      actorId: request.user.sub, actorRole: request.user.role, tenantId, action: 'users.bulk_added', targetType: body.sectionId ? 'section' : 'tenant',
      targetId: body.sectionId ?? tenantId, metadata: { rows: results.length, created: tally('created'), enrolled: tally('enrolled') },
    });
    return { results, created: tally('created'), enrolled: tally('enrolled'), exists: tally('exists'), failed: results.length - tally('created') - tally('enrolled') - tally('exists') };
  });

  // GET /v1/admin/audit — who did what in this institution, newest first
  app.get('/admin/audit', { schema: { querystring: auditQuery }, preHandler: [app.authenticate] }, async (request) => {
    const tenantId = tenantOf(request.user);
    if (!tenantId) return forbidden(request);
    const q = request.query as z.infer<typeof auditQuery>;
    const rows = await db.select({
      id: auditLogs.id, at: auditLogs.createdAt, action: auditLogs.action, resource: auditLogs.resource, resourceId: auditLogs.resourceId,
      details: auditLogs.details, actorId: auditLogs.userId, actorName: users.displayNameAr, actorRole: users.role,
    }).from(auditLogs).leftJoin(users, eq(auditLogs.userId, users.id))
      .where(and(
        eq(auditLogs.tenantId, tenantId),
        q.action ? eq(auditLogs.action, q.action) : undefined,
        q.actorId ? eq(auditLogs.userId, q.actorId) : undefined,
        q.before ? lt(auditLogs.createdAt, new Date(q.before)) : undefined,
      ))
      .orderBy(desc(auditLogs.createdAt)).limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const actions = await db.selectDistinct({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.tenantId, tenantId)).orderBy(asc(auditLogs.action));
    return {
      entries: page,
      nextBefore: rows.length > q.limit ? page[page.length - 1].at : null,
      actions: actions.map((a) => a.action),
    };
  });
}
