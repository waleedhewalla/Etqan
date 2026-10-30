import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { buildApp } from '../server';
import { closeDb, getDb } from '../db';
import { notifications, sectionEnrollments, sections, streaks, studentBadges, studentCards, tasmiSubmissions, tenants, users } from '../db/schema';
import { generateToken } from '../lib/jwt';
import { BADGE_CATALOG, awardBadges, isEarned, progressFor, type Metrics } from '../lib/badges';
import { addDays, localDate } from '../lib/dates';

const metrics = (over: Partial<Metrics> = {}): Metrics => ({ longestStreak: 0, reviews: 0, masteredCards: 0, approvedTasmi: 0, masteredBySura: {}, ...over });
const byId = (id: string) => BADGE_CATALOG.find((b) => b.id === id)!;

describe('badge catalog', () => {
  it('has unique ids and sensible targets', () => {
    const ids = BADGE_CATALOG.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(BADGE_CATALOG.every((b) => b.conditionValue > 0 && b.nameAr && b.descriptionAr)).toBe(true);
  });

  it('measures progress and caps it at the target', () => {
    expect(progressFor(byId('streak-7'), metrics({ longestStreak: 4 }))).toEqual({ current: 4, target: 7 });
    expect(progressFor(byId('streak-7'), metrics({ longestStreak: 40 }))).toEqual({ current: 7, target: 7 });
    expect(isEarned(byId('reviews-100'), metrics({ reviews: 99 }))).toBe(false);
    expect(isEarned(byId('reviews-100'), metrics({ reviews: 100 }))).toBe(true);
  });

  it('needs every ayah of a sura for a sura badge', () => {
    expect(isEarned(byId('surah-112'), metrics({ masteredBySura: { 112: 3 } }))).toBe(false);
    expect(isEarned(byId('surah-112'), metrics({ masteredBySura: { 112: 4 } }))).toBe(true);
    expect(isEarned(byId('surah-1'), metrics({ masteredBySura: { 112: 4 } }))).toBe(false);
  });
});

describe.skipIf(!process.env.DATABASE_URL)('awarding badges', () => {
  let app: FastifyInstance;
  const tag = randomUUID().slice(0, 8);
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const auth = (who: string) => ({ authorization: `Bearer ${tokens[who]}` });
  const mine = async (who: string) => (await app.inject({ method: 'GET', url: '/v1/badges', headers: auth(who) })).json() as
    { id: string; earned: boolean; progress: { current: number; target: number }; ready: boolean }[];

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const db = getDb();
    const [tenant] = await db.insert(tenants).values({ slug: `bdg-${tag}`, nameAr: 'معهد' }).returning();
    const mk = async (role: typeof users.$inferInsert['role'], name: string) =>
      (await db.insert(users).values({ tenantId: tenant.id, role, displayNameAr: name }).returning())[0];
    const teacher = await mk('lecturer', 'المعلمة');
    const a = await mk('student', 'أ');
    const b = await mk('student', 'ب');
    const [section] = await db.insert(sections).values({
      tenantId: tenant.id, nameAr: 'حلقة', joinCode: `G${tag.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7)}`, teacherId: teacher.id,
    }).returning();
    await db.insert(sectionEnrollments).values({ sectionId: section.id, studentId: a.id });

    // Student A is one day short of a 3-day streak and has one card to rate.
    await db.insert(streaks).values({ studentId: a.id, currentStreak: 2, longestStreak: 2, freezesRemaining: 2, lastActiveDate: addDays(localDate(), -1) });
    const [card] = await db.insert(studentCards).values({
      studentId: a.id, ayahRef: '112:1', state: 'review', stability: 3, reps: 2, dueAt: new Date(Date.now() - 3_600_000),
      lastReviewedAt: new Date(Date.now() - 3 * 86_400_000),
    }).returning();
    Object.assign(ids, { tenant: tenant.id, teacher: teacher.id, a: a.id, b: b.id, section: section.id, card: card.id });
    const tok = (u: { id: string; role: string }) => generateToken({ sub: u.id, role: u.role, facultyId: tenant.id });
    Object.assign(tokens, { a: tok(a), b: tok(b), teacher: tok(teacher) });
  });

  afterAll(async () => {
    await app?.close();
    await closeDb();
  });

  it('lists the catalog with progress for a new student', async () => {
    const list = await mine('b');
    expect(list).toHaveLength(BADGE_CATALOG.length);
    expect(list.every((x) => !x.earned && x.progress.current === 0)).toBe(true);
  });

  it('requires sign-in', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/badges' })).statusCode).toBe(401);
  });

  it('awards a streak badge when a rating completes the streak, and tells her', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/scheduler/rate', headers: auth('a'), payload: { cardId: ids.card, rating: 'good' } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().streak.currentStreak).toBe(3);
    expect(res.json().newBadges.map((x: { id: string }) => x.id)).toEqual(['streak-3']);

    const list = await mine('a');
    expect(list.find((x) => x.id === 'streak-3')).toMatchObject({ earned: true });
    expect(list.find((x) => x.id === 'streak-7')).toMatchObject({ earned: false, progress: { current: 3, target: 7 } });

    const notes = await getDb().select().from(notifications).where(and(eq(notifications.userId, ids.a), eq(notifications.titleAr, 'وسام جديد')));
    expect(notes).toHaveLength(1);
  });

  it('does not award the same badge twice', async () => {
    expect(await awardBadges(getDb(), ids.a)).toEqual([]);
    const rows = await getDb().select().from(studentBadges).where(and(eq(studentBadges.studentId, ids.a), eq(studentBadges.badgeId, 'streak-3')));
    expect(rows).toHaveLength(1);
  });

  it('awards a sura badge when every ayah is mastered, and a recitation badge on approval', async () => {
    const db = getDb();
    await db.delete(studentCards).where(eq(studentCards.studentId, ids.b));
    await db.insert(studentCards).values(['112:1', '112:2', '112:3', '112:4'].map((ayahRef) => ({
      studentId: ids.b, ayahRef, state: 'mastered' as const, stability: 60, reps: 8,
      lastReviewedAt: new Date(Date.now() - 5 * 86_400_000), dueAt: new Date(Date.now() + 20 * 86_400_000),
    })));
    expect((await awardBadges(db, ids.b)).map((x) => x.id)).toContain('surah-112');

    await db.insert(sectionEnrollments).values({ sectionId: ids.section, studentId: ids.b });
    const [t] = await db.insert(tasmiSubmissions).values({ studentId: ids.b, sectionId: ids.section, startRef: '112:1', endRef: '112:4' }).returning();
    const res = await app.inject({
      method: 'POST', url: `/v1/tasmi/${t.id}/review`, headers: auth('teacher'),
      payload: { hifzScore: 90, tajweedScore: 90, fluencyScore: 90, verdict: 'approved' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((await mine('b')).find((x) => x.id === 'tasmi-1')).toMatchObject({ earned: true });
  });

  it('keeps an earned badge even if progress later drops', async () => {
    await getDb().update(studentCards).set({ state: 'review' }).where(eq(studentCards.studentId, ids.b));
    expect((await mine('b')).find((x) => x.id === 'surah-112')).toMatchObject({ earned: true, progress: { current: 4, target: 4 } });
  });
});
