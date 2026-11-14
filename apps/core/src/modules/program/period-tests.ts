/**
 * Period tests. When a halaqa reaches the test of a period, the teacher records each student's four scores; the rules the
 * admin set decide whether she passes. Passing moves her to the next period; failing keeps her on this one for a week of work
 * and then a retest (two failed attempts slow the pace of the next period). The halaqa moves on with the calendar, and a student
 * who has not passed catches up on her own.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { assess, scoreProblem, type Criterion } from '@itqan/quran';
import { getDb } from '../../db';
import { hifzPeriodResults, hifzPrograms, notifications, sectionEnrollments, sections, users } from '../../db/schema';
import { loadManagedSection } from '../../lib/access';
import { localDate } from '../../lib/dates';
import type { PeriodPlan, Position } from '../../lib/hifz-program';
import { moduleOn } from '../../lib/modules';
import {
  describeStanding, loadAttempts, proposalsFor, reviewApplies, teacherResult, type Result,
} from '../../lib/period-tests';
import { programView, sectionStanding } from '../../lib/program-load';
import { auditLog } from '../audit/service';

const idSection = z.object({ id: z.string().uuid() });
const idStudent = z.object({ id: z.string().uuid(), studentId: z.string().uuid() });
const idResult = z.object({ id: z.string().uuid(), studentId: z.string().uuid(), resultId: z.string().uuid() });
const score = z.number().min(0).max(100);
const recordSchema = z.object({
  periodIndex: z.number().int().min(0).max(100),
  scores: z.object({ hifz: score, tajweed: score, review: score.nullable().optional(), retention: score }),
  note: z.string().trim().max(500).optional(),
});
const voidSchema = z.object({ reason: z.string().trim().min(3).max(300) });

export const CRITERION_AR: Record<Criterion, string> = { hifz: 'الحفظ', tajweed: 'التجويد', review: 'المراجعة', retention: 'التثبيت' };
const digits = (n: number) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 1 }).format(n);
const dayAr = (date: string) => new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

type Reason = 'not_started' | 'not_reached' | 'finished' | 'retest_waiting';

/** Whether this period of the program may be tested now, as far as the halaqa's calendar goes. */
export function reachedTest(position: Position, periods: PeriodPlan[], index: number): boolean {
  if (position.status === 'not_started') return false;
  if (position.status === 'finished' || index < position.index) return true;
  if (index > position.index) return false;
  const period = periods[index];
  return position.phase === 'assessment' || (period.kind === 'consolidation' && position.weekInPeriod === period.weeks);
}

