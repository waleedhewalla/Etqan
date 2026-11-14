/**
 * Memorization programs: the schedule worked out from each period's verses and pace, who may configure
 * it, a halaqa following it from a week, and what a teacher and her students see as required now.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { estimatePages, hifzWeeksFor, wordsBetween } from '@itqan/quran';
import { buildApp } from '../server';
import { closeDb, getDb } from '../db';
import { sectionEnrollments, sections, studentCards, tenants, users } from '../db/schema';
import { generateToken } from '../lib/jwt';
import { localDate } from '../lib/dates';
import { measureRange, planPeriods, positionOn, programWarnings, sundayOf, type PeriodConfig } from '../lib/hifz-program';

const period = (over: Partial<PeriodConfig>): PeriodConfig => ({
  nameAr: 'فترة', goalAr: null, startRef: null, endRef: null, pagesPerDay: 0.75, extraPct: 0, fixedWeeks: null, ...over,
});
const plan = (periods: PeriodConfig[], days = 4) =>
  planPeriods(periods, days, periods.map((p) => (p.startRef && p.endRef ? measureRange(p.startRef, p.endRef) : null)));

describe('how big a period is, and how long it takes', () => {
  it('counts the pages of a range from its words, headings included', () => {
    expect(wordsBetween('112:1', '112:4')).toBe(15);
    expect(wordsBetween('2:5', '2:1')).toBe(0);
    // Juz' 'Amma is about 22 to 23 pages in the Madinah mushaf; the whole Quran is 604.
    expect(estimatePages('78:1', '114:6')).toBeGreaterThan(21.5);
    expect(estimatePages('78:1', '114:6')).toBeLessThan(23.5);
    expect(estimatePages('1:1', '114:6')).toBeGreaterThan(598);
    expect(estimatePages('1:1', '114:6')).toBeLessThan(610);
    // A sura begun inside the range brings its heading with it; starting after its first verse does not.
    expect(estimatePages('2:1', '2:20') - estimatePages('2:2', '2:20')).toBeGreaterThanOrEqual(0.1);
  });

  it('needs whole weeks of memorization, at least one', () => {
    expect(hifzWeeksFor(6, 0.75, 0, 4)).toBe(2); // exactly 2 weeks of 3 pages
    expect(hifzWeeksFor(8, 0.75, 0, 4)).toBe(3);
    expect(hifzWeeksFor(8, 0.75, 25, 4)).toBe(4);
    expect(hifzWeeksFor(0.2, 1, 0, 4)).toBe(1);
    expect(hifzWeeksFor(8, 0.75, 0, 3)).toBe(4); // fewer memorization days a week
  });

  it('adds a test week to a memorization period and keeps a consolidation period as it is', () => {
    const periods = plan([
      period({ nameAr: 'تأسيس', startRef: '114:1', endRef: '114:6' }),
      period({ nameAr: 'توسع', startRef: '100:1', endRef: '91:15' }),
      period({ nameAr: 'تثبيت', fixedWeeks: 3 }),
    ]);
    expect(periods.map((p) => p.kind)).toEqual(['hifz', 'hifz', 'consolidation']);
  });

  it('chains the weeks: each period starts where the one before ended', () => {
    const periods = plan([
      period({ startRef: '78:1', endRef: '90:20', pagesPerDay: 0.5 }),
      period({ startRef: '91:1', endRef: '114:6', pagesPerDay: 1 }),
      period({ fixedWeeks: 2 }),
    ]);
    expect(periods[0].startWeek).toBe(0);
    expect(periods[1].startWeek).toBe(periods[0].weeks);
    expect(periods[2].startWeek).toBe(periods[0].weeks + periods[1].weeks);
    expect(periods[0].weeks).toBe(periods[0].hifzWeeks + 1);
    expect(periods[2]).toMatchObject({ kind: 'consolidation', hifzWeeks: 0, weeks: 2, pages: 0, ayat: 0 });
  });

  it('warns about overlapping ranges and about periods too short or too long to assess', () => {
    const periods = plan([
      period({ startRef: '1:1', endRef: '1:7' }),
      period({ startRef: '1:5', endRef: '2:5' }),
      period({ startRef: '3:1', endRef: '3:200', pagesPerDay: 0.25 }),
    ]);
    const warnings = programWarnings(periods);
    expect(warnings).toContainEqual({ type: 'overlap', a: 0, b: 1 });
    expect(warnings.filter((w) => w.type === 'overlap')).toHaveLength(1);
    expect(warnings).toContainEqual({ type: 'short', period: 0, weeks: 1 });
    expect(warnings.some((w) => w.type === 'long' && w.period === 2)).toBe(true);
  });
});

describe('where a halaqa is in its program', () => {
  const periods = plan([
    period({ nameAr: 'أولى', startRef: '1:1', endRef: '2:30' }),
    period({ nameAr: 'ثانية', fixedWeeks: 2 }),
  ]);
  const first = periods[0];

  it('weeks run Sunday to Thursday', () => {
    expect(sundayOf('2026-11-15')).toBe('2026-11-15'); // a Sunday
    expect(sundayOf('2026-11-19')).toBe('2026-11-15'); // Thursday
    expect(sundayOf('2026-11-21')).toBe('2026-11-15'); // Saturday belongs to the week before the next Sunday
    expect(sundayOf('2026-11-22')).toBe('2026-11-22');
  });

  it('is not started before the first Sunday and finished after the last week', () => {
    expect(positionOn(periods, '2026-11-15', '2026-11-14')).toMatchObject({ status: 'not_started', week: 0, index: 0 });
    const total = first.weeks + 2;
    expect(positionOn(periods, '2026-11-15', '2026-11-15')).toMatchObject({ status: 'running', week: 1, phase: 'hifz', weekInPeriod: 1 });
    const after = positionOn(periods, '2026-11-15', localDateAfter('2026-11-15', total * 7));
    expect(after).toMatchObject({ status: 'finished', week: total, index: 1 });
  });

  it('moves from memorization to the test week to the next period', () => {
    const at = (week: number) => positionOn(periods, '2026-11-15', localDateAfter('2026-11-15', week * 7 + 2));
    expect(at(first.hifzWeeks - 1).phase).toBe('hifz');
    expect(at(first.hifzWeeks)).toMatchObject({ phase: 'assessment', index: 0, weekInPeriod: first.weeks });
    expect(at(first.weeks)).toMatchObject({ phase: 'consolidation', index: 1, weekInPeriod: 1 });
    const p = at(first.weeks);
    expect(p.startsOn).toBe(localDateAfter('2026-11-15', first.weeks * 7));
    expect(p.endsOn).toBe(localDateAfter('2026-11-15', (first.weeks + 1) * 7 + 4)); // the Thursday of its second week
  });
});
function localDateAfter(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe.skipIf(!process.env.DATABASE_URL)('configuring programs', () => {
  let app: FastifyInstance;
  const tag = randomUUID().slice(0, 8);
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const call = (who: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url: `/v1${url}`, headers: { authorization: `Bearer ${tokens[who]}` }, payload });
  const periods = [
    { nameAr: 'التأسيس', goalAr: 'عادة يومية', startRef: '112:1', endRef: '114:6', pagesPerDay: 0.5 },
    { nameAr: 'التوسع', startRef: '100:1', endRef: '111:5', pagesPerDay: 0.75, extraPct: 25 },
    { nameAr: 'التثبيت', fixedWeeks: 2 },
  ];

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const db = getDb();
    const [tenant] = await db.insert(tenants).values({ slug: `prg-${tag}`, nameAr: 'معهد' }).returning();
    const [otherTenant] = await db.insert(tenants).values({ slug: `prx-${tag}`, nameAr: 'معهد آخر' }).returning();
    const mk = async (tenantId: string, role: typeof users.$inferInsert['role'], name: string) =>
      (await db.insert(users).values({ tenantId, role, displayNameAr: name }).returning())[0];
    const dean = await mk(tenant.id, 'dean', 'العميدة');
    const otherDean = await mk(otherTenant.id, 'dean', 'عميدة أخرى');
    const advisor = await mk(tenant.id, 'advisor', 'المستشارة');
    const teacher = await mk(tenant.id, 'lecturer', 'المعلمة');
    const otherTeacher = await mk(tenant.id, 'lecturer', 'معلمة أخرى');
    const student = await mk(tenant.id, 'student', 'أسماء');
    const classmate = await mk(tenant.id, 'student', 'بسمة');
    const outsider = await mk(tenant.id, 'student', 'من حلقة أخرى');
    const code = (p: string) => `${p}${tag.toUpperCase().slice(0, 6)}`;
    const [section] = await db.insert(sections).values({ tenantId: tenant.id, nameAr: 'حلقة', joinCode: code('P'), teacherId: teacher.id }).returning();
    const [other] = await db.insert(sections).values({ tenantId: tenant.id, nameAr: 'أخرى', joinCode: code('O'), teacherId: otherTeacher.id }).returning();
    await db.insert(sectionEnrollments).values([
      { sectionId: section.id, studentId: student.id }, { sectionId: section.id, studentId: classmate.id }, { sectionId: other.id, studentId: outsider.id },
    ]);
    Object.assign(ids, { section: section.id, other: other.id, student: student.id, classmate: classmate.id });
    const tok = (u: { id: string; role: string; tenantId: string | null }) => generateToken({ sub: u.id, role: u.role, facultyId: u.tenantId! });
    Object.assign(tokens, {
      dean: tok(dean), otherDean: tok(otherDean), advisor: tok(advisor), teacher: tok(teacher), otherTeacher: tok(otherTeacher),
      student: tok(student), outsider: tok(outsider),
    });
  });

  afterAll(async () => {
    await app?.close();
    await closeDb();
  });

  it('is configured by the institution managers only', async () => {
    for (const who of ['teacher', 'student', 'advisor']) {
      expect((await call(who, 'GET', '/admin/programs')).statusCode).toBe(403);
      expect((await call(who, 'POST', '/admin/programs', { nameAr: 'برنامج' })).statusCode).toBe(403);
    }
    expect((await call('dean', 'GET', '/admin/programs')).json().programs).toEqual([]);
  });

  it('creates a program with its defaults and works out the weeks of each period', async () => {
    const res = await call('dean', 'POST', '/admin/programs', { nameAr: 'برنامج الحفظ', periods });
    expect(res.statusCode).toBe(201);
    const program = res.json();
    ids.program = program.id;
    expect(program).toMatchObject({
      nameAr: 'برنامج الحفظ', hifzDaysPerWeek: 4, passScore: 85, minCriterionPct: 70, active: true, inUse: false,
      weights: { hifz: 40, tajweed: 25, review: 20, retention: 15 },
    });
    expect(program.periods.map((p: { nameAr: string }) => p.nameAr)).toEqual(['التأسيس', 'التوسع', 'التثبيت']);
    const [a, b, c] = program.periods;
    expect(a).toMatchObject({ kind: 'hifz', startRef: '112:1', endRef: '114:6', ayat: 15, startWeek: 0 });
    expect(a.pages).toBeGreaterThan(0.5);
    expect(a.weeks).toBe(a.hifzWeeks + 1);
    expect(b).toMatchObject({ kind: 'hifz', startWeek: a.weeks, extraPct: 25 });
    expect(c).toMatchObject({ kind: 'consolidation', weeks: 2, hifzWeeks: 0, startWeek: a.weeks + b.weeks });
    expect(program.totals.weeks).toBe(a.weeks + b.weeks + 2);
    expect(program.totals.hifzWeeks).toBe(a.hifzWeeks + b.hifzWeeks);
  });

  it('keeps programs apart between institutions', async () => {
    expect((await call('otherDean', 'GET', '/admin/programs')).json().programs).toEqual([]);
    expect((await call('otherDean', 'PATCH', `/admin/programs/${ids.program}`, { active: false })).statusCode).toBe(404);
    expect((await call('otherDean', 'PUT', `/admin/programs/${ids.program}/periods`, { periods })).statusCode).toBe(404);
    expect((await call('otherDean', 'DELETE', `/admin/programs/${ids.program}`)).statusCode).toBe(404);
  });

  it('refuses periods that cannot be memorized or scheduled', async () => {
    const put = (p: object) => call('dean', 'PUT', `/admin/programs/${ids.program}/periods`, { periods: [{ nameAr: 'فترة', ...p }] });
    expect((await put({ startRef: '112:1' })).statusCode).toBe(400); // one end only
    expect((await put({ startRef: '114:1', endRef: '112:1' })).statusCode).toBe(400); // backwards
    expect((await put({ startRef: '2:1', endRef: '20:1' })).statusCode).toBe(400); // too many ayat
    expect((await put({ startRef: '1:300', endRef: '2:1' })).statusCode).toBe(400); // no such verse
    expect((await put({})).statusCode).toBe(400); // neither verses nor weeks
    expect((await put({ startRef: '1:1', endRef: '1:7', fixedWeeks: 2 })).statusCode).toBe(400); // both
    expect((await put({ startRef: '1:1', endRef: '1:7', pagesPerDay: 0.6 })).statusCode).toBe(400); // not a quarter step
    expect((await put({ startRef: '1:1', endRef: '1:7', pagesPerDay: 3 })).statusCode).toBe(400);
    expect((await call('dean', 'PUT', `/admin/programs/${ids.program}/periods`, { periods: [] })).statusCode).toBe(400);
    expect((await call('dean', 'POST', '/admin/programs', { nameAr: 'برنامج', weights: { hifz: 50, tajweed: 25, review: 20, retention: 15 } })).statusCode).toBe(400);
    expect((await call('dean', 'POST', '/admin/programs', { nameAr: 'برنامج', hifzDaysPerWeek: 6 })).statusCode).toBe(400);
  });

  it('changing the required verses or the pace re-draws the schedule', async () => {
    const put = (list: object[]) => call('dean', 'PUT', `/admin/programs/${ids.program}/periods`, { periods: list });
    const long = [{ nameAr: 'طويلة', startRef: '99:1', endRef: '114:6', pagesPerDay: 0.5 }, { nameAr: 'تثبيت', fixedWeeks: 2 }];
    const base = (await put(long)).json();
    const slower = (await put([{ ...long[0], pagesPerDay: 0.25 }, long[1]])).json();
    expect(slower.periods[0].hifzWeeks).toBeGreaterThan(base.periods[0].hifzWeeks);
    expect(slower.totals.weeks).toBeGreaterThan(base.totals.weeks);
    // The pace is in pages, so the same pace over more verses takes longer.
    const more = (await put([{ ...long[0], startRef: '78:1' }, long[1]])).json();
    expect(more.periods[0].pages).toBeGreaterThan(base.periods[0].pages);
    expect(more.totals.weeks).toBeGreaterThan(base.totals.weeks);
    // Four memorization days a week become three: more weeks again.
    await put([{ ...long[0], pagesPerDay: 0.25 }, long[1]]);
    const three = (await call('dean', 'PATCH', `/admin/programs/${ids.program}`, { hifzDaysPerWeek: 3 })).json();
    expect(three.totals.weeks).toBeGreaterThan(slower.totals.weeks);
    await call('dean', 'PATCH', `/admin/programs/${ids.program}`, { hifzDaysPerWeek: 4 });
    await put(periods);
  });

  it('changes the evaluation settings, which must add up', async () => {
    expect((await call('dean', 'PATCH', `/admin/programs/${ids.program}`, { weights: { hifz: 50, tajweed: 30, review: 10, retention: 10 }, passScore: 80 })).json())
      .toMatchObject({ weights: { hifz: 50, tajweed: 30, review: 10, retention: 10 }, passScore: 80 });
    expect((await call('dean', 'PATCH', `/admin/programs/${ids.program}`, { weights: { hifz: 50, tajweed: 30, review: 10, retention: 5 } })).statusCode).toBe(400);
    expect((await call('dean', 'PATCH', `/admin/programs/${ids.program}`, { passScore: 40 })).statusCode).toBe(400);
    expect((await call('dean', 'PATCH', `/admin/programs/${ids.program}`, {})).statusCode).toBe(400);
    await call('dean', 'PATCH', `/admin/programs/${ids.program}`, { weights: { hifz: 40, tajweed: 25, review: 20, retention: 15 }, passScore: 85 });
  });

  it('shows nothing until a halaqa follows the program', async () => {
    for (const who of ['teacher', 'student']) expect((await call(who, 'GET', `/sections/${ids.section}/program`)).json()).toEqual({ program: null });
    for (const who of ['outsider', 'otherTeacher']) expect((await call(who, 'GET', `/sections/${ids.section}/program`)).statusCode).toBe(404);
  });

  it('assigns a halaqa from the Sunday of the chosen week', async () => {
    const res = await call('dean', 'PUT', `/admin/halaqat/${ids.section}/program`, { programId: ids.program, startDate: '2026-01-07' }); // a Wednesday
    expect(res.json()).toEqual({ id: ids.section, programId: ids.program, startDate: '2026-01-04' });
    expect((await call('dean', 'PUT', `/admin/halaqat/${ids.section}/program`, { programId: randomUUID() })).statusCode).toBe(400);
    expect((await call('teacher', 'PUT', `/admin/halaqat/${ids.section}/program`, { programId: ids.program })).statusCode).toBe(403);
    expect((await call('otherDean', 'PUT', `/admin/halaqat/${ids.section}/program`, { programId: ids.program })).statusCode).toBe(404);
    const listed = (await call('dean', 'GET', '/admin/programs')).json();
    expect(listed.halaqat.find((h: { id: string }) => h.id === ids.section)).toMatchObject({ programId: ids.program, startDate: '2026-01-04', weekStart: '2026-01-04' });
    expect(listed.programs[0].inUse).toBe(true);
  });

  it('refuses a program with no periods, an archived one, and deleting one in use', async () => {
    const empty = (await call('dean', 'POST', '/admin/programs', { nameAr: 'فارغ' })).json();
    expect((await call('dean', 'PUT', `/admin/halaqat/${ids.other}/program`, { programId: empty.id })).statusCode).toBe(400);
    await call('dean', 'PATCH', `/admin/programs/${empty.id}`, { active: false });
    expect((await call('dean', 'PUT', `/admin/halaqat/${ids.other}/program`, { programId: empty.id })).statusCode).toBe(400);
    expect((await call('dean', 'DELETE', `/admin/programs/${ids.program}`)).statusCode).toBe(409);
    expect((await call('dean', 'DELETE', `/admin/programs/${empty.id}`)).statusCode).toBe(204);
  });

  it('tells the halaqa what is required now', async () => {
    await call('dean', 'PUT', `/admin/halaqat/${ids.section}/program`, { programId: ids.program, startDate: localDate() });
    for (const who of ['teacher', 'student', 'dean']) {
      const res = await call(who, 'GET', `/sections/${ids.section}/program`);
      expect(res.statusCode).toBe(200);
      const now = res.json();
      expect(now).toMatchObject({
        status: 'running', week: 1, periodNumber: 1, periodCount: 3, phase: 'hifz', weekInPeriod: 1,
        program: { nameAr: 'برنامج الحفظ', passScore: 85, weights: { hifz: 40, tajweed: 25, review: 20, retention: 15 } },
        period: { nameAr: 'التأسيس', goalAr: 'عادة يومية', startRef: '112:1', endRef: '114:6', ayat: 15, pagesPerDay: 0.5, pagesPerWeek: 2 },
        next: { nameAr: 'التوسع', startRef: '100:1', endRef: '111:5' },
        canApply: who !== 'student',
      });
      expect(now.startsOn <= localDate() && localDate() <= now.endsOn).toBe(true);
    }
  });

  it('puts the required verses in every student’s plan as new memorization, once', async () => {
    expect((await call('student', 'POST', `/sections/${ids.section}/program/apply`)).statusCode).toBe(404);
    expect((await call('otherTeacher', 'POST', `/sections/${ids.section}/program/apply`)).statusCode).toBe(404);
    const res = await call('teacher', 'POST', `/sections/${ids.section}/program/apply`);
    expect(res.json()).toEqual({ ayat: 15, students: 2, added: 30 });
    const cards = await getDb().select().from(studentCards).where(and(eq(studentCards.studentId, ids.student), eq(studentCards.state, 'new')));
    expect(cards.map((c) => c.ayahRef).sort()).toContain('112:1');
    expect(cards).toHaveLength(15);
    expect((await call('teacher', 'POST', `/sections/${ids.section}/program/apply`)).json()).toMatchObject({ ayat: 15, added: 0 });
  });

  it('does not apply when no new memorization is due', async () => {
    expect((await call('otherTeacher', 'POST', `/sections/${ids.other}/program/apply`)).statusCode).toBe(409); // follows no program
    const future = localDateAfter(localDate(), 21);
    await call('dean', 'PUT', `/admin/halaqat/${ids.section}/program`, { programId: ids.program, startDate: future });
    expect((await call('student', 'GET', `/sections/${ids.section}/program`)).json()).toMatchObject({ status: 'not_started', week: 0, canApply: false });
    expect((await call('teacher', 'POST', `/sections/${ids.section}/program/apply`)).statusCode).toBe(409);
    await call('dean', 'PUT', `/admin/halaqat/${ids.section}/program`, { programId: ids.program, startDate: '2020-01-05' });
    expect((await call('student', 'GET', `/sections/${ids.section}/program`)).json()).toMatchObject({ status: 'finished', canApply: false });
  });

  it('lets a halaqa stop following a program, and then the program can go', async () => {
    expect((await call('dean', 'PUT', `/admin/halaqat/${ids.section}/program`, { programId: null })).json()).toEqual({ id: ids.section, programId: null, startDate: null });
    expect((await call('student', 'GET', `/sections/${ids.section}/program`)).json()).toEqual({ program: null });
    expect((await call('dean', 'DELETE', `/admin/programs/${ids.program}`)).statusCode).toBe(204);
  });
});
