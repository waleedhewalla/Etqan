/**
 * Memorization programs. The institution's admin defines a program as periods, each with the verses to
 * memorize and the pace, and says which halaqa follows it from which week. The teacher and her students
 * then see what is required now; the teacher can put it in every student's plan in one step.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { compareRefs, countAyat, parseRef } from '@itqan/quran';
import { getDb } from '../../db';
import { hifzProgramPeriods, hifzPrograms, sectionEnrollments, sections } from '../../db/schema';
import { loadManagedSection } from '../../lib/access';
import { localDate } from '../../lib/dates';
import { addToPlan } from '../../lib/hifz-plan';
import {
  MAX_PERIOD_AYAT, type Measure, type PeriodConfig, ayatOf, measureRange, planPeriods, positionOn, programWarnings, sundayOf,
} from '../../lib/hifz-program';
import type { TokenPayload } from '../../lib/jwt';
import { auditLog } from '../audit/service';

const MANAGER_ROLES: readonly string[] = ['dean', 'operator', 'superadmin'];
const MAX_PERIODS = 40;

const ref = z.string().refine((r) => parseRef(r) !== null, 'Unknown verse');
const name = z.string().trim().min(2).max(120);
const periodSchema = z.object({
  nameAr: name,
  goalAr: z.string().trim().max(300).nullish().transform((v) => v || null),
  startRef: ref.nullish().transform((v) => v ?? null),
  endRef: ref.nullish().transform((v) => v ?? null),
  pagesPerDay: z.number().min(0.25).max(2).refine((n) => Number.isInteger(n * 4), 'In steps of a quarter page').default(0.75),
  extraPct: z.number().int().min(0).max(100).default(0),
  fixedWeeks: z.number().int().min(1).max(12).nullish().transform((v) => v ?? null),
}).superRefine((p, ctx) => {
  const hifz = p.startRef !== null || p.endRef !== null;
  if (hifz) {
    if (p.startRef === null || p.endRef === null) return ctx.addIssue({ code: 'custom', message: 'Give both verses or neither' });
    const start = parseRef(p.startRef)!; const end = parseRef(p.endRef)!;
    if (compareRefs(start, end) > 0) return ctx.addIssue({ code: 'custom', message: 'The range ends before it starts' });
    if (countAyat(start, end) > MAX_PERIOD_AYAT) return ctx.addIssue({ code: 'custom', message: `At most ${MAX_PERIOD_AYAT} ayat in a period` });
    if (p.fixedWeeks !== null) return ctx.addIssue({ code: 'custom', message: 'A period with verses works out its own weeks' });
  } else if (p.fixedWeeks === null) {
    ctx.addIssue({ code: 'custom', message: 'A period without verses needs its number of weeks' });
  }
});
const weightsSchema = z.object({
  hifz: z.number().int().min(0).max(100), tajweed: z.number().int().min(0).max(100),
  review: z.number().int().min(0).max(100), retention: z.number().int().min(0).max(100),
}).refine((w) => w.hifz + w.tajweed + w.review + w.retention === 100, 'The weights add up to 100');
const settings = {
  hifzDaysPerWeek: z.number().int().min(1).max(5),
  weights: weightsSchema,
  passScore: z.number().int().min(50).max(100),
  minCriterionPct: z.number().int().min(0).max(100),
};
const createSchema = z.object({
  nameAr: name,
  hifzDaysPerWeek: settings.hifzDaysPerWeek.default(4),
  weights: settings.weights.default({ hifz: 40, tajweed: 25, review: 20, retention: 15 }),
  passScore: settings.passScore.default(85),
  minCriterionPct: settings.minCriterionPct.default(70),
  periods: z.array(periodSchema).max(MAX_PERIODS).default([]),
});
const editSchema = z.object({
  nameAr: name.optional(),
  hifzDaysPerWeek: settings.hifzDaysPerWeek.optional(),
  weights: settings.weights.optional(),
  passScore: settings.passScore.optional(),
  minCriterionPct: settings.minCriterionPct.optional(),
  active: z.boolean().optional(),
}).refine((b) => Object.values(b).some((v) => v !== undefined), 'Nothing to change');
const periodsSchema = z.object({ periods: z.array(periodSchema).min(1).max(MAX_PERIODS) });
const assignSchema = z.object({
  programId: z.string().uuid().nullable(),
  /** The day the first week starts; the Sunday of that week is used. Defaults to this week. */
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(d)), 'Not a date').optional(),
});
const idParam = z.object({ id: z.string().uuid() });

type Program = typeof hifzPrograms.$inferSelect;
type PeriodRow = typeof hifzProgramPeriods.$inferSelect;

