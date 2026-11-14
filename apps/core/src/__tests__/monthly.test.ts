/**
 * The monthly student record: how issues, the total appraisal and the degree are derived,
 * and who may read it or write the teacher's appraisal.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../server';
import { closeDb, getDb } from '../db';
import { attendance, guardianLinks, sectionEnrollments, sections, tasmiSubmissions, tenants, users } from '../db/schema';
import { generateToken } from '../lib/jwt';
import { addDays, startOfLocalDay } from '../lib/dates';
import { buildMonthlyRecord, currentMonth, gradeFor, isMonth, type MonthlyInput, type MonthlyRecitation } from '../lib/monthly';

const rec = (over: Partial<MonthlyRecitation>): MonthlyRecitation => ({
  id: randomUUID(), startRef: '2:1', endRef: '2:5', submittedAt: new Date('2026-10-05T10:00:00Z'),
  verdict: 'approved', hifz: 90, tajweed: 80, fluency: 70, total: 83, notes: null, flags: [], hasVoiceReply: false,
  attempt: 1, hasLaterAttempt: false, laterGraded: false, ...over,
});
const base: MonthlyInput = { month: '2026-10', recitations: [], attendance: [], appraisal: null };

describe('gradeFor', () => {
  it('uses the Egyptian university bands', () => {
    expect([100, 85, 84.9, 75, 74, 65, 64, 50, 49, 0].map(gradeFor))
      .toEqual(['excellent', 'excellent', 'very_good', 'very_good', 'good', 'good', 'pass', 'pass', 'weak', 'weak']);
  });
});

describe('isMonth', () => {
  it('accepts YYYY-MM only', () => {
    expect(['2026-01', '2026-12'].every(isMonth)).toBe(true);
    expect(['2026-13', '2026-00', '2026-1', '26-01', '2026-01-01', ''].some(isMonth)).toBe(false);
  });
});

describe('buildMonthlyRecord', () => {
  it('averages the weighted totals of recitations with a final verdict, and derives the degree from it', () => {
    const r = buildMonthlyRecord({
      ...base,
      recitations: [
        rec({ total: 90, hifz: 95, tajweed: 90, fluency: 80 }),
        rec({ total: 70, hifz: 70, tajweed: 75, fluency: 60, verdict: 'redo' }),
        rec({ total: 40, hifz: 40, tajweed: 40, fluency: 40, verdict: 'flagged' }), // awaiting the sheikha: not counted
        rec({ total: null, hifz: null, tajweed: null, fluency: null, verdict: null }), // not reviewed: not counted
      ],
    });
    expect(r.totalAppraisal).toEqual({ average: 80, hifz: 82.5, tajweed: 82.5, fluency: 70 });
    expect(r.degree).toEqual({ score: 80, outOf: 100, grade: 'very_good' });
    expect(r.recitations).toEqual({ submitted: 4, counted: 2, approved: 1, redo: 1, awaiting: 2 });
  });

  it('rounds the degree to a whole number and keeps one decimal in the appraisal', () => {
    const r = buildMonthlyRecord({ ...base, recitations: [rec({ total: 84.4 }), rec({ total: 84.7 }), rec({ total: 84.5 })] });
    expect(r.totalAppraisal.average).toBe(84.5);
    expect(r.degree).toMatchObject({ score: 85, grade: 'excellent' });
  });

  it('has no degree, and says so as an issue, when nothing was recited', () => {
    const r = buildMonthlyRecord(base);
    expect(r.degree).toEqual({ score: null, outOf: 100, grade: null });
    expect(r.totalAppraisal.average).toBeNull();
    expect(r.issues).toEqual([{ kind: 'no_recitations' }]);
  });

  it('has no degree while every recitation still awaits a decision', () => {
    const r = buildMonthlyRecord({ ...base, recitations: [rec({ verdict: null, total: null }), rec({ verdict: 'flagged', total: 60 })] });
    expect(r.degree.score).toBeNull();
    expect(r.issues).toEqual([]);
  });

  it('lists what went wrong: recitations to repeat, confirmed mistakes, weak skills and absences', () => {
    const flag = (ayahRef: string, type: 'missing' | 'wrong' | 'added', decision?: 'confirmed' | 'dismissed') =>
      ({ id: randomUUID(), ayahRef, position: 0, type, decision });
    const r = buildMonthlyRecord({
      ...base,
      recitations: [
        rec({ startRef: '2:6', endRef: '2:10', verdict: 'redo', total: 55, hifz: 50, tajweed: 60, fluency: 60,
          flags: [flag('2:9', 'wrong', 'confirmed'), flag('2:7', 'missing', 'confirmed'), flag('2:7', 'missing', 'confirmed'),
            flag('2:8', 'added', 'dismissed'), flag('2:10', 'wrong')] }),
        rec({ total: 90, hifz: 90, tajweed: 90, fluency: 90 }),
      ],
      attendance: [{ date: '2026-10-12', present: false }, { date: '2026-10-05', present: false }, { date: '2026-10-19', present: true }],
    });
    expect(r.issues).toEqual([
      { kind: 'redo', count: 1, ranges: [{ startRef: '2:6', endRef: '2:10' }] },
      // Only flags the teacher confirmed; dismissed and undecided ones are not the student's issue.
      { kind: 'mistakes', count: 3, byType: { missing: 2, wrong: 1, added: 0 }, ayat: ['2:7', '2:9'] },
      { kind: 'absence', count: 2, dates: ['2026-10-05', '2026-10-12'] },
    ]);
    expect(r.attendance).toEqual({ present: 1, absent: 2 });

    const weak = buildMonthlyRecord({ ...base, recitations: [rec({ total: 74, hifz: 90, tajweed: 60, fluency: 69.9 })] });
    expect(weak.issues).toEqual([
      { kind: 'weak_skill', skill: 'tajweed', average: 60 },
      { kind: 'weak_skill', skill: 'fluency', average: 69.9 },
    ]);
  });

  it('counts verses recorded again once: the latest graded attempt replaces the earlier one', () => {
    const first = rec({ verdict: 'redo', total: 50, hifz: 50, tajweed: 50, fluency: 50, hasLaterAttempt: true, laterGraded: true });
    const second = rec({ attempt: 2, total: 90, hifz: 90, tajweed: 90, fluency: 90 });
    const r = buildMonthlyRecord({ ...base, recitations: [first, second, rec({ total: 70, hifz: 70, tajweed: 70, fluency: 70 })] });
    // (90 + 70) / 2, not (50 + 90 + 70) / 3
    expect(r.totalAppraisal.average).toBe(80);
    expect(r.degree.score).toBe(80);
    expect(r.recitations).toMatchObject({ submitted: 3, counted: 2, redo: 1 });
    // She already recorded it again, so it is no longer something to repeat.
    expect(r.issues.find((i) => i.kind === 'redo')).toBeUndefined();
    expect(r.items.map((i) => [i.attempt, i.replaced])).toEqual([[1, true], [2, false], [1, false]]);
  });

  it('keeps the earlier grade until the new attempt is graded', () => {
    const first = rec({ verdict: 'redo', total: 50, hifz: 50, tajweed: 50, fluency: 50, hasLaterAttempt: true, laterGraded: false });
    const second = rec({ attempt: 2, verdict: null, total: null, hifz: null, tajweed: null, fluency: null });
    const r = buildMonthlyRecord({ ...base, recitations: [first, second] });
    expect(r.degree.score).toBe(50);
    expect(r.recitations).toMatchObject({ counted: 1, awaiting: 1 });
    expect(r.issues.find((i) => i.kind === 'redo')).toBeUndefined();
  });

  it('carries the teacher\'s appraisal and her note on each recitation', () => {
    const appraisal = { note: 'تحسّن واضح', teacherName: 'المعلمة', updatedAt: new Date('2026-10-30T09:00:00Z') };
    const r = buildMonthlyRecord({ ...base, appraisal, recitations: [rec({ notes: 'راجعي المدود', hasVoiceReply: true })] });
    expect(r.appraisal).toEqual(appraisal);
    expect(r.items[0]).toMatchObject({ notes: 'راجعي المدود', hasVoiceReply: true, total: 83, verdict: 'approved' });
  });
});

describe.skipIf(!process.env.DATABASE_URL)('monthly record API', () => {
  let app: FastifyInstance;
  const tag = randomUUID().slice(0, 8);
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const auth = (who: string) => ({ authorization: `Bearer ${tokens[who]}` });
  const month = currentMonth();
  const first = `${month}-01`;
  const lastMonth = currentMonth(new Date(startOfLocalDay(first).getTime() - 86_400_000));
  /** Noon local time on a day of this month, so it never slips into another month. */
  const noon = (day: string) => new Date(startOfLocalDay(day).getTime() + 12 * 3_600_000);
  const url = (student = 'student') => `/v1/reports/student/${ids[student]}/monthly`;
  const get = (who: string, q = '', student = 'student') => app.inject({ method: 'GET', url: `${url(student)}${q}`, headers: auth(who) });
  const put = (who: string, payload: object, student = 'student') =>
    app.inject({ method: 'PUT', url: `${url(student)}/appraisal`, headers: auth(who), payload });

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const db = getDb();
    const [tenant] = await db.insert(tenants).values({ slug: `mon-${tag}`, nameAr: 'معهد' }).returning();
    const [other] = await db.insert(tenants).values({ slug: `mon-o-${tag}`, nameAr: 'آخر' }).returning();
    const mk = async (tenantId: string, role: typeof users.$inferInsert['role'], name: string) =>
      (await db.insert(users).values({ tenantId, role, displayNameAr: name }).returning())[0];
    const teacher = await mk(tenant.id, 'lecturer', 'المعلمة فاطمة');
    const outsider = await mk(other.id, 'lecturer', 'معلمة أخرى');
    const student = await mk(tenant.id, 'student', 'طالبة');
    const classmate = await mk(tenant.id, 'student', 'زميلة');
    const guardian = await mk(tenant.id, 'mahram', 'ولي الأمر');
    const [section] = await db.insert(sections).values({ tenantId: tenant.id, nameAr: 'حلقة', joinCode: `M${tag.toUpperCase().slice(0, 7)}`, teacherId: teacher.id }).returning();
    await db.insert(sectionEnrollments).values([{ sectionId: section.id, studentId: student.id }, { sectionId: section.id, studentId: classmate.id }]);
    await db.insert(guardianLinks).values({ studentId: student.id, guardianId: guardian.id });

    const reviewed = (day: string, total: number, verdict: 'approved' | 'redo', extra: object = {}) => ({
      studentId: student.id, sectionId: section.id, startRef: '2:1', endRef: '2:5', submittedAt: noon(day),
      reviewedAt: noon(day), reviewedBy: teacher.id, reviewVerdict: verdict,
      reviewHifzScore: total, reviewTajweedScore: total, reviewFluencyScore: total, reviewWeightedTotal: total, ...extra,
    });
    await db.insert(tasmiSubmissions).values([
      reviewed(first, 92, 'approved', { reviewNotes: 'أحسنتِ' }),
      reviewed(addDays(first, 1), 60, 'redo', {
        aiFlaggedErrors: [{ id: 'f1', ayahRef: '2:3', position: 1, type: 'wrong', decision: 'confirmed' }],
      }),
      { studentId: student.id, sectionId: section.id, startRef: '2:6', endRef: '2:9', submittedAt: noon(addDays(first, 2)) },
      // The last moment of the previous month belongs to the previous month.
      reviewed(addDays(first, -1), 10, 'approved'),
    ]);
    await db.insert(attendance).values([
      { sectionId: section.id, studentId: student.id, date: first, present: false, markedBy: teacher.id },
      { sectionId: section.id, studentId: student.id, date: addDays(first, -1), present: false, markedBy: teacher.id },
    ]);
    Object.assign(ids, { student: student.id, classmate: classmate.id });
    const tok = (u: { id: string; role: string; tenantId: string | null }) => generateToken({ sub: u.id, role: u.role, facultyId: u.tenantId! });
    Object.assign(tokens, { teacher: tok(teacher), outsider: tok(outsider), student: tok(student), classmate: tok(classmate), guardian: tok(guardian) });
  });

  afterAll(async () => {
    await app?.close();
    await closeDb();
  });

  it('builds this month from her recitations and attendance, leaving other months out', async () => {
    const res = await get('teacher');
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r).toMatchObject({
      month,
      student: { id: ids.student, displayNameAr: 'طالبة' },
      recitations: { submitted: 3, counted: 2, approved: 1, redo: 1, awaiting: 1 },
      totalAppraisal: { average: 76 },
      degree: { score: 76, outOf: 100, grade: 'very_good' },
      attendance: { present: 0, absent: 1 },
      appraisal: null,
    });
    expect(r.issues.map((i: { kind: string }) => i.kind)).toEqual(['redo', 'mistakes', 'absence']);
    expect(r.items).toHaveLength(3);

    const previous = (await get('teacher', `?month=${lastMonth}`)).json();
    expect(previous).toMatchObject({ month: lastMonth, degree: { score: 10, grade: 'weak' }, attendance: { absent: 1 } });
  });

  it('can be read by the student, her guardian and her teacher, and nobody else', async () => {
    for (const who of ['student', 'guardian', 'teacher']) expect((await get(who)).statusCode).toBe(200);
    for (const who of ['classmate', 'outsider']) expect((await get(who)).statusCode).toBe(404);
    expect((await get('teacher', '?month=2026-13')).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: url() })).statusCode).toBe(401);
  });

  it('lets her teacher write the month\'s appraisal, and change it', async () => {
    const saved = await put('teacher', { month, note: '  مجتهدة، وتحتاج إلى تثبيت أواخر الآيات.  ' });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().appraisal).toMatchObject({ note: 'مجتهدة، وتحتاج إلى تثبيت أواخر الآيات.', teacherName: 'المعلمة فاطمة' });
    expect(saved.json().degree.score).toBe(76); // the written appraisal does not change the degree

    await put('teacher', { month, note: 'تحسّنت كثيراً.' });
    expect((await get('student')).json().appraisal.note).toBe('تحسّنت كثيراً.');
    expect((await get('teacher', `?month=${lastMonth}`)).json().appraisal).toBeNull();
  });

  it('refuses an appraisal from anyone but her staff, and bad input', async () => {
    for (const who of ['student', 'guardian', 'classmate', 'outsider']) {
      expect((await put(who, { month, note: 'ممتازة' })).statusCode).toBe(404);
    }
    expect((await put('teacher', { month, note: '   ' })).statusCode).toBe(400);
    expect((await put('teacher', { month: '2026-1', note: 'ملاحظة' })).statusCode).toBe(400);
    expect((await put('teacher', { month: '2999-01', note: 'ملاحظة' })).statusCode).toBe(400);
    expect((await put('teacher', { month, note: 'x'.repeat(2001) })).statusCode).toBe(400);
    expect((await get('student')).json().appraisal.note).toBe('تحسّنت كثيراً.');
  });
});
