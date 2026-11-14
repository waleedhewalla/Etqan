/**
 * Period tests: recording a student's four scores, the rules deciding pass or repeat, moving her to the next period, the
 * retest week, the slower pace after two failures, what the app proposes, what a student may see, and the halaqa's calendar.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { ayatOf } from '../lib/hifz-program';
import { buildApp } from '../server';
import { closeDb, getDb } from '../db';
import { hifzPeriodResults, notifications, reviewLogs, sectionEnrollments, sections, studentCards, tasmiSubmissions, tenants, users } from '../db/schema';
import { generateToken } from '../lib/jwt';
import { addDays, localDate } from '../lib/dates';

describe.skipIf(!process.env.DATABASE_URL)('period tests', () => {
  let app: FastifyInstance;
  const tag = randomUUID().slice(0, 8);
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let periods: { startWeek: number; hifzWeeks: number; weeks: number; nameAr: string; pagesPerDay: number }[] = [];
  const call = (who: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url: `/v1${url}`, headers: { authorization: `Bearer ${tokens[who]}` }, payload });
  const tok = (u: { id: string; role: string; tenantId: string | null }) => generateToken({ sub: u.id, role: u.role, facultyId: u.tenantId! });
  /** Puts the halaqa `weeks` weeks into the program. */
  const place = (weeks: number) => call('dean', 'PUT', `/admin/halaqat/${ids.section}/program`, { programId: ids.program, startDate: addDays(localDate(), -7 * weeks) });
  const atTest = (period: number) => place(periods[period].startWeek + periods[period].hifzWeeks);
  const test = (who: string, student: string, body: object) => call(who, 'POST', `/sections/${ids.section}/program/students/${ids[student]}/results`, body);
  const good = { hifz: 36, tajweed: 23, retention: 14 };
  const standings = async (who = 'teacher') => (await call(who, 'GET', `/sections/${ids.section}/program/standings`)).json();
  const standOf = async (student: string) => (await standings()).students.find((s: { studentId: string }) => s.studentId === ids[student]);
  /** Makes everything she has done look older by `days`, so the retest week has passed and the order of her attempts is kept. */
  const ageLastResult = async (student: string, days: number) => {
    const rows = await getDb().select().from(hifzPeriodResults).where(eq(hifzPeriodResults.studentId, ids[student]));
    for (const r of rows) await getDb().update(hifzPeriodResults).set({ createdAt: new Date(r.createdAt.getTime() - days * 86_400_000) }).where(eq(hifzPeriodResults.id, r.id));
  };
  const mailOf = (student: string) => getDb().select().from(notifications).where(eq(notifications.userId, ids[student]));

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const db = getDb();
    const [tenant] = await db.insert(tenants).values({ slug: `pt-${tag}`, nameAr: 'معهد' }).returning();
    const [other] = await db.insert(tenants).values({ slug: `px-${tag}`, nameAr: 'معهد آخر' }).returning();
    const mk = async (tenantId: string, role: typeof users.$inferInsert['role'], name: string) =>
      (await db.insert(users).values({ tenantId, role, displayNameAr: name }).returning())[0];
    const dean = await mk(tenant.id, 'dean', 'العميدة');
    const teacher = await mk(tenant.id, 'lecturer', 'المعلمة');
    const otherTeacher = await mk(tenant.id, 'lecturer', 'معلمة أخرى');
    const foreignDean = await mk(other.id, 'dean', 'عميدة أخرى');
    const asma = await mk(tenant.id, 'student', 'أسماء');
    const basma = await mk(tenant.id, 'student', 'بسمة');
    const guardian = await mk(tenant.id, 'mahram', 'ولي الأمر');
    const code = (p: string) => `${p}${tag.toUpperCase().slice(0, 6)}`;
    const [section] = await db.insert(sections).values({ tenantId: tenant.id, nameAr: 'حلقة', joinCode: code('A'), teacherId: teacher.id }).returning();
    await db.insert(sectionEnrollments).values([asma, basma].map((s) => ({ sectionId: section.id, studentId: s.id })));
    Object.assign(ids, { tenant: tenant.id, section: section.id, asma: asma.id, basma: basma.id, teacher: teacher.id });
    Object.assign(tokens, { dean: tok(dean), teacher: tok(teacher), otherTeacher: tok(otherTeacher), foreignDean: tok(foreignDean), asma: tok(asma), basma: tok(basma), guardian: tok(guardian) });

    // A program of three periods of verses, and the halaqa following it.
    const made = (await call('dean', 'POST', '/admin/programs', {
      nameAr: 'برنامج الاختبارات',
      periods: [
        { nameAr: 'الأولى', startRef: '112:1', endRef: '114:6', pagesPerDay: 0.5 },
        { nameAr: 'الثانية', startRef: '105:1', endRef: '111:5', pagesPerDay: 0.5 },
        { nameAr: 'الثالثة', startRef: '99:1', endRef: '104:9', pagesPerDay: 0.75 },
      ],
    })).json();
    ids.program = made.id;
    periods = made.periods;
    expect((await place(0)).statusCode).toBe(200);
  });

  afterAll(async () => {
    await app?.close();
    await closeDb();
  });

  it('is run by the teacher of the halaqa and its dean only', async () => {
    for (const who of ['asma', 'guardian', 'otherTeacher', 'foreignDean']) {
      expect((await call(who, 'GET', `/sections/${ids.section}/program/standings`)).statusCode, who).toBe(404);
      expect((await test(who, 'asma', { periodIndex: 0, scores: { ...good, review: null } })).statusCode, who).toBe(404);
    }
    expect((await call('dean', 'GET', `/sections/${ids.section}/program/standings`)).statusCode).toBe(200);
  });

  it('is not open before the halaqa reaches the test of the period', async () => {
    const form = (await call('teacher', 'GET', `/sections/${ids.section}/program/students/${ids.asma}/test`)).json();
    expect(form).toMatchObject({ canTest: false, reason: 'not_reached', period: { index: 0, nameAr: 'الأولى' } });
    const res = await test('teacher', 'asma', { periodIndex: 0, scores: { ...good, review: null } });
    expect(res.statusCode).toBe(409);
    expect((await standOf('asma')).status).toBe('working');
  });

  it('tests the period the student is on, with scores inside the weights', async () => {
    await atTest(0);
    expect((await standOf('asma')).status).toBe('ready');
    const form = (await call('teacher', 'GET', `/sections/${ids.section}/program/students/${ids.asma}/test`)).json();
    expect(form).toMatchObject({ canTest: true, reviewApplies: false, passScore: 85, minCriterionPct: 70 });
    // No earlier period: revision has no weight, and the others share it.
    expect(form.weights).toMatchObject({ hifz: 50, review: 0 });
    expect(form.weights.hifz + form.weights.tajweed + form.weights.retention).toBeCloseTo(100, 5);
    expect(form.proposals).toEqual({ hifz: null, tajweed: null, review: null, retention: null });

    const t = (body: object) => test('teacher', 'asma', body);
    expect((await t({ periodIndex: 1, scores: { ...good, review: null } })).statusCode).toBe(409); // not the period she is on
    expect((await t({ periodIndex: 0, scores: { hifz: 51, tajweed: 20, review: null, retention: 10 } })).statusCode).toBe(400); // over the weight
    expect((await t({ periodIndex: 0, scores: { hifz: -1, tajweed: 20, review: null, retention: 10 } })).statusCode).toBe(400);
    expect((await t({ periodIndex: 0, scores: { hifz: 40, tajweed: 20 } })).statusCode).toBe(400); // missing a score
    expect((await t({ periodIndex: 0, scores: { hifz: 40, tajweed: 20, retention: 10 }, note: 'x'.repeat(501) })).statusCode).toBe(400);
  });

  it('fails a student who misses a rule, tells her what to work on, and makes her wait a week for the retest', async () => {
    const res = await test('teacher', 'asma', { periodIndex: 0, scores: { hifz: 30, tajweed: 25, review: null, retention: 18 }, note: 'تحتاج مراجعة' });
    expect(res.statusCode).toBe(201);
    const out = res.json();
    expect(out.result).toMatchObject({ outcome: 'repeat', attempt: 1, periodName: 'الأولى', total: 73, note: 'تحتاج مراجعة' });
    expect(out.assessment.failed).toEqual(expect.arrayContaining([{ rule: 'total' }, { rule: 'criterion', criterion: 'hifz' }]));
    expect(out.assessment.weakest).toBe('hifz');
    expect(out.standing).toMatchObject({ passed: 0, failures: 1, slowdown: false, next: 'الأولى' });
    expect(out.standing.retestOn).toBe(addDays(localDate(), 5));
    const mail = (await mailOf('asma')).find((n) => (n.data as { type?: string })?.type === 'period_test')!;
    expect(mail.titleAr).toContain('إعادة');
    expect(mail.bodyAr).toContain('الحفظ'); // the criterion to work on
    expect(mail.bodyAr).toContain('أسبوع علاج');
    // Not again until the week is over.
    const again = await test('teacher', 'asma', { periodIndex: 0, scores: { ...good, review: null } });
    expect(again.statusCode).toBe(409);
    expect((await standOf('asma'))).toMatchObject({ status: 'retest_waiting', failures: 1, retestOn: addDays(localDate(), 5), canTest: false });
    expect((await call('teacher', 'GET', `/sections/${ids.section}/program/students/${ids.asma}/test`)).json()).toMatchObject({ canTest: false, reason: 'retest_waiting' });
  });

  it('passes her at the retest and moves her to the next period', async () => {
    await ageLastResult('asma', 6);
    expect((await standOf('asma')).status).toBe('retest_due');
    // Exactly at the pass mark, with each criterion at its minimum or above.
    const res = await test('teacher', 'asma', { periodIndex: 0, scores: { hifz: 42.5, tajweed: 26.6, review: null, retention: 15.9 } });
    expect(res.statusCode).toBe(201);
    expect(res.json().result).toMatchObject({ outcome: 'passed', attempt: 2, total: 85 });
    expect(res.json().standing).toMatchObject({ passed: 1, failures: 0, retestOn: null, next: 'الثانية' });
    const mail = (await mailOf('asma')).filter((n) => (n.data as { type?: string })?.type === 'period_test');
    expect(mail.map((n) => n.titleAr)).toEqual(expect.arrayContaining(['نتيجة اختبار الفترة: ناجحة']));
    expect(mail.find((n) => n.titleAr.includes('ناجحة'))!.bodyAr).toContain('الثانية');
    expect(await standOf('asma')).toMatchObject({ passed: 1, currentIndex: 1, currentName: 'الثانية', status: 'working' }); // the halaqa has not reached period 2's test
  });

  it('keeps the rules the test was made under, whatever the program says later', async () => {
    await call('dean', 'PATCH', `/admin/programs/${ids.program}`, { passScore: 95, weights: { hifz: 30, tajweed: 30, review: 20, retention: 20 } });
    const [row] = await getDb().select().from(hifzPeriodResults).where(and(eq(hifzPeriodResults.studentId, ids.asma), eq(hifzPeriodResults.attempt, 2)));
    expect(row).toMatchObject({ passScore: 85, outcome: 'passed' });
    expect(row.weights).toMatchObject({ hifz: 50 });
    await call('dean', 'PATCH', `/admin/programs/${ids.program}`, { passScore: 85, weights: { hifz: 40, tajweed: 25, review: 20, retention: 15 } });
  });

  it('lets a student see her own standing, the total and the criterion to work on, but not her scores or anyone else’s', async () => {
    const mine = (await call('asma', 'GET', `/sections/${ids.section}/program`)).json().mine;
    expect(mine).toMatchObject({ passed: 1, periodCount: 3, finished: false, currentIndex: 1, behind: false, failures: 0, slowdown: false });
    expect(mine.current).toMatchObject({ nameAr: 'الثانية', kind: 'hifz' });
    expect(mine.last).toMatchObject({ periodName: 'الأولى', outcome: 'passed', total: 85, attempt: 2 });
    expect(mine.last).toHaveProperty('weakest');
    expect(mine.last).not.toHaveProperty('scores');
    expect(JSON.stringify(mine)).not.toContain('scoreHifz');
    const basma = (await call('basma', 'GET', `/sections/${ids.section}/program`)).json().mine;
    expect(basma).toMatchObject({ passed: 0, currentIndex: 0, last: null });
    // The teacher's view carries no `mine`.
    expect((await call('teacher', 'GET', `/sections/${ids.section}/program`)).json().mine).toBeNull();
    // A student cannot read the teacher's test form or standings.
    expect((await call('asma', 'GET', `/sections/${ids.section}/program/students/${ids.basma}/test`)).statusCode).toBe(404);
  });

  it('cannot test a period the halaqa has not reached, even for a student who is ready for it', async () => {
    const res = await test('teacher', 'asma', { periodIndex: 1, scores: { ...good, review: 17 } });
    expect(res.statusCode).toBe(409);
  });

  it('lets the halaqa move on while a student who has not passed catches up, and keeps her out of the new verses', async () => {
    await atTest(1); // the halaqa is at period 2's test; Basma never passed period 1
    const s = await standings();
    expect(s.position).toMatchObject({ index: 1, phase: 'assessment' });
    expect(s.students.find((x: { name: string }) => x.name === 'بسمة')).toMatchObject({ behind: true, currentIndex: 0, status: 'ready' });
    expect(s.students.find((x: { name: string }) => x.name === 'أسماء')).toMatchObject({ behind: false, currentIndex: 1, status: 'ready' });
    expect((await call('basma', 'GET', `/sections/${ids.section}/program`)).json().mine).toMatchObject({ behind: true, currentIndex: 0 });
    // The new period's verses go only to students who are on it.
    await place(periods[1].startWeek); // period 2's first week
    const applied = (await call('teacher', 'POST', `/sections/${ids.section}/program/apply`)).json();
    expect(applied).toMatchObject({ students: 1, skipped: 1 });
    const cards = (id: string) => getDb().select().from(studentCards).where(eq(studentCards.studentId, id));
    expect((await cards(ids.asma)).length).toBeGreaterThan(0);
    expect(await cards(ids.basma)).toHaveLength(0);
  });

  it('weighs revision of earlier periods in later periods', async () => {
    await atTest(1);
    const form = (await call('teacher', 'GET', `/sections/${ids.section}/program/students/${ids.asma}/test`)).json();
    expect(form).toMatchObject({ reviewApplies: true, weights: { hifz: 40, tajweed: 25, review: 20, retention: 15 } });
    // Revision is required now.
    expect((await test('teacher', 'asma', { periodIndex: 1, scores: { ...good, review: null } })).statusCode).toBe(400);
  });

  it('proposes scores from what the app already knows, and nothing where it has too little', async () => {
    const db = getDb();
    const range = ayatOf('105:1', '111:5');
    // Two recent graded recitations of this period's verses.
    await db.insert(tasmiSubmissions).values([90, 80].map((h, i) => ({
      studentId: ids.asma, sectionId: ids.section, startRef: '111:1', endRef: '111:5', reviewVerdict: 'approved' as const, reviewedAt: new Date(Date.now() - i * 86_400_000),
      reviewHifzScore: h, reviewTajweedScore: 100, reviewFluencyScore: 90, reviewWeightedTotal: 90,
    })));
    // Revision results: 12 on this period's verses (10 right), 12 on the earlier period's (6 right).
    const logs = async (refs: string[], right: number, total: number) => {
      const cards = await db.insert(studentCards).values(refs.slice(0, total).map((ayahRef) => ({ studentId: ids.asma, ayahRef }))).onConflictDoNothing().returning();
      const have = cards.length ? cards : await db.select().from(studentCards).where(eq(studentCards.studentId, ids.asma));
      const mine = have.filter((c) => refs.includes(c.ayahRef)).slice(0, total);
      await db.insert(reviewLogs).values(mine.map((c, i) => ({ cardId: c.id, rating: (i < right ? 'good' : 'again') as 'good' | 'again', wasCorrect: i < right })));
    };
    await logs(range, 10, 12);
    await logs(ayatOf('112:1', '114:6'), 6, 12);
    const form = (await call('teacher', 'GET', `/sections/${ids.section}/program/students/${ids.asma}/test`)).json();
    // hifz: average of 90 and 80 is 85% of 40; tajweed: 100% of 25; revision of the earlier period: 6 of 12 is half of 20; retention: 10 of 12 of 15.
    expect(form.proposals.hifz).toMatchObject({ score: 34, basis: { kind: 'recitations', n: 2 } });
    expect(form.proposals.tajweed).toMatchObject({ score: 25 });
    expect(form.proposals.review).toMatchObject({ score: 10, basis: { kind: 'reviews', n: 12 } });
    expect(form.proposals.retention).toMatchObject({ score: 12.5, basis: { kind: 'reviews', n: 12 } });
    // Basma has nothing recorded: no proposals.
    expect((await call('teacher', 'GET', `/sections/${ids.section}/program/students/${ids.basma}/test`)).json().proposals).toMatchObject({ hifz: null, review: null });
  });

  it('keeps what the app proposed beside what the teacher entered', async () => {
    await test('teacher', 'asma', { periodIndex: 1, scores: { hifz: 20, tajweed: 25, review: 10, retention: 12 } });
    const [row] = await getDb().select().from(hifzPeriodResults).where(and(eq(hifzPeriodResults.studentId, ids.asma), eq(hifzPeriodResults.periodIndex, 1)));
    expect(row.scoreHifz).toBe(20);
    expect(row.proposals).toMatchObject({ hifz: { score: 34 } });
    expect(row.outcome).toBe('repeat');
  });

  it('slows the next period after two failed attempts, then passes her through', async () => {
    await ageLastResult('asma', 6);
    const second = await test('teacher', 'asma', { periodIndex: 1, scores: { hifz: 22, tajweed: 25, review: 10, retention: 12 } });
    expect(second.json().result).toMatchObject({ outcome: 'repeat', attempt: 2 });
    await ageLastResult('asma', 6);
    const pass = await test('teacher', 'asma', { periodIndex: 1, scores: { hifz: 38, tajweed: 24, review: 18, retention: 13 } });
    expect(pass.json().result).toMatchObject({ outcome: 'passed', attempt: 3 });
    expect(pass.json().standing).toMatchObject({ passed: 2, slowdown: true, next: 'الثالثة' });
    const mine = (await call('asma', 'GET', `/sections/${ids.section}/program`)).json().mine;
    expect(mine).toMatchObject({ currentIndex: 2, slowdown: true });
    expect(mine.current.pagesPerDay).toBe(0.5); // the program says 0.75: one step slower
    expect(mine.current.weeks).toBeGreaterThanOrEqual(periods[2].weeks);
  });

  it('takes back a mistake, but only her latest result', async () => {
    const results = (await call('teacher', 'GET', `/sections/${ids.section}/program/students/${ids.asma}/test`)).json();
    expect(results.canTest).toBe(false); // the halaqa has not reached period 3
    const rows = await getDb().select().from(hifzPeriodResults).where(eq(hifzPeriodResults.studentId, ids.asma));
    const sorted = rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const first = sorted[0]; const last = sorted[sorted.length - 1];
    const v = (resultId: string, body: object = { reason: 'خطأ في إدخال الدرجة' }, who = 'teacher') =>
      call(who, 'POST', `/sections/${ids.section}/program/students/${ids.asma}/results/${resultId}/void`, body);
    expect((await v(first.id)).statusCode).toBe(409);
    expect((await v(last.id, { reason: 'x' })).statusCode).toBe(400);
    expect((await v(last.id, undefined, 'otherTeacher')).statusCode).toBe(404);
    expect((await v(last.id, undefined, 'asma')).statusCode).toBe(404);
    const done = await v(last.id);
    expect(done.statusCode).toBe(200);
    expect(done.json().standing).toMatchObject({ passed: 1, failures: 2 }); // back on period 2, with her two failures
    expect((await v(last.id)).statusCode).toBe(409); // already taken back
    // The result is kept, marked, and the retest is allowed again.
    const [kept] = await getDb().select().from(hifzPeriodResults).where(eq(hifzPeriodResults.id, last.id));
    expect(kept.voidedAt).not.toBeNull();
    expect(kept.voidReason).toBe('خطأ في إدخال الدرجة');
    expect((await standOf('asma'))).toMatchObject({ currentIndex: 1, failures: 2, status: 'retest_due' });
    // Entered again, correctly.
    expect((await test('teacher', 'asma', { periodIndex: 1, scores: { hifz: 38, tajweed: 24, review: 18, retention: 13 } })).json().result).toMatchObject({ outcome: 'passed', attempt: 3 });
  });

  it('finishes the program, and then there is nothing left to test', async () => {
    await place(periods[2].startWeek + periods[2].hifzWeeks);
    const done = await test('teacher', 'asma', { periodIndex: 2, scores: { hifz: 40, tajweed: 25, review: 20, retention: 15 } });
    expect(done.json().standing).toMatchObject({ passed: 3, finished: true, next: null });
    expect((await mailOf('asma')).some((n) => n.bodyAr.includes('أتممتِ'))).toBe(true);
    expect((await test('teacher', 'asma', { periodIndex: 2, scores: { hifz: 40, tajweed: 25, review: 20, retention: 15 } })).statusCode).toBe(409);
    expect((await standOf('asma'))).toMatchObject({ status: 'finished', passed: 3, canTest: false });
    expect((await call('asma', 'GET', `/sections/${ids.section}/program`)).json().mine).toMatchObject({ finished: true, passed: 3 });
  });

  it('appears in the student’s monthly record', async () => {
    const month = localDate().slice(0, 7);
    const record = (await call('teacher', 'GET', `/reports/student/${ids.asma}/monthly?month=${month}`)).json();
    // Her attempts were made (or aged) at different dates; those of this month are listed with their outcome and total.
    expect(Array.isArray(record.periodTests)).toBe(true);
    for (const t of record.periodTests) expect(t).toMatchObject({ periodName: expect.any(String), outcome: expect.stringMatching(/passed|repeat/), total: expect.any(Number) });
    expect(record.periodTests.length).toBeGreaterThan(0);
    expect(JSON.stringify(record.periodTests)).not.toContain('scoreHifz');
  });

  it('shows the dean how each period is going', async () => {
    const res = (await call('dean', 'GET', `/admin/programs/${ids.program}/results`)).json();
    expect(res).toMatchObject({ program: { id: ids.program }, students: 1 });
    expect(res.periods.map((p: { passed: number }) => p.passed)).toEqual([1, 1, 1]);
    expect(res.periods.map((p: { failedAttempts: number }) => p.failedAttempts)).toEqual([1, 2, 0]);
    for (const who of ['teacher', 'asma', 'foreignDean']) expect((await call(who, 'GET', `/admin/programs/${ids.program}/results`)).statusCode, who).toBe(who === 'foreignDean' ? 404 : 403);
  });

  it('cannot delete a program students have been tested on, only archive it', async () => {
    await call('dean', 'PUT', `/admin/halaqat/${ids.section}/program`, { programId: null });
    const res = await call('dean', 'DELETE', `/admin/programs/${ids.program}`);
    expect(res.statusCode).toBe(409);
    expect((await call('dean', 'PATCH', `/admin/programs/${ids.program}`, { active: false })).json()).toMatchObject({ active: false, hasResults: true });
  });

  it('is refused for everyone while the institution has the program module off', async () => {
    await place(0).catch(() => undefined);
    await call('dean', 'PATCH', `/admin/programs/${ids.program}`, { active: true });
    await call('dean', 'PUT', `/admin/halaqat/${ids.section}/program`, { programId: ids.program, startDate: localDate() });
    expect((await call('dean', 'PUT', '/admin/modules/program', { enabled: false })).statusCode).toBe(200);
    for (const url of [`/sections/${ids.section}/program/standings`, `/sections/${ids.section}/program/students/${ids.asma}/test`, `/admin/programs/${ids.program}/results`]) {
      const res = await call('dean', 'GET', url);
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('MODULE_DISABLED');
    }
    expect((await test('teacher', 'asma', { periodIndex: 0, scores: { ...good, review: null } })).json().code).toBe('MODULE_DISABLED');
    await call('dean', 'PUT', '/admin/modules/program', { enabled: true });
  });
});