const toConfig = (p: PeriodRow): PeriodConfig => ({
  id: p.id, nameAr: p.nameAr, goalAr: p.goalAr, startRef: p.startRef, endRef: p.endRef,
  pagesPerDay: p.pagesPerDay, extraPct: p.extraPct, fixedWeeks: p.fixedWeeks,
});

export async function programRoutes(app: FastifyInstance) {
  const db = getDb();

  const tenantOf = (user: TokenPayload) => (MANAGER_ROLES.includes(user.role) && user.facultyId ? user.facultyId : null);
  const forbidden = (request: { server: FastifyInstance }) => request.server.httpErrors.forbidden('Institution managers only');

  const measureAll = (periods: PeriodConfig[]): (Measure | null)[] =>
    periods.map((p) => (p.startRef && p.endRef ? measureRange(p.startRef, p.endRef) : null));

  /** A program as the admin sees it: its settings, its periods with their weeks, and what to look at. */
  const view = async (program: Program) => {
    const rows = await db.select().from(hifzProgramPeriods).where(eq(hifzProgramPeriods.programId, program.id)).orderBy(asc(hifzProgramPeriods.sortOrder));
    const configs = rows.map(toConfig);
    const periods = planPeriods(configs, program.hifzDaysPerWeek, measureAll(configs));
    const [used] = await db.select({ n: sections.id }).from(sections).where(eq(sections.hifzProgramId, program.id)).limit(1);
    return {
      id: program.id, nameAr: program.nameAr, active: program.active, hifzDaysPerWeek: program.hifzDaysPerWeek,
      weights: { hifz: program.weightHifz, tajweed: program.weightTajweed, review: program.weightReview, retention: program.weightRetention },
      passScore: program.passScore, minCriterionPct: program.minCriterionPct,
      periods,
      totals: {
        pages: Math.round(periods.reduce((n, p) => n + p.pages, 0) * 10) / 10,
        weeks: periods.reduce((n, p) => n + p.weeks, 0),
        hifzWeeks: periods.reduce((n, p) => n + p.hifzWeeks, 0),
      },
      warnings: programWarnings(periods),
      inUse: Boolean(used),
    };
  };

  const findProgram = async (tenantId: string, id: string) =>
    (await db.select().from(hifzPrograms).where(and(eq(hifzPrograms.id, id), eq(hifzPrograms.tenantId, tenantId))).limit(1))[0];

  const savePeriods = async (programId: string, periods: z.infer<typeof periodSchema>[]) => {
    await db.transaction(async (tx) => {
      await tx.delete(hifzProgramPeriods).where(eq(hifzProgramPeriods.programId, programId));
      if (periods.length) await tx.insert(hifzProgramPeriods).values(periods.map((p, i) => ({ ...p, programId, sortOrder: i })));
    });
  };

  // GET /v1/admin/programs — the institution's programs and which halaqa follows which
  app.get('/admin/programs', { preHandler: [app.authenticate] }, async (request) => {
    const tenantId = tenantOf(request.user);
    if (!tenantId) return forbidden(request);
    const programs = await db.select().from(hifzPrograms).where(eq(hifzPrograms.tenantId, tenantId)).orderBy(asc(hifzPrograms.createdAt));
    const halaqat = await db.select({
      id: sections.id, nameAr: sections.nameAr, programId: sections.hifzProgramId, startDate: sections.hifzProgramStart,
    }).from(sections).where(and(eq(sections.tenantId, tenantId), eq(sections.active, true))).orderBy(asc(sections.nameAr));
    return {
      programs: await Promise.all(programs.map(view)),
      halaqat: halaqat.map((h) => ({ ...h, weekStart: h.startDate ? sundayOf(h.startDate) : null })),
      today: localDate(),
    };
  });

  // POST /v1/admin/programs
  app.post('/admin/programs', { schema: { body: createSchema }, preHandler: [app.authenticate] }, async (request, reply) => {
    const tenantId = tenantOf(request.user);
    if (!tenantId) return forbidden(request);
    const body = request.body as z.infer<typeof createSchema>;
    const [program] = await db.insert(hifzPrograms).values({
      tenantId, nameAr: body.nameAr, hifzDaysPerWeek: body.hifzDaysPerWeek, passScore: body.passScore, minCriterionPct: body.minCriterionPct,
      weightHifz: body.weights.hifz, weightTajweed: body.weights.tajweed, weightReview: body.weights.review, weightRetention: body.weights.retention,
      createdBy: request.user.sub,
    }).returning();
    await savePeriods(program.id, body.periods);
    await auditLog({
      actorId: request.user.sub, actorRole: request.user.role, action: 'program.created', targetType: 'hifz_program', targetId: program.id,
      metadata: { periods: body.periods.length },
    });
    return reply.code(201).send(await view(program));
  });

  // PATCH /v1/admin/programs/:id — settings: name, pace days, weights, pass marks, archive
  app.patch('/admin/programs/:id', { schema: { params: idParam, body: editSchema }, preHandler: [app.authenticate] }, async (request) => {
    const tenantId = tenantOf(request.user);
    if (!tenantId) return forbidden(request);
    const { id } = request.params as z.infer<typeof idParam>;
    const body = request.body as z.infer<typeof editSchema>;
    const program = await findProgram(tenantId, id);
    if (!program) return request.server.httpErrors.notFound('Program not found');
    const [updated] = await db.update(hifzPrograms).set({
      ...(body.nameAr !== undefined ? { nameAr: body.nameAr } : {}),
      ...(body.hifzDaysPerWeek !== undefined ? { hifzDaysPerWeek: body.hifzDaysPerWeek } : {}),
      ...(body.passScore !== undefined ? { passScore: body.passScore } : {}),
      ...(body.minCriterionPct !== undefined ? { minCriterionPct: body.minCriterionPct } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
      ...(body.weights ? { weightHifz: body.weights.hifz, weightTajweed: body.weights.tajweed, weightReview: body.weights.review, weightRetention: body.weights.retention } : {}),
      updatedAt: new Date(),
    }).where(eq(hifzPrograms.id, id)).returning();
    await auditLog({
      actorId: request.user.sub, actorRole: request.user.role, action: 'program.updated', targetType: 'hifz_program', targetId: id,
      metadata: { fields: Object.keys(body) },
    });
    return view(updated);
  });

  // PUT /v1/admin/programs/:id/periods — replaces the periods: the verses required in each, and the pace
  app.put('/admin/programs/:id/periods', { schema: { params: idParam, body: periodsSchema }, preHandler: [app.authenticate] }, async (request) => {
    const tenantId = tenantOf(request.user);
    if (!tenantId) return forbidden(request);
    const { id } = request.params as z.infer<typeof idParam>;
    const { periods } = request.body as z.infer<typeof periodsSchema>;
    const program = await findProgram(tenantId, id);
    if (!program) return request.server.httpErrors.notFound('Program not found');
    await savePeriods(id, periods);
    await db.update(hifzPrograms).set({ updatedAt: new Date() }).where(eq(hifzPrograms.id, id));
    await auditLog({
      actorId: request.user.sub, actorRole: request.user.role, action: 'program.periods.saved', targetType: 'hifz_program', targetId: id,
      metadata: { periods: periods.length },
    });
    return view(program);
  });

  // DELETE /v1/admin/programs/:id — only a program no halaqa follows; otherwise archive it
  app.delete('/admin/programs/:id', { schema: { params: idParam }, preHandler: [app.authenticate] }, async (request, reply) => {
    const tenantId = tenantOf(request.user);
    if (!tenantId) return forbidden(request);
    const { id } = request.params as z.infer<typeof idParam>;
    const program = await findProgram(tenantId, id);
    if (!program) return request.server.httpErrors.notFound('Program not found');
    const [used] = await db.select({ id: sections.id }).from(sections).where(eq(sections.hifzProgramId, id)).limit(1);
    if (used) return request.server.httpErrors.conflict('A halaqa follows this program; change it first, or archive the program');
    await db.delete(hifzPrograms).where(eq(hifzPrograms.id, id));
    await auditLog({ actorId: request.user.sub, actorRole: request.user.role, action: 'program.deleted', targetType: 'hifz_program', targetId: id });
    return reply.code(204).send();
  });

  // PUT /v1/admin/halaqat/:id/program — a halaqa follows a program from a week, or stops following one
  app.put('/admin/halaqat/:id/program', { schema: { params: idParam, body: assignSchema }, preHandler: [app.authenticate] }, async (request) => {
    const tenantId = tenantOf(request.user);
    if (!tenantId) return forbidden(request);
    const { id } = request.params as z.infer<typeof idParam>;
    const body = request.body as z.infer<typeof assignSchema>;
    const [section] = await db.select().from(sections).where(and(eq(sections.id, id), eq(sections.tenantId, tenantId))).limit(1);
    if (!section) return request.server.httpErrors.notFound('Halaqa not found');

    let startDate: string | null = null;
    if (body.programId) {
      const program = await findProgram(tenantId, body.programId);
      if (!program || !program.active) return request.server.httpErrors.badRequest('Choose an active program of this institution');
      const [period] = await db.select({ id: hifzProgramPeriods.id }).from(hifzProgramPeriods).where(eq(hifzProgramPeriods.programId, program.id)).limit(1);
      if (!period) return request.server.httpErrors.badRequest('This program has no periods yet');
      startDate = sundayOf(body.startDate ?? localDate());
    }
    await db.update(sections).set({ hifzProgramId: body.programId, hifzProgramStart: startDate, updatedAt: new Date() }).where(eq(sections.id, id));
    await auditLog({
      actorId: request.user.sub, actorRole: request.user.role, action: body.programId ? 'halaqa.program.set' : 'halaqa.program.cleared',
      targetType: 'section', targetId: id, metadata: { programId: body.programId, startDate },
    });
    return { id, programId: body.programId, startDate };
  });

  // ---- What a halaqa is working on now ----

  /** The section when the caller manages it, or is one of its students; otherwise null. */
  const reachable = async (user: TokenPayload, sectionId: string) => {
    if (!z.string().uuid().safeParse(sectionId).success) return null;
    const managed = await loadManagedSection(db, user, sectionId);
    if (managed) return { section: managed, manages: true };
    const [enrolled] = await db.select({ id: sectionEnrollments.id }).from(sectionEnrollments).where(and(
      eq(sectionEnrollments.sectionId, sectionId), eq(sectionEnrollments.studentId, user.sub), isNull(sectionEnrollments.droppedAt),
    )).limit(1);
    if (!enrolled) return null;
    const [section] = await db.select().from(sections).where(eq(sections.id, sectionId)).limit(1);
    return section ? { section, manages: false } : null;
  };

  /** The halaqa's program and where it is in it, or null when it follows none. */
  const standing = async (section: typeof sections.$inferSelect) => {
    if (!section.hifzProgramId || !section.hifzProgramStart) return null;
    const [program] = await db.select().from(hifzPrograms).where(eq(hifzPrograms.id, section.hifzProgramId)).limit(1);
    if (!program) return null;
    const full = await view(program);
    if (full.periods.length === 0) return null;
    const position = positionOn(full.periods, section.hifzProgramStart, localDate());
    return { full, position };
  };

  // GET /v1/sections/:id/program — the required memorization of the period the halaqa is in
  app.get('/sections/:id/program', { schema: { params: idParam }, preHandler: [app.authenticate] }, async (request) => {
    const { id } = request.params as z.infer<typeof idParam>;
    const found = await reachable(request.user, id);
    if (!found) return request.server.httpErrors.notFound('Section not found');
    const s = await standing(found.section);
    if (!s) return { program: null };
    const { full, position } = s;
    const next = full.periods[position.index + 1] ?? null;
    return {
      program: {
        id: full.id, nameAr: full.nameAr, weights: full.weights, passScore: full.passScore, minCriterionPct: full.minCriterionPct,
        hifzDaysPerWeek: full.hifzDaysPerWeek,
      },
      status: position.status,
      week: position.week,
      totalWeeks: position.totalWeeks,
      periodNumber: position.index + 1,
      periodCount: full.periods.length,
      phase: position.phase,
      weekInPeriod: position.weekInPeriod,
      startsOn: position.startsOn,
      endsOn: position.endsOn,
      period: {
        nameAr: position.period.nameAr, goalAr: position.period.goalAr, startRef: position.period.startRef, endRef: position.period.endRef,
        ayat: position.period.ayat, pages: position.period.pages, pagesPerDay: position.period.pagesPerDay,
        hifzWeeks: position.period.hifzWeeks, weeks: position.period.weeks,
        pagesPerWeek: Math.round(position.period.pagesPerDay * full.hifzDaysPerWeek * 100) / 100,
      },
      next: next ? { nameAr: next.nameAr, startRef: next.startRef, endRef: next.endRef } : null,
      canApply: found.manages && position.status === 'running' && position.phase === 'hifz',
    };
  });

  // POST /v1/sections/:id/program/apply — puts the current period's verses in every student's plan as new memorization
  app.post('/sections/:id/program/apply', { schema: { params: idParam }, preHandler: [app.authenticate] }, async (request) => {
    const { id } = request.params as z.infer<typeof idParam>;
    const section = await loadManagedSection(db, request.user, id);
    if (!section || !section.active) return request.server.httpErrors.notFound('Section not found');
    const s = await standing(section);
    if (!s) return request.server.httpErrors.conflict('This halaqa follows no program');
    const { position } = s;
    if (position.status !== 'running' || position.phase !== 'hifz' || !position.period.startRef || !position.period.endRef) {
      return request.server.httpErrors.conflict('No new memorization is required this week');
    }
    const ayat = ayatOf(position.period.startRef, position.period.endRef);
    const students = (await db.select({ id: sectionEnrollments.studentId }).from(sectionEnrollments)
      .where(and(eq(sectionEnrollments.sectionId, id), isNull(sectionEnrollments.droppedAt)))).map((r) => r.id);
    let added = 0;
    for (const studentId of students) added += (await addToPlan(db, studentId, ayat, 'new')).added;
    await auditLog({
      actorId: request.user.sub, actorRole: request.user.role, action: 'program.applied', targetType: 'section', targetId: id,
      metadata: { period: position.index + 1, ayat: ayat.length, students: students.length, added },
    });
    return { ayat: ayat.length, students: students.length, added };
  });
}
