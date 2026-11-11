import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { buildApp } from '../server';
import { closeDb, getDb } from '../db';
import { sectionEnrollments, sections, studentCards, tenants, users } from '../db/schema';
import { generateToken } from '../lib/jwt';
import { MAX_PLAN_AYAT, planAyat, PlanRangeError } from '../lib/hifz-plan';

describe('planAyat', () => {
  it('lists a range, across suras too', () => {
    expect(planAyat('1:6', '2:2')).toEqual(['1:6', '1:7', '2:1', '2:2']);
    expect(planAyat('112:1', '114:6')).toHaveLength(4 + 5 + 6);
  });

  it('rejects references that do not exist, reversed ranges and oversized ranges', () => {
    expect(() => planAyat('1:8', '1:9')).toThrow(PlanRangeError);
    expect(() => planAyat('115:1', '115:2')).toThrow(PlanRangeError);
    expect(() => planAyat('2:5', '2:1')).toThrow(PlanRangeError);
    expect(() => planAyat('2:1', '2:286')).not.toThrow();
    expect(() => planAyat('2:1', `3:${MAX_PLAN_AYAT}`)).toThrow(PlanRangeError);
  });
});

describe.skipIf(!process.env.DATABASE_URL)('memorization plan', () => {
  let app: FastifyInstance;
  const tag = randomUUID().slice(0, 8);
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const auth = (who: string) => ({ authorization: `Bearer ${tokens[who]}` });
  const url = (student = 'student', section = 'section') => `/v1/sections/${ids[section]}/students/${ids[student]}/plan`;
  const add = (who: string, payload: object, student = 'student') =>
    app.inject({ method: 'POST', url: url(student), headers: auth(who), payload });
  const cardsOf = (studentId: string) => getDb().select().from(studentCards).where(eq(studentCards.studentId, studentId));

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const db = getDb();
    const [tenant] = await db.insert(tenants).values({ slug: `hp-${tag}`, nameAr: 'معهد' }).returning();
    const mk = async (role: typeof users.$inferInsert['role'], name: string) =>
      (await db.insert(users).values({ tenantId: tenant.id, role, displayNameAr: name }).returning())[0];
    const teacher = await mk('lecturer', 'معلمة');
    const otherTeacher = await mk('lecturer', 'معلمة أخرى');
    const student = await mk('student', 'طالبة');
    const outsider = await mk('student', 'ليست في الحلقة');
    const code = (p: string) => `${p}${tag.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)}`;
    const [section] = await db.insert(sections).values({ tenantId: tenant.id, nameAr: 'حلقة', joinCode: code('H'), teacherId: teacher.id }).returning();
    await db.insert(sectionEnrollments).values({ sectionId: section.id, studentId: student.id });
    Object.assign(ids, { section: section.id, student: student.id, outsider: outsider.id });
    const tok = (u: { id: string; role: string; tenantId: string | null }) => generateToken({ sub: u.id, role: u.role, facultyId: u.tenantId! });
    Object.assign(tokens, { teacher: tok(teacher), otherTeacher: tok(otherTeacher), student: tok(student) });
  });

  afterAll(async () => {
    await app?.close();
    await closeDb();
  });

  it('starts empty, and a new student has nothing to revise', async () => {
    const plan = await app.inject({ method: 'GET', url: url(), headers: auth('teacher') });
    expect(plan.json()).toEqual({ total: 0, memorized: 0, new: 0, ranges: [] });
    const queue = await app.inject({ method: 'GET', url: '/v1/scheduler/queue', headers: auth('student') });
    expect(queue.json().totalItems).toBe(0);
  });

  it('is only for whoever manages the halaqa, and only for its students', async () => {
    const body = { startRef: '1:1', endRef: '1:7', status: 'memorized' };
    expect((await add('otherTeacher', body)).statusCode).toBe(404);
    expect((await add('student', body)).statusCode).toBe(404);
    expect((await add('teacher', body, 'outsider')).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: url(), headers: auth('student') })).statusCode).toBe(404);
    expect(await cardsOf(ids.student)).toHaveLength(0);
  });

  it('rejects a bad range', async () => {
    expect((await add('teacher', { startRef: '1:9', endRef: '1:10', status: 'new' })).statusCode).toBe(400);
    expect((await add('teacher', { startRef: '2:5', endRef: '2:1', status: 'new' })).statusCode).toBe(400);
    expect((await add('teacher', { startRef: '2:1', endRef: '4:1', status: 'new' })).statusCode).toBe(400);
    expect((await add('teacher', { startRef: 'x', endRef: '1:1', status: 'new' })).statusCode).toBe(400);
    expect((await add('teacher', { startRef: '1:1', endRef: '1:2', status: 'done' })).statusCode).toBe(400);
  });

  it('puts memorized ayat into revision, spread over days, ready to be rated', async () => {
    const res = await add('teacher', { startRef: '78:1', endRef: '78:40', status: 'memorized', perDay: 15 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ added: 40, skipped: 0, plan: { total: 40, memorized: 40, new: 0 } });
    expect(res.json().plan.ranges).toEqual([{ startRef: '78:1', endRef: '78:40', count: 40, status: 'memorized' }]);

    const cards = await cardsOf(ids.student);
    expect(cards.every((c) => c.state === 'review' && c.stability > 0 && c.reps === 0 && c.dueAt)).toBe(true);
    const now = Date.now();
    const dueToday = cards.filter((c) => c.dueAt!.getTime() <= now);
    expect(dueToday).toHaveLength(15);
    expect(Math.max(...cards.map((c) => c.dueAt!.getTime())) - now).toBeGreaterThan(1.9 * 86_400_000);

    const queue = (await app.inject({ method: 'GET', url: '/v1/scheduler/queue', headers: auth('student') })).json();
    expect(queue.totalItems).toBe(15);
    expect(queue.queue.sabqi.count).toBe(15);
    const first = queue.queue.sabqi.items[0].card;
    const rated = await app.inject({
      method: 'POST', url: '/v1/scheduler/rate', headers: auth('student'),
      payload: { cardId: first.id, rating: 'good', timeTakenMs: 4000 },
    });
    expect(rated.statusCode).toBe(200);
    const [after] = await getDb().select().from(studentCards).where(eq(studentCards.id, first.id));
    expect(after.reps).toBe(1);
    expect(after.dueAt!.getTime()).toBeGreaterThan(now);
  });

  it('queues new ayat for memorization and leaves existing cards alone', async () => {
    const res = await add('teacher', { startRef: '78:38', endRef: '79:5', status: 'new' });
    expect(res.json()).toMatchObject({ added: 5, skipped: 3, plan: { total: 45, memorized: 40, new: 5 } });
    expect(res.json().plan.ranges).toEqual([
      { startRef: '78:1', endRef: '78:40', count: 40, status: 'memorized' },
      { startRef: '79:1', endRef: '79:5', count: 5, status: 'new' },
    ]);
    const fresh = (await cardsOf(ids.student)).filter((c) => c.ayahRef.startsWith('79:'));
    expect(fresh.every((c) => c.state === 'new' && c.dueAt === null)).toBe(true);

    const queue = (await app.inject({ method: 'GET', url: '/v1/scheduler/queue', headers: auth('student') })).json();
    expect(queue.queue.sabaq.count).toBe(5);

    const again = await add('teacher', { startRef: '79:1', endRef: '79:5', status: 'memorized' });
    expect(again.json()).toMatchObject({ added: 0, skipped: 5 });
  });

  it('shows separate runs when the ayat are not adjacent', async () => {
    await add('teacher', { startRef: '112:1', endRef: '112:4', status: 'memorized' });
    const plan = (await app.inject({ method: 'GET', url: url(), headers: auth('teacher') })).json();
    expect(plan.ranges.map((r: { startRef: string; endRef: string }) => `${r.startRef}-${r.endRef}`))
      .toEqual(['78:1-78:40', '79:1-79:5', '112:1-112:4']);
  });

  it('removes only cards that were never reviewed', async () => {
    const del = (payload: object, who = 'teacher') => app.inject({ method: 'DELETE', url: url(), headers: auth(who), payload });
    expect((await del({ startRef: '78:1', endRef: '78:40' }, 'otherTeacher')).statusCode).toBe(404);
    const res = await del({ startRef: '78:1', endRef: '78:40' });
    expect(res.json()).toMatchObject({ removed: 39, kept: 1, plan: { total: 10 } });
    const left = await getDb().select().from(studentCards)
      .where(and(eq(studentCards.studentId, ids.student), eq(studentCards.reps, 1)));
    expect(left).toHaveLength(1);
    expect((await del({ startRef: '79:1', endRef: '79:5' })).json()).toMatchObject({ removed: 5, kept: 0 });
  });
});
