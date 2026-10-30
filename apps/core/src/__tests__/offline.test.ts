/** Reviews done offline and sent later: applied as of when they happened, once only, oldest first. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { buildApp } from '../server';
import { closeDb, getDb } from '../db';
import { reviewLogs, streaks, studentCards, tenants, users } from '../db/schema';
import { generateToken } from '../lib/jwt';
import { addDays, localDate } from '../lib/dates';

const hasDb = Boolean(process.env.DATABASE_URL);
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
const iso = (d: Date) => d.toISOString();

describe.skipIf(!hasDb)('rate-batch (offline reviews)', () => {
  let app: FastifyInstance;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const tag = randomUUID().slice(0, 8);
  const auth = (who: string) => ({ authorization: `Bearer ${tokens[who]}` });
  const cards: Record<string, string> = {};

  const send = (who: string, reviews: object[]) =>
    app.inject({ method: 'POST', url: '/v1/scheduler/rate-batch', headers: auth(who), payload: { reviews } });
  const review = (cardId: string, at: Date, over: object = {}) =>
    ({ clientId: `c-${randomUUID()}`, cardId, rating: 'good', reviewedAt: iso(at), ...over });
  const cardRow = async (id: string) => (await getDb().select().from(studentCards).where(eq(studentCards.id, id)))[0];

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const db = getDb();
    const [tenant] = await db.insert(tenants).values({ slug: `off-${tag}`, nameAr: 'معهد' }).returning();
    const mk = async (name: string) => (await db.insert(users).values({ tenantId: tenant.id, role: 'student', displayNameAr: name }).returning())[0];
    const a = await mk('أ');
    const b = await mk('ب');
    const mkCard = async (studentId: string, ayahRef: string) => (await db.insert(studentCards).values({
      studentId, ayahRef, state: 'review', stability: 3, reps: 2, dueAt: hoursAgo(5), lastReviewedAt: new Date(Date.now() - 5 * 86_400_000),
    }).returning())[0].id;
    Object.assign(cards, { a1: await mkCard(a.id, '1:1'), a2: await mkCard(a.id, '1:2'), a3: await mkCard(a.id, '1:3'), a4: await mkCard(a.id, '1:4'), b1: await mkCard(b.id, '1:1') });
    Object.assign(ids, { a: a.id, b: b.id });
    const tok = (u: { id: string }) => generateToken({ sub: u.id, role: 'student', facultyId: tenant.id });
    Object.assign(tokens, { a: tok(a), b: tok(b) });
  });

  afterAll(async () => {
    await app?.close();
    await closeDb();
  });

  it('requires sign-in and a well-formed batch', async () => {
    expect((await app.inject({ method: 'POST', url: '/v1/scheduler/rate-batch', payload: { reviews: [review(randomUUID(), hoursAgo(1))] } })).statusCode).toBe(401);
    expect((await send('a', [])).statusCode).toBe(400);
    expect((await send('a', [{ clientId: 'x', cardId: 'nope', rating: 'good', reviewedAt: 'yesterday' }])).statusCode).toBe(400);
  });

  it('applies a review as of when it happened', async () => {
    const at = hoursAgo(30);
    const r = review(cards.a1, at);
    const res = await send('a', [r]);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().results).toEqual([{ clientId: r.clientId, status: 'applied' }]);

    const card = await cardRow(cards.a1);
    expect(card.reps).toBe(3);
    expect(card.lastReviewedAt!.getTime()).toBe(at.getTime());
    expect(card.dueAt!.getTime()).toBeGreaterThan(at.getTime());
    const [log] = await getDb().select().from(reviewLogs).where(eq(reviewLogs.clientId, r.clientId));
    expect(log.reviewedAt.getTime()).toBe(at.getTime());
  });

  it('counts a review once however many times it is sent', async () => {
    const r = review(cards.a2, hoursAgo(20));
    expect((await send('a', [r])).json().results[0].status).toBe('applied');
    expect((await send('a', [r])).json().results[0].status).toBe('duplicate');
    expect((await send('a', [r, r])).json().results.map((x: { status: string }) => x.status)).toEqual(['duplicate', 'duplicate']);
    expect((await cardRow(cards.a2)).reps).toBe(3);
  });

  it('survives two requests racing with the same review', async () => {
    const r = review(cards.a3, hoursAgo(10));
    const [x, y] = await Promise.all([send('a', [r]), send('a', [r])]);
    expect([x.statusCode, y.statusCode]).toEqual([200, 200]);
    const statuses = [x.json().results[0].status, y.json().results[0].status].sort();
    expect(statuses).toEqual(['applied', 'duplicate']);
    expect((await cardRow(cards.a3)).reps).toBe(3);
  });

  it('applies several reviews of one card oldest first, whatever order they arrive in', async () => {
    const first = review(cards.a4, hoursAgo(8), { rating: 'good' });
    const second = review(cards.a4, hoursAgo(4), { rating: 'again' });
    const res = await send('a', [second, first]);
    expect(res.json().results.map((x: { clientId: string }) => x.clientId)).toEqual([first.clientId, second.clientId]);
    expect(res.json().results.map((x: { status: string }) => x.status)).toEqual(['applied', 'applied']);
    const card = await cardRow(cards.a4);
    expect(card.reps).toBe(4);
    expect(card.lapses).toBe(1);
    expect(card.lastReviewedAt!.getTime()).toBe(second.reviewedAt ? Date.parse(second.reviewedAt) : 0);
  });

  it('keeps a newer review: an older offline one for the same card is stale', async () => {
    const before = (await cardRow(cards.a4)).reps;
    const r = review(cards.a4, hoursAgo(6)); // older than the review at 4 hours ago
    expect((await send('a', [r])).json().results[0].status).toBe('stale');
    expect((await cardRow(cards.a4)).reps).toBe(before);
  });

  it('refuses reviews from the future, from too long ago, for unknown cards and for someone else\'s card', async () => {
    const r = await send('a', [
      review(cards.a1, new Date(Date.now() + 3_600_000)),
      review(cards.a1, new Date(Date.now() - 20 * 86_400_000)),
      review(randomUUID(), hoursAgo(1)),
      review(cards.b1, hoursAgo(1)),
    ]);
    expect(r.json().results.map((x: { status: string }) => x.status).sort()).toEqual(['invalid_time', 'not_found', 'not_found', 'too_old']);
    expect((await cardRow(cards.b1)).reps).toBe(2);
  });

  it('dates the streak by when the review happened', async () => {
    const db = getDb();
    const [c] = await db.insert(studentCards).values({
      studentId: ids.b, ayahRef: '2:1', state: 'review', stability: 3, reps: 2, dueAt: hoursAgo(5), lastReviewedAt: new Date(Date.now() - 9 * 86_400_000),
    }).returning();
    const [d] = await db.insert(studentCards).values({
      studentId: ids.b, ayahRef: '2:2', state: 'review', stability: 3, reps: 2, dueAt: hoursAgo(5), lastReviewedAt: new Date(Date.now() - 9 * 86_400_000),
    }).returning();
    // two days offline: reviews on day -2 and day -1
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    const yesterday = new Date(Date.now() - 86_400_000);
    const res = await send('b', [review(d.id, yesterday), review(c.id, twoDaysAgo)]);
    expect(res.json().applied).toBe(2);
    const [s] = await db.select().from(streaks).where(eq(streaks.studentId, ids.b));
    expect(s.currentStreak).toBe(2);
    expect(s.lastActiveDate).toBe(localDate(yesterday));
    expect(addDays(s.lastActiveDate!, 1)).toBe(localDate());
  });

  it('only touches the signed-in student\'s cards', async () => {
    const [log] = await getDb().select().from(reviewLogs).where(and(eq(reviewLogs.cardId, cards.b1)));
    expect(log).toBeUndefined();
  });
});
