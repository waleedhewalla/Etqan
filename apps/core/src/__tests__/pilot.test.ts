import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../server';
import { closeDb, getDb } from '../db';
import { guardianLinks, reviewLogs, sectionEnrollments, sections, studentCards, tasmiSubmissions, tenants, users } from '../db/schema';
import { generateToken } from '../lib/jwt';
import { buildPilotReport, type PilotInput } from '../lib/pilot';
import { addDays, localDate, startOfLocalDay, weekStart } from '../lib/dates';

describe('buildPilotReport', () => {
  const w1 = '2026-10-03'; // a Saturday
  const w2 = '2026-10-10';
  const at = (day: string, hour = 10) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00Z`);
  const base: PilotInput = {
    weekStarts: [w1, w2], today: '2026-10-12', enrolled: ['a', 'b', 'c'], activity: [], recitations: [], reportOpens: [], guardiansLinked: 2,
  };
  const days = (studentId: string, start: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({ studentId, day: addDays(start, i), reviews: 5 }));

  it('counts active and regular students per week', () => {
    const r = buildPilotReport({ ...base, activity: [...days('a', w1, 4), ...days('b', w1, 3), ...days('a', w2, 1)] });
    expect(r.weeks[0]).toMatchObject({ start: w1, end: '2026-10-09', partial: false, enrolled: 3, active: 2, regular: 1, reviews: 35 });
    expect(r.weeks[1]).toMatchObject({ active: 1, regular: 0, reviews: 5, partial: true });
    expect(r.regularDays).toBe(4);
  });

  it('counts a day once however many reviews it had, and ignores students who are not enrolled', () => {
    const r = buildPilotReport({
      ...base,
      activity: [{ studentId: 'a', day: w1, reviews: 40 }, { studentId: 'gone', day: w1, reviews: 9 }, ...days('gone', w1, 6)],
    });
    expect(r.weeks[0]).toMatchObject({ active: 1, regular: 0, reviews: 40 });
  });

  it('measures how fast recitations are reviewed, by the week they were submitted', () => {
    const r = buildPilotReport({
      ...base,
      recitations: [
        { day: w1, submittedAt: at(w1, 8), reviewedAt: at(w1, 10) },                 // 2 h
        { day: w1, submittedAt: at(w1, 8), reviewedAt: at(addDays(w1, 1), 8) },      // 24 h
        { day: addDays(w1, 6), submittedAt: at(addDays(w1, 6)), reviewedAt: at(w2, 16) }, // 30 h, reviewed the next week
        { day: w1, submittedAt: at(w1), reviewedAt: null },
        { day: w2, submittedAt: at(w2), reviewedAt: null },
      ],
    });
    expect(r.weeks[0].recitations).toEqual({ submitted: 4, reviewed: 3, medianHoursToReview: 24 });
    expect(r.weeks[1].recitations).toEqual({ submitted: 1, reviewed: 0, medianHoursToReview: null });
  });

  it('counts each guardian once per week', () => {
    const r = buildPilotReport({
      ...base,
      reportOpens: [{ guardianId: 'g1', day: w1 }, { guardianId: 'g1', day: addDays(w1, 2) }, { guardianId: 'g2', day: w2 }],
    });
    expect(r.weeks.map((w) => w.guardians)).toEqual([{ linked: 2, opened: 1 }, { linked: 2, opened: 1 }]);
  });

  it('reports who from the first week is still active in the last', () => {
    const r = buildPilotReport({ ...base, activity: [...days('a', w1, 1), ...days('b', w1, 1), ...days('a', w2, 1), ...days('c', w2, 1)] });
    expect(r.retention).toEqual({ cohort: 2, retained: 1, fromWeek: w1, toWeek: w2 });
  });

  it('has no retention figure for a single week, and copes with nothing at all', () => {
    const r = buildPilotReport({ ...base, weekStarts: [w2], enrolled: [] });
    expect(r.retention).toBeNull();
    expect(r.weeks[0]).toMatchObject({ enrolled: 0, active: 0, regular: 0, reviews: 0 });
  });
});

describe.skipIf(!process.env.DATABASE_URL)('GET /v1/admin/pilot', () => {
  let app: FastifyInstance;
  const tag = randomUUID().slice(0, 8);
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const auth = (who: string) => ({ authorization: `Bearer ${tokens[who]}` });
  const thisWeek = weekStart(localDate());
  const lastWeek = addDays(thisWeek, -7);
  /** Noon local time on a given day, so the day never slips across midnight. */
  const noon = (day: string) => new Date(startOfLocalDay(day).getTime() + 12 * 3_600_000);

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const db = getDb();
    const [tenant] = await db.insert(tenants).values({ slug: `pil-${tag}`, nameAr: 'معهد' }).returning();
    const [other] = await db.insert(tenants).values({ slug: `pil-o-${tag}`, nameAr: 'آخر' }).returning();
    const mk = async (tenantId: string, role: typeof users.$inferInsert['role'], name: string) =>
      (await db.insert(users).values({ tenantId, role, displayNameAr: name }).returning())[0];
    const dean = await mk(tenant.id, 'dean', 'عميدة');
    const otherDean = await mk(other.id, 'dean', 'عميدة أخرى');
    const teacher = await mk(tenant.id, 'lecturer', 'معلمة');
    const steady = await mk(tenant.id, 'student', 'منتظمة');
    const once = await mk(tenant.id, 'student', 'مرة واحدة');
    const guardian = await mk(tenant.id, 'mahram', 'ولي أمر');
    const [section] = await db.insert(sections).values({ tenantId: tenant.id, nameAr: 'حلقة', joinCode: `L${tag.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7)}`, teacherId: teacher.id }).returning();
    await db.insert(sectionEnrollments).values([{ sectionId: section.id, studentId: steady.id }, { sectionId: section.id, studentId: once.id }]);
    await db.insert(guardianLinks).values({ studentId: steady.id, guardianId: guardian.id });

    const card = async (studentId: string) => (await db.insert(studentCards).values({ studentId, ayahRef: '1:1', state: 'review', stability: 3, reps: 2 }).returning())[0];
    const sc = await card(steady.id);
    const oc = await card(once.id);
    const log = (cardId: string, day: string) => ({ cardId, rating: 'good' as const, wasCorrect: true, reviewedAt: noon(day) });
    await db.insert(reviewLogs).values([
      ...[0, 1, 2, 3].map((d) => log(sc.id, addDays(lastWeek, d))),  // regular last week
      log(sc.id, addDays(lastWeek, 0)),                               // a second review the same day
      log(oc.id, addDays(lastWeek, 1)),                               // active once last week
      log(sc.id, thisWeek),                                           // steady is back this week
    ]);
    await db.insert(tasmiSubmissions).values([
      { studentId: steady.id, sectionId: section.id, startRef: '1:1', endRef: '1:2', submittedAt: noon(lastWeek), reviewedAt: new Date(noon(lastWeek).getTime() + 6 * 3_600_000), reviewVerdict: 'approved' },
      { studentId: once.id, sectionId: section.id, startRef: '1:1', endRef: '1:2', submittedAt: noon(addDays(lastWeek, 1)) },
    ]);
    Object.assign(ids, { steady: steady.id });
    const tok = (u: { id: string; role: string; tenantId: string | null }) => generateToken({ sub: u.id, role: u.role, facultyId: u.tenantId! });
    Object.assign(tokens, { dean: tok(dean), otherDean: tok(otherDean), teacher: tok(teacher), guardian: tok(guardian) });
  });

  afterAll(async () => {
    await app?.close();
    await closeDb();
  });

  const pilot = (who: string, q = '') => app.inject({ method: 'GET', url: `/v1/admin/pilot${q}`, headers: auth(who) });

  it('is for administrators, and validates the number of weeks', async () => {
    expect((await pilot('teacher')).statusCode).toBe(403);
    expect((await pilot('dean', '?weeks=0')).statusCode).toBe(400);
    expect((await pilot('dean', '?weeks=13')).statusCode).toBe(400);
    expect((await pilot('dean')).json().weeks).toHaveLength(4);
  });

  it('reports last week and this week from real activity', async () => {
    const r = (await pilot('dean', '?weeks=2')).json();
    expect(r.weeks.map((w: { start: string }) => w.start)).toEqual([lastWeek, thisWeek]);
    expect(r.weeks[0]).toMatchObject({ partial: false, enrolled: 2, active: 2, regular: 1, reviews: 6 });
    expect(r.weeks[0].recitations).toEqual({ submitted: 2, reviewed: 1, medianHoursToReview: 6 });
    expect(r.weeks[1]).toMatchObject({ partial: true, active: 1, regular: 0, reviews: 1 });
    expect(r.retention).toMatchObject({ cohort: 2, retained: 1 });
  });

  it('counts a guardian opening the weekly report, once', async () => {
    expect((await pilot('dean', '?weeks=1')).json().weeks[0].guardians).toEqual({ linked: 1, opened: 0 });
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({ method: 'GET', url: `/v1/reports/student/${ids.steady}/weekly`, headers: auth('guardian') });
      expect(res.statusCode).toBe(200);
    }
    // a teacher reading the same report is not a guardian open
    await app.inject({ method: 'GET', url: `/v1/reports/student/${ids.steady}/weekly`, headers: auth('teacher') });
    expect((await pilot('dean', '?weeks=1')).json().weeks[0].guardians).toEqual({ linked: 1, opened: 1 });
  });

  it('shows another institution nothing of this one', async () => {
    const r = (await pilot('otherDean', '?weeks=2')).json();
    expect(r.weeks.every((w: { enrolled: number; reviews: number }) => w.enrolled === 0 && w.reviews === 0)).toBe(true);
  });
});
