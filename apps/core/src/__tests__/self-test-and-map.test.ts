/**
 * The random self-test over memorized verses, and the per-sura map of where a student stands.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../server';
import { closeDb, getDb } from '../db';
import { guardianLinks, reviewLogs, sectionEnrollments, sections, studentCards, tenants, users } from '../db/schema';
import { generateToken } from '../lib/jwt';

describe.skipIf(!process.env.DATABASE_URL)('self-test and memorization map', () => {
  let app: FastifyInstance;
  const tag = randomUUID().slice(0, 8);
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const get = (who: string, url: string) => app.inject({ method: 'GET', url: `/v1${url}`, headers: { authorization: `Bearer ${tokens[who]}` } });

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const db = getDb();
    const [tenant] = await db.insert(tenants).values({ slug: `st-${tag}`, nameAr: 'معهد' }).returning();
    const [asma] = await db.insert(users).values({ tenantId: tenant.id, role: 'student', displayNameAr: 'أسماء' }).returning();
    const [other] = await db.insert(users).values({ tenantId: tenant.id, role: 'student', displayNameAr: 'أخرى' }).returning();
    const past = new Date(Date.now() - 86_400_000);
    const future = new Date(Date.now() + 5 * 86_400_000);
    await db.insert(studentCards).values([
      // Sura 67: two memorized (one due), one mastered, one new, one still learning.
      { studentId: asma.id, ayahRef: '67:1', state: 'review', stability: 5, reps: 3, dueAt: past },
      { studentId: asma.id, ayahRef: '67:2', state: 'review', stability: 5, reps: 3, dueAt: future },
      { studentId: asma.id, ayahRef: '67:3', state: 'mastered', stability: 90, reps: 9, dueAt: future },
      { studentId: asma.id, ayahRef: '67:4', state: 'new' },
      { studentId: asma.id, ayahRef: '67:5', state: 'learning', reps: 1, dueAt: past },
      // Sura 78: one memorized.
      { studentId: asma.id, ayahRef: '78:1', state: 'mastered', stability: 60, reps: 7, dueAt: future },
      // Someone else's card must never show up.
      { studentId: other.id, ayahRef: '67:9', state: 'review', stability: 5, reps: 3, dueAt: past },
    ]);
    // A guardian of Asma, a guardian of nobody, and a teacher with Asma in her halaqa and one without.
    const mk = async (role: typeof users.$inferInsert['role'], name: string) =>
      (await db.insert(users).values({ tenantId: tenant.id, role, displayNameAr: name }).returning())[0];
    const mother = await mk('mahram', 'أم أسماء');
    const stranger = await mk('mahram', 'ولي أمر آخر');
    const teacher = await mk('lecturer', 'المعلمة');
    const otherTeacher = await mk('lecturer', 'معلمة أخرى');
    await db.insert(guardianLinks).values({ studentId: asma.id, guardianId: mother.id });
    const [halaqa] = await db.insert(sections).values({ tenantId: tenant.id, nameAr: 'حلقة', joinCode: `M${tag.toUpperCase().slice(0, 6)}`, teacherId: teacher.id }).returning();
    await db.insert(sectionEnrollments).values({ sectionId: halaqa.id, studentId: asma.id });
    Object.assign(ids, { asma: asma.id, other: other.id });
    const tok = (u: { id: string; role: string; tenantId: string | null }) => generateToken({ sub: u.id, role: u.role, facultyId: u.tenantId! });
    Object.assign(tokens, { asma: tok(asma), other: tok(other), mother: tok(mother), stranger: tok(stranger), teacher: tok(teacher), otherTeacher: tok(otherTeacher) });
  });

  afterAll(async () => {
    await app?.close();
    await closeDb();
  });

  it('tests her on memorized verses only, from her own cards', async () => {
    const res = await get('asma', '/scheduler/test?count=30');
    expect(res.statusCode).toBe(200);
    const refs = res.json().items.map((i: { card: { ayahRef: string } }) => i.card.ayahRef).sort();
    expect(refs).toEqual(['67:1', '67:2', '67:3', '78:1']); // not new, not still learning, not hers or his
    expect(res.json().items.every((i: { reason: string }) => i.reason === 'test')).toBe(true);
  });

  it('can be limited to one sura and to a number of verses, and picks at random', async () => {
    const one = (await get('asma', '/scheduler/test?sura=78')).json().items;
    expect(one.map((i: { card: { ayahRef: string } }) => i.card.ayahRef)).toEqual(['78:1']);
    expect((await get('asma', '/scheduler/test?sura=67&count=2')).json().items).toHaveLength(2);
    // Over many tries both memorized verses of a pair come up first at least once: the order is not fixed.
    const firsts = new Set<string>();
    for (let i = 0; i < 25; i++) firsts.add((await get('asma', '/scheduler/test?sura=67&count=1')).json().items[0].card.ayahRef);
    expect(firsts.size).toBeGreaterThan(1);
  });

  it('refuses a sura that does not exist and a silly count', async () => {
    expect((await get('asma', '/scheduler/test?sura=115')).statusCode).toBe(400);
    expect((await get('asma', '/scheduler/test?count=500')).statusCode).toBe(400);
    expect((await get('asma', '/scheduler/test?count=0')).statusCode).toBe(400);
  });

  it('shows, sura by sura, how much is planned, memorized, solid and due', async () => {
    const res = await get('asma', '/scheduler/map');
    expect(res.statusCode).toBe(200);
    const bySura = Object.fromEntries(res.json().surahs.map((s: { sura: number }) => [s.sura, s]));
    expect(bySura[67]).toMatchObject({ total: 5, memorized: 3, mastered: 1 });
    expect(bySura[67].due).toBeGreaterThanOrEqual(2); // 67:1 (review) and 67:5 (learning) are past due
    expect(bySura[78]).toMatchObject({ total: 1, memorized: 1 });
    expect(Object.keys(bySura).map(Number)).toEqual([67, 78]); // in mushaf order, only suras in her plan
    expect((await get('other', '/scheduler/map')).json().surahs).toEqual([{ sura: 67, total: 1, memorized: 1, mastered: 0, due: 1 }]);
  });

  it('answers through the usual rating, which moves the card’s schedule', async () => {
    const [card] = (await get('asma', '/scheduler/test?sura=78')).json().items;
    const rate = await app.inject({
      method: 'POST', url: '/v1/scheduler/rate', headers: { authorization: `Bearer ${tokens.asma}` },
      payload: { cardId: card.card.id, rating: 'again' },
    });
    expect(rate.statusCode).toBe(200);
    const logs = await getDb().select().from(reviewLogs).where(eq(reviewLogs.cardId, card.card.id));
    expect(logs).toHaveLength(1);
    // Forgotten in the test, so it no longer counts as memorized on the map.
    expect((await get('asma', '/scheduler/map')).json().surahs.find((x: { sura: number }) => x.sura === 78)).toMatchObject({ memorized: 0 });
  });

  it('shows the same map to her guardian and her teacher, and to nobody else', async () => {
    const own = (await get('asma', '/scheduler/map')).json();
    for (const who of ['asma', 'mother', 'teacher']) {
      const res = await get(who, `/reports/student/${ids.asma}/map`);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(own);
    }
    for (const who of ['stranger', 'otherTeacher', 'other']) {
      expect((await get(who, `/reports/student/${ids.asma}/map`)).statusCode).toBe(404);
    }
    expect((await app.inject({ method: 'GET', url: `/v1/reports/student/${ids.asma}/map` })).statusCode).toBe(401);
  });

  it('needs a signed-in student', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/scheduler/test' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/scheduler/map' })).statusCode).toBe(401);
  });
});
