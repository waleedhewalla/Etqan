import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../server';
import { closeDb, getDb } from '../db';
import { attendance, reviewLogs, sectionEnrollments, sections, studentCards, tenants, users } from '../db/schema';
import { generateToken } from '../lib/jwt';
import { riskLevel, riskReasons } from '../lib/risk';
import { addDays, localDate } from '../lib/dates';

describe('risk rules', () => {
  it('flags three days of silence, never having started, and low attendance', () => {
    expect(riskReasons({ inactiveDays: 2, attendanceRate: 0.9 })).toEqual([]);
    expect(riskReasons({ inactiveDays: 3, attendanceRate: null })).toEqual(['inactive']);
    expect(riskReasons({ inactiveDays: null, attendanceRate: null })).toEqual(['inactive']);
    expect(riskReasons({ inactiveDays: 0, attendanceRate: 0.69 })).toEqual(['attendance']);
    expect(riskReasons({ inactiveDays: 0, attendanceRate: 0.7 })).toEqual([]);
  });

  it('calls it high with both signs, two weeks away, or never started; otherwise medium', () => {
    expect(riskLevel({ inactiveDays: 1, attendanceRate: 1 })).toBe('none');
    expect(riskLevel({ inactiveDays: 5, attendanceRate: null })).toBe('medium');
    expect(riskLevel({ inactiveDays: 0, attendanceRate: 0.5 })).toBe('medium');
    expect(riskLevel({ inactiveDays: 5, attendanceRate: 0.5 })).toBe('high');
    expect(riskLevel({ inactiveDays: 14, attendanceRate: null })).toBe('high');
    expect(riskLevel({ inactiveDays: null, attendanceRate: null })).toBe('high');
  });
});