export async function periodTestRoutes(app: FastifyInstance) {
  const db = getDb();

  /** The halaqa the caller manages and the program it follows, or the reply to send. */
  const programOf = async (request: { server: FastifyInstance; user: Parameters<typeof loadManagedSection>[1] }, sectionId: string) => {
    const section = await loadManagedSection(db, request.user, sectionId);
    if (!section || !section.active) return { error: request.server.httpErrors.notFound('Section not found') };
    const found = await sectionStanding(db, section);
    if (!found) return { error: request.server.httpErrors.conflict('This halaqa follows no program') };
    return { section, ...found };
  };

  const activeStudents = async (sectionId: string) => db.select({ id: users.id, name: users.displayNameAr }).from(sectionEnrollments)
    .innerJoin(users, eq(sectionEnrollments.studentId, users.id))
    .where(and(eq(sectionEnrollments.sectionId, sectionId), isNull(sectionEnrollments.droppedAt), eq(users.active, true)))
    .orderBy(asc(users.displayNameAr));

  /** Why the student's current period cannot be tested now, or null when it can. */
  const blocked = (standing: ReturnType<typeof describeStanding>, position: Position, periods: PeriodPlan[]): Reason | null => {
    if (standing.finished) return 'finished';
    if (position.status === 'not_started') return 'not_started';
    if (!reachedTest(position, periods, standing.current)) return 'not_reached';
    if (standing.retestWaiting) return 'retest_waiting';
    return null;
  };

  // GET /v1/sections/:id/program/standings — where each student of the halaqa stands in the program
  app.get('/sections/:id/program/standings', { schema: { params: idSection }, preHandler: [app.authenticate] }, async (request) => {
    const { id } = request.params as z.infer<typeof idSection>;
    const found = await programOf(request, id);
    if ('error' in found) return found.error;
    const { full, position } = found;
    const students = await activeStudents(id);
    const attempts = await loadAttempts(db, students.map((s) => s.id), full.id);
    const today = localDate();
    return {
      program: { id: full.id, nameAr: full.nameAr },
      position: { status: position.status, index: position.index, phase: position.phase, periodName: position.period.nameAr },
      periods: full.periods.map((p, i) => ({ index: i, nameAr: p.nameAr, kind: p.kind })),
      students: students.map((s) => {
        const st = describeStanding(attempts.get(s.id) ?? [], full.periods, full.hifzDaysPerWeek);
        const reason = blocked(st, position, full.periods);
        const status = st.finished ? 'finished'
          : reason === null ? (st.last && st.last.outcome === 'repeat' && st.last.periodIndex === st.current ? 'retest_due' : 'ready')
          : reason === 'retest_waiting' ? 'retest_waiting' : 'working';
        return {
          studentId: s.id, name: s.name, passed: st.passed, currentIndex: st.current, currentName: full.periods[st.current]?.nameAr ?? null,
          failures: st.failures, behind: !st.finished && st.current < position.index, status, canTest: reason === null, retestOn: st.retestOn, slowdown: st.slowdown,
          last: st.last ? { outcome: st.last.outcome, total: st.last.total, periodName: st.last.periodName, attempt: st.last.attempt, at: st.last.createdAt } : null,
          today,
        };
      }),
    };
  });

  // GET /v1/sections/:id/program/students/:studentId/test — what the test form needs: the period, the rules, what the app suggests
  app.get('/sections/:id/program/students/:studentId/test', { schema: { params: idStudent }, preHandler: [app.authenticate] }, async (request) => {
    const { id, studentId } = request.params as z.infer<typeof idStudent>;
    const found = await programOf(request, id);
    if ('error' in found) return found.error;
    const { full, position } = found;
    const student = (await activeStudents(id)).find((s) => s.id === studentId);
    if (!student) return request.server.httpErrors.notFound('Student not found in this halaqa');
    const results = (await loadAttempts(db, [studentId], full.id)).get(studentId)!;
    const st = describeStanding(results, full.periods, full.hifzDaysPerWeek);
    const index = Math.min(st.current, full.periods.length - 1);
    const applies = reviewApplies(full.periods, index);
    const rules = { weights: full.weights, passScore: full.passScore, minCriterionPct: full.minCriterionPct };
    const weights = assess({ hifz: 0, tajweed: 0, review: 0, retention: 0 }, rules, applies).weights;
    const reason = blocked(st, position, full.periods);
    return {
      student: { id: student.id, name: student.name },
      period: { index, nameAr: full.periods[index].nameAr, kind: full.periods[index].kind, startRef: full.periods[index].startRef, endRef: full.periods[index].endRef },
      weights, reviewApplies: applies, passScore: full.passScore, minCriterionPct: full.minCriterionPct,
      proposals: st.finished ? null : await proposalsFor(db, studentId, full.periods, index, weights),
      canTest: reason === null, reason, retestOn: st.retestOn,
      attempts: results.filter((r) => r.periodIndex === index).map(teacherResult),
      /** Her latest result of any period: the one a teacher may take back. */
      latest: results.length ? teacherResult(results[results.length - 1]) : null,
      standing: { passed: st.passed, finished: st.finished, failures: st.failures },
    };
  });

  // POST /v1/sections/:id/program/students/:studentId/results — records a test; the rules decide the outcome
  app.post('/sections/:id/program/students/:studentId/results', { schema: { params: idStudent, body: recordSchema }, preHandler: [app.authenticate] }, async (request, reply) => {
    const { id, studentId } = request.params as z.infer<typeof idStudent>;
    const body = request.body as z.infer<typeof recordSchema>;
    const errors = request.server.httpErrors;
    const found = await programOf(request, id);
    if ('error' in found) return found.error;
    const { full, position, section } = found;
    const student = (await activeStudents(id)).find((s) => s.id === studentId);
    if (!student) return errors.notFound('Student not found in this halaqa');

    const results = (await loadAttempts(db, [studentId], full.id)).get(studentId)!;
    const st = describeStanding(results, full.periods, full.hifzDaysPerWeek);
    if (st.finished) return errors.conflict('This student has passed every period');
    if (body.periodIndex !== st.current) return errors.conflict(`She is on period ${st.current + 1}: test that one`);
    if (position.status === 'not_started' || !reachedTest(position, full.periods, st.current)) {
      return errors.conflict('The halaqa has not reached the test of this period yet');
    }
    if (st.retestWaiting) {
      throw Object.assign(errors.conflict(`A retest is allowed from ${st.retestOn}`), { code: 'RETEST_TOO_SOON' });
    }

    const applies = reviewApplies(full.periods, st.current);
    const rules = { weights: full.weights, passScore: full.passScore, minCriterionPct: full.minCriterionPct };
    const scores = { hifz: body.scores.hifz, tajweed: body.scores.tajweed, review: applies ? body.scores.review ?? NaN : 0, retention: body.scores.retention };
    const weights = assess({ hifz: 0, tajweed: 0, review: 0, retention: 0 }, rules, applies).weights;
    const bad = scoreProblem(scores, weights);
    if (bad) return errors.badRequest(`The ${bad} score must be between 0 and ${weights[bad]}`);
    const outcome = assess(scores, rules, applies);
    const proposals = await proposalsFor(db, studentId, full.periods, st.current, weights);

    const period = full.periods[st.current];
    const [row] = await db.insert(hifzPeriodResults).values({
      studentId, sectionId: id, programId: full.id, periodIndex: st.current, periodName: period.nameAr, attempt: st.failures + 1,
      scoreHifz: scores.hifz, scoreTajweed: scores.tajweed, scoreReview: applies ? scores.review : null, scoreRetention: scores.retention,
      weights: outcome.weights, passScore: full.passScore, minCriterionPct: full.minCriterionPct, total: outcome.total, outcome: outcome.outcome,
      failedRules: outcome.failed, proposals: proposals as Record<string, unknown>, note: body.note || null, enteredBy: request.user.sub,
    }).returning();

    const after = describeStanding([...results, row], full.periods, full.hifzDaysPerWeek);
    const next = full.periods[after.current] ?? null;
    await auditLog({
      actorId: request.user.sub, actorRole: request.user.role, tenantId: section.tenantId, action: 'program.period_test', targetType: 'user', targetId: studentId,
      metadata: { sectionId: id, period: st.current + 1, attempt: row.attempt, outcome: row.outcome, total: row.total },
    });

    if (await moduleOn(section.tenantId, 'notifications')) {
      const weakest = outcome.weakest ? CRITERION_AR[outcome.weakest] : null;
      const bodyAr = outcome.outcome === 'passed'
        ? `نجحتِ في «${period.nameAr}» بمجموع ${digits(row.total)} من ١٠٠. ${next ? `تنتقلين إلى «${next.nameAr}».` : 'أتممتِ فترات البرنامج كلها. بارك الله فيكِ.'}`
        : `لم تتحقق شروط الانتقال في «${period.nameAr}» (المجموع ${digits(row.total)}${weakest ? `، والأولى بالعناية: ${weakest}` : ''}). أسبوع علاج بلا حفظ جديد، ثم يُعاد الاختبار من ${dayAr(after.retestOn!)}.`;
      await db.insert(notifications).values({
        userId: studentId, titleAr: outcome.outcome === 'passed' ? 'نتيجة اختبار الفترة: ناجحة' : 'نتيجة اختبار الفترة: إعادة',
        bodyAr, data: { type: 'period_test', outcome: row.outcome, resultId: row.id },
      });
    }
    return reply.code(201).send({
      result: teacherResult(row), assessment: { failed: outcome.failed, weakest: outcome.weakest },
      standing: { passed: after.passed, finished: after.finished, failures: after.failures, retestOn: after.retestOn, slowdown: after.slowdown, next: next?.nameAr ?? null },
    });
  });

  // POST /v1/sections/:id/program/students/:studentId/results/:resultId/void — takes back her latest result (a mistake in the scores)
  app.post('/sections/:id/program/students/:studentId/results/:resultId/void', { schema: { params: idResult, body: voidSchema }, preHandler: [app.authenticate] }, async (request) => {
    const { id, studentId, resultId } = request.params as z.infer<typeof idResult>;
    const { reason } = request.body as z.infer<typeof voidSchema>;
    const errors = request.server.httpErrors;
    const found = await programOf(request, id);
    if ('error' in found) return found.error;
    const results = (await loadAttempts(db, [studentId], found.full.id)).get(studentId)!;
    const latest = results[results.length - 1];
    if (!latest || latest.id !== resultId) return errors.conflict('Only her latest result can be taken back');
    await db.update(hifzPeriodResults).set({ voidedAt: new Date(), voidedBy: request.user.sub, voidReason: reason }).where(eq(hifzPeriodResults.id, resultId));
    await auditLog({
      actorId: request.user.sub, actorRole: request.user.role, tenantId: found.section.tenantId, action: 'program.period_test.voided', targetType: 'user', targetId: studentId,
      metadata: { sectionId: id, resultId, period: latest.periodIndex + 1, attempt: latest.attempt, reason },
    });
    const after = describeStanding(results.slice(0, -1), found.full.periods, found.full.hifzDaysPerWeek);
    return { standing: { passed: after.passed, finished: after.finished, failures: after.failures, retestOn: after.retestOn } };
  });

  // GET /v1/admin/programs/:id/results — how each period is going across the institution's halaqat
  app.get('/admin/programs/:id/results', { schema: { params: idSection }, preHandler: [app.authenticate] }, async (request) => {
    const user = request.user;
    if (!['dean', 'operator', 'superadmin'].includes(user.role) || !user.facultyId) return request.server.httpErrors.forbidden('Institution managers only');
    const { id } = request.params as z.infer<typeof idSection>;
    const [program] = await db.select().from(hifzPrograms).where(and(eq(hifzPrograms.id, id), eq(hifzPrograms.tenantId, user.facultyId))).limit(1);
    if (!program) return request.server.httpErrors.notFound('Program not found');
    const full = await programView(db, program);
    const rows = await db.select().from(hifzPeriodResults).where(and(eq(hifzPeriodResults.programId, id), isNull(hifzPeriodResults.voidedAt))).orderBy(asc(hifzPeriodResults.createdAt));
    const byStudent = new Map<string, Result[]>();
    for (const r of rows) byStudent.set(r.studentId, [...(byStudent.get(r.studentId) ?? []), r]);
    const periods = full.periods.map((p, index) => ({ index, nameAr: p.nameAr, passed: 0, failedAttempts: 0, repeating: 0 }));
    for (const results of byStudent.values()) {
      const st = describeStanding(results, full.periods, full.hifzDaysPerWeek);
      for (const r of results) if (periods[r.periodIndex] && r.outcome === 'repeat') periods[r.periodIndex].failedAttempts += 1;
      for (let i = 0; i < st.passed; i++) periods[i].passed += 1;
      if (!st.finished && st.failures > 0) periods[st.current].repeating += 1;
    }
    return { program: { id: full.id, nameAr: full.nameAr }, students: byStudent.size, periods };
  });
}