describe.skipIf(!process.env.DATABASE_URL)('admin overview', () => {
  let app: FastifyInstance;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const tag = randomUUID().slice(0, 8);
  const auth = (who: string) => ({ authorization: `Bearer ${tokens[who]}` });
  const get = (url: string, who: string) => app.inject({ method: 'GET', url, headers: auth(who) });
  const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const db = getDb();
    const [a] = await db.insert(tenants).values({ slug: `adm-a-${tag}`, nameAr: 'معهد أ', planTier: 'madrasa_pro', planMaxStudents: 80 }).returning();
    const [b] = await db.insert(tenants).values({ slug: `adm-b-${tag}`, nameAr: 'معهد ب' }).returning();
    const mk = async (tenantId: string, role: typeof users.$inferInsert['role'], name: string) =>
      (await db.insert(users).values({ tenantId, role, displayNameAr: name }).returning())[0];
    const dean = await mk(a.id, 'dean', 'العميدة');
    const deanB = await mk(b.id, 'dean', 'عميدة ب');
    const root = await mk(a.id, 'superadmin', 'المشرفة العامة');
    const teacher = await mk(a.id, 'lecturer', 'معلمة');
    const student = await mk(a.id, 'student', 'طالبة');
    const active = await mk(a.id, 'student', 'نشيطة');
    const away = await mk(a.id, 'student', 'غائبة');          // 5 days
    const never = await mk(a.id, 'student', 'لم تبدأ');        // never reviewed
    const absent = await mk(a.id, 'student', 'متغيّبة');       // active, but poor attendance
    const both = await mk(a.id, 'student', 'غائبة ومتغيّبة'); // 5 days and poor attendance
    const other = await mk(b.id, 'student', 'طالبة معهد ب');

    const mkSection = async (tenantId: string, name: string, n: number) =>
      (await db.insert(sections).values({ tenantId, nameAr: name, joinCode: `D${n}${tag.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)}`, teacherId: teacher.id }).returning())[0];
    const s1 = await mkSection(a.id, 'حلقة ١', 1);
    const s2 = await mkSection(a.id, 'حلقة ٢', 2);
    const sb = await mkSection(b.id, 'حلقة ب', 3);
    const enroll = (sectionId: string, studentId: string) => db.insert(sectionEnrollments).values({ sectionId, studentId });
    for (const s of [active, away, never, absent, both]) await enroll(s1.id, s.id);
    await enroll(s2.id, away.id); // away is in two halaqat
    await enroll(sb.id, other.id);
    // a student who left a halaqat is not counted
    const [left] = [await mk(a.id, 'student', 'غادرت')];
    await db.insert(sectionEnrollments).values({ sectionId: s1.id, studentId: left.id, droppedAt: new Date() });

    const review = async (studentId: string, ref: string, whenDaysAgo: number, state: 'review' | 'new' = 'review') => {
      const [card] = await db.insert(studentCards).values({ studentId, ayahRef: ref, state, stability: 3, reps: 2, dueAt: daysAgo(1) }).returning();
      if (whenDaysAgo >= 0) await db.insert(reviewLogs).values({ cardId: card.id, rating: 'good', wasCorrect: true, reviewedAt: daysAgo(whenDaysAgo) });
    };
    await review(active.id, '1:1', 0);
    await review(away.id, '1:1', 5);
    await review(absent.id, '1:1', 1);
    await review(both.id, '1:1', 5);
    await review(other.id, '1:1', 0);
    await review(never.id, '1:1', -1, 'new');
    // last week's reviews for the trend: 2 more reviews 9 days ago
    const [c] = await db.select().from(studentCards).where(eq(studentCards.studentId, active.id));
    await db.insert(reviewLogs).values([{ cardId: c.id, rating: 'good', wasCorrect: true, reviewedAt: daysAgo(9) }, { cardId: c.id, rating: 'good', wasCorrect: true, reviewedAt: daysAgo(10) }]);

    // attendance over the last days: absent 1/4, both 1/4, active 4/4
    const mark = (studentId: string, present: boolean, d: number) =>
      db.insert(attendance).values({ sectionId: s1.id, studentId, date: addDays(localDate(), -d), present });
    for (const d of [1, 2, 3, 4]) {
      await mark(active.id, true, d);
      await mark(absent.id, d === 1, d);
      await mark(both.id, d === 1, d);
    }
    Object.assign(ids, { a: a.id, b: b.id, absent: absent.id, away: away.id, never: never.id, both: both.id, other: other.id });
    const tok = (u: { id: string; role: string; tenantId: string | null }) => generateToken({ sub: u.id, role: u.role, facultyId: u.tenantId! });
    Object.assign(tokens, { dean: tok(dean), deanB: tok(deanB), root: tok(root), teacher: tok(teacher), student: tok(student) });
  });

  afterAll(async () => {
    await app?.close();
    await closeDb();
  });

  it('is for administrators only', async () => {
    expect((await get('/v1/admin/overview', 'teacher')).statusCode).toBe(403);
    expect((await get('/v1/admin/overview', 'student')).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/v1/admin/overview' })).statusCode).toBe(401);
  });

  it('describes the institution and its plan as stored', async () => {
    const res = await get('/v1/admin/overview', 'dean');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().institution).toMatchObject({ nameAr: 'معهد أ', plan: { tier: 'madrasa_pro', maxStudents: 80 } });
  });

  it('counts students in a halaqa once, and not those who left', async () => {
    const { usage } = (await get('/v1/admin/overview', 'dean')).json();
    expect(usage).toEqual({ students: 5, halaqat: 2 }); // active, away, never, absent, both
  });

  it('measures activity and the weekly trend', async () => {
    const { activity } = (await get('/v1/admin/overview', 'dean')).json();
    expect(activity.reviewsThisWeek).toBe(4);   // active 0d, away 5d, absent 1d, both 5d
    expect(activity.reviewsLastWeek).toBe(2);   // active 9d and 10d
    expect(activity.activeToday).toBe(1);
    expect(activity.activeThisWeek).toBe(4);
  });

  it('lists who needs follow-up with reasons, worst first, and not students who are fine', async () => {
    const { atRisk } = (await get('/v1/admin/overview', 'dean')).json();
    const by = Object.fromEntries(atRisk.students.map((s: { studentId: string }) => [s.studentId, s]));
    expect(Object.keys(by).sort()).toEqual([ids.absent, ids.away, ids.both, ids.never].sort());
    expect(by[ids.never]).toMatchObject({ level: 'high', reasons: ['inactive'], inactiveDays: null });
    expect(by[ids.both]).toMatchObject({ level: 'high', reasons: ['inactive', 'attendance'] });
    expect(by[ids.away]).toMatchObject({ level: 'medium', reasons: ['inactive'], inactiveDays: 5 });
    expect(by[ids.away].halaqat.sort()).toEqual(['حلقة ١', 'حلقة ٢']);
    expect(by[ids.absent]).toMatchObject({ level: 'medium', reasons: ['attendance'] });
    expect(by[ids.absent].attendanceRate).toBeCloseTo(0.25);
    expect(atRisk).toMatchObject({ high: 2, medium: 2, truncated: false });
    // never started first, then both signs, then the rest
    expect(atRisk.students.slice(0, 2).map((s: { studentId: string }) => s.studentId)).toEqual([ids.never, ids.both]);
  });

  it('keeps institutions apart', async () => {
    const b = (await get('/v1/admin/overview', 'deanB')).json();
    expect(b.institution.nameAr).toBe('معهد ب');
    expect(b.usage.students).toBe(1);
    expect(b.atRisk.students).toEqual([]);
    // a dean cannot ask for another institution
    const sneaky = await get(`/v1/admin/overview?tenantId=${ids.b}`, 'dean');
    expect(sneaky.json().institution.id).toBe(ids.a);
  });

  it('lets a superadmin look at any institution, and list them', async () => {
    expect((await get(`/v1/admin/overview?tenantId=${ids.b}`, 'root')).json().institution.id).toBe(ids.b);
    expect((await get(`/v1/admin/overview?tenantId=${randomUUID()}`, 'root')).statusCode).toBe(404);
    const list = await get('/v1/admin/tenants', 'root');
    expect(list.statusCode).toBe(200);
    expect(list.json().map((t: { id: string }) => t.id)).toEqual(expect.arrayContaining([ids.a, ids.b]));
    expect((await get('/v1/admin/tenants', 'dean')).statusCode).toBe(403);
  });
});
