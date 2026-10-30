/**
 * Look-alike verses: who may propose, approve and see clusters, and the drills built from them.
 * Verses 110:1–3 and 108:1–3 are given placeholder text for the test and restored afterwards.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { buildApp } from '../server';
import { closeDb, getDb } from '../db';
import { mutashabihatClusters, quranAyat, studentCards, tenants, users } from '../db/schema';
import { generateToken } from '../lib/jwt';
import { BLANK } from '../lib/mutashabihat';

const hasDb = Boolean(process.env.DATABASE_URL);
const TEXT: Record<string, string> = {
  '110:1': 'كَلِمَةٌ أُولَى هُنَا',
  '110:2': 'كَلِمَةٌ ثَانِيَةٌ هُنَا',
  '110:3': 'جُمْلَةٌ مُخْتَلِفَةٌ تَمَامًا هُنَاكَ',
  // 108:1 and 108:2 are worded identically (only the surroundings would tell them apart).
  '108:1': 'كَلِمَةٌ مُكَرَّرَةٌ هُنَا',
  '108:2': 'كَلِمَةٌ مُكَرَّرَةٌ هُنَا',
  '108:3': 'كَلِمَةٌ مُخْتَلِفَةٌ هُنَا',
};

describe.skipIf(!hasDb)('look-alike verses', () => {
  let app: FastifyInstance;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const tag = randomUUID().slice(0, 8);
  const auth = (who: string) => ({ authorization: `Bearer ${tokens[who]}` });
  let saved: (typeof quranAyat.$inferSelect)[] = [];

  const call = (method: 'GET' | 'POST' | 'DELETE', url: string, who: string, payload?: object) =>
    app.inject({ method, url, headers: auth(who), ...(payload ? { payload } : {}) });
  const propose = async (refs: string[], who = 'teacher') => call('POST', '/v1/mutashabihat/clusters', who, { ayahRefs: refs, tawjihAr: 'ملاحظة' });
  const approved = async (refs: string[]) => {
    const id = (await propose(refs)).json().id;
    expect((await call('POST', `/v1/mutashabihat/clusters/${id}/review`, 'sheikha', { decision: 'approved' })).statusCode).toBe(200);
    return id as string;
  };

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const db = getDb();

    saved = await db.select().from(quranAyat).where(inArray(quranAyat.ref, Object.keys(TEXT)));
    await db.delete(quranAyat).where(inArray(quranAyat.ref, Object.keys(TEXT)));
    await db.insert(quranAyat).values(Object.entries(TEXT).map(([ref, text]) => ({
      ref, sura: Number(ref.split(':')[0]), ayah: Number(ref.split(':')[1]), suraNameAr: 'سورة', textUthmani: text, textNormalized: 'x', wordCount: text.split(' ').length,
    })));

    const [a] = await db.insert(tenants).values({ slug: `mut-a-${tag}`, nameAr: 'معهد أ' }).returning();
    const [b] = await db.insert(tenants).values({ slug: `mut-b-${tag}`, nameAr: 'معهد ب' }).returning();
    const mk = async (tenantId: string, role: typeof users.$inferInsert['role'], name: string) =>
      (await db.insert(users).values({ tenantId, role, displayNameAr: name }).returning())[0];
    const u = {
      teacher: await mk(a.id, 'lecturer', 'معلمة'), sheikha: await mk(a.id, 'sheikh_reviewer', 'شيخة'), student: await mk(a.id, 'student', 'طالبة'),
      other: await mk(a.id, 'student', 'طالبة بلا آيات'), teacherB: await mk(b.id, 'lecturer', 'معلمة ب'), studentB: await mk(b.id, 'student', 'طالبة ب'),
    };
    await db.insert(studentCards).values({
      studentId: u.student.id, ayahRef: '110:1', state: 'review', stability: 3, reps: 2,
      dueAt: new Date(Date.now() - 3_600_000), lastReviewedAt: new Date(Date.now() - 3 * 86_400_000),
    });
    Object.assign(ids, { a: a.id, b: b.id, student: u.student.id });
    for (const [who, user] of Object.entries(u)) {
      tokens[who] = generateToken({ sub: user.id, role: user.role, facultyId: user.tenantId! });
    }
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(quranAyat).where(inArray(quranAyat.ref, Object.keys(TEXT)));
    if (saved.length) await db.insert(quranAyat).values(saved);
    await app?.close();
    await closeDb();
  });

  describe('proposing', () => {
    it('lets a teacher propose a cluster, which waits for approval', async () => {
      const res = await propose(['110:2', '110:1']);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({ approvalStatus: 'pending_review', tenantId: ids.a });
      expect(res.json().ayat.map((x: { ref: string }) => x.ref)).toEqual(['110:1', '110:2']);
    });

    it('is for teachers only, and checks the references', async () => {
      expect((await propose(['110:1', '110:2'], 'student')).statusCode).toBe(403);
      expect((await propose(['110:1', '999:1'])).statusCode).toBe(400);
      expect((await propose(['110:1', '110:1'])).statusCode).toBe(400);
      expect((await propose(['110:1'])).statusCode).toBe(400);
    });
  });

  describe('visibility and approval', () => {
    let id: string;
    beforeAll(async () => { id = (await propose(['110:1', '110:3'])).json().id; });

    it('hides a pending cluster from students and from other institutions', async () => {
      expect((await call('GET', `/v1/mutashabihat/clusters/${id}`, 'student')).statusCode).toBe(404);
      expect((await call('GET', `/v1/mutashabihat/clusters/${id}`, 'teacherB')).statusCode).toBe(404);
      expect((await call('GET', `/v1/mutashabihat/clusters/${id}`, 'teacher')).statusCode).toBe(200);
      const list = (await call('GET', '/v1/mutashabihat/clusters', 'student')).json();
      expect(list.some((c: { id: string }) => c.id === id)).toBe(false);
      const forAyah = (await call('GET', '/v1/mutashabihat/for-ayah/110:1', 'student')).json();
      expect(forAyah.some((c: { id: string }) => c.id === id)).toBe(false);
      const pending = (await call('GET', '/v1/mutashabihat/clusters?status=pending_review', 'teacher')).json();
      expect(pending.some((c: { id: string }) => c.id === id)).toBe(true);
      // students cannot ask for drafts by passing a status
      const sneaky = (await call('GET', '/v1/mutashabihat/clusters?status=pending_review', 'student')).json();
      expect(sneaky.some((c: { id: string }) => c.id === id)).toBe(false);
    });

    it('lets only a scholar of the same institution approve', async () => {
      const review = (who: string) => call('POST', `/v1/mutashabihat/clusters/${id}/review`, who, { decision: 'approved' });
      expect((await review('teacher')).statusCode).toBe(404);
      expect((await review('student')).statusCode).toBe(404);
      expect((await review('teacherB')).statusCode).toBe(404);
      expect((await review('sheikha')).json()).toMatchObject({ approvalStatus: 'approved' });
    });

    it('shows an approved cluster to her institution only', async () => {
      expect((await call('GET', `/v1/mutashabihat/clusters/${id}`, 'student')).statusCode).toBe(200);
      expect((await call('GET', `/v1/mutashabihat/clusters/${id}`, 'studentB')).statusCode).toBe(404);
      const forAyah = (await call('GET', '/v1/mutashabihat/for-ayah/110:3', 'student')).json();
      expect(forAyah.some((c: { id: string }) => c.id === id)).toBe(true);
    });

    it('lists the clusters that include verses she is memorizing', async () => {
      const mine = (await call('GET', '/v1/mutashabihat/mine', 'student')).json();
      expect(mine.some((c: { id: string }) => c.id === id)).toBe(true);
      expect(await (await call('GET', '/v1/mutashabihat/mine', 'other')).json()).toEqual([]);
    });
  });

  describe('removing', () => {
    it('lets the author delete a proposal, but not an approved cluster or another institution\'s', async () => {
      const draft = (await propose(['110:1', '110:2'])).json().id;
      expect((await call('DELETE', `/v1/mutashabihat/clusters/${draft}`, 'teacherB')).statusCode).toBe(404);
      expect((await call('DELETE', `/v1/mutashabihat/clusters/${draft}`, 'student')).statusCode).toBe(404);
      expect((await call('DELETE', `/v1/mutashabihat/clusters/${draft}`, 'teacher')).statusCode).toBe(204);

      const live = await approved(['110:1', '110:2']);
      expect((await call('DELETE', `/v1/mutashabihat/clusters/${live}`, 'teacher')).statusCode).toBe(409);
      expect((await call('POST', `/v1/mutashabihat/clusters/${live}/review`, 'sheikha', { decision: 'rejected' })).json().approvalStatus).toBe('rejected');
      expect((await call('GET', `/v1/mutashabihat/clusters/${live}`, 'student')).statusCode).toBe(404);
    });
  });

  describe('drills', () => {
    let cluster: string;
    beforeAll(async () => { cluster = await approved(['110:1', '110:2']); });
    const generate = (who: string, body: object) => call('POST', '/v1/mutashabihat/drills/generate', who, body);
    const cardOf = async () => (await getDb().select().from(studentCards).where(and(eq(studentCards.studentId, ids.student), eq(studentCards.ayahRef, '110:1'))))[0];

    it('will not drill a cluster that is not approved or not hers', async () => {
      const pending = (await propose(['110:1', '110:2'])).json().id;
      expect((await generate('student', { clusterId: pending, drillType: 'cloze' })).statusCode).toBe(404);
      expect((await generate('studentB', { clusterId: cluster, drillType: 'cloze' })).statusCode).toBe(404);
      expect((await generate('student', { clusterId: cluster, drillType: 'drag-drop' })).statusCode).toBe(400);
      expect((await generate('student', { clusterId: cluster, drillType: 'cloze', targetRef: '110:3' })).statusCode).toBe(400);
    });

    it('asks to fill in the swapped word without giving the answer away, and brings a wrongly answered verse back', async () => {
      const before = (await cardOf()).reps;
      const res = await generate('student', { clusterId: cluster, drillType: 'cloze', targetRef: '110:1' });
      expect(res.statusCode, res.body).toBe(200);
      const drill = res.json();
      expect(drill.question).toBe(`كَلِمَةٌ ${BLANK} هُنَا`);
      expect([...drill.options].sort()).toEqual(['أُولَى', 'ثَانِيَةٌ'].sort());
      expect(drill).not.toHaveProperty('correctAnswer');

      const answer = (a: string) => call('POST', `/v1/mutashabihat/drills/${drill.id}/answer`, 'student', { answer: a });
      expect((await answer('كلمة أخرى')).statusCode).toBe(400);
      const wrong = await answer('ثَانِيَةٌ');
      expect(wrong.json()).toMatchObject({ wasCorrect: false, correctAnswer: 'أُولَى', rescheduled: true });
      expect((await cardOf()).reps).toBe(before + 1);
      expect((await answer('أُولَى')).statusCode).toBe(409);
      expect((await call('POST', `/v1/mutashabihat/drills/${drill.id}/answer`, 'other', { answer: 'أُولَى' })).statusCode).toBe(404);
    });

    it('asks which verse a text is, and leaves the schedule alone for a right answer', async () => {
      const before = (await cardOf()).reps;
      const drill = (await generate('student', { clusterId: cluster, drillType: 'timed-choice', targetRef: '110:1' })).json();
      expect(drill.question).toBe(TEXT['110:1']);
      expect([...drill.options].sort()).toEqual(['110:1', '110:2']);
      const res = await call('POST', `/v1/mutashabihat/drills/${drill.id}/answer`, 'student', { answer: '110:1' });
      expect(res.json()).toMatchObject({ wasCorrect: true, rescheduled: false });
      expect((await cardOf()).reps).toBe(before);
    });

    it('says when verses differ by more than a swapped word', async () => {
      const wide = await approved(['110:1', '110:3']);
      expect((await generate('student', { clusterId: wide, drillType: 'cloze', targetRef: '110:1' })).statusCode).toBe(409);
      expect((await generate('student', { clusterId: wide, drillType: 'timed-choice' })).statusCode).toBe(200);
    });

    it('will not ask "which verse is this?" about verses worded identically, but can still blank a swapped word', async () => {
      const id = await approved(['108:1', '108:2', '108:3']);
      const choice = (targetRef?: string) => generate('student', { clusterId: id, drillType: 'timed-choice', ...(targetRef ? { targetRef } : {}) });
      expect((await choice('108:1')).statusCode).toBe(409);
      expect((await choice('108:2')).statusCode).toBe(409);
      const only = await choice(); // 108:3 is the only verse the text can identify
      expect(only.statusCode, only.body).toBe(200);
      expect(only.json().targetRef).toBe('108:3');

      const cloze = await generate('student', { clusterId: id, drillType: 'cloze', targetRef: '108:3' });
      expect(cloze.statusCode, cloze.body).toBe(200);
      expect(cloze.json().question).toContain(BLANK);

      const twins = await approved(['108:1', '108:2']);
      expect((await generate('student', { clusterId: twins, drillType: 'timed-choice' })).statusCode).toBe(409);
    });

    it('says when the Quran text is not loaded for the cluster', async () => {
      const db = getDb();
      const existing = await db.select({ ref: quranAyat.ref }).from(quranAyat).where(inArray(quranAyat.ref, ['109:1', '109:2']));
      if (existing.length) return; // real text is loaded
      const id = await approved(['109:1', '109:2']);
      expect((await generate('student', { clusterId: id, drillType: 'timed-choice' })).statusCode).toBe(409);
      await db.delete(mutashabihatClusters).where(eq(mutashabihatClusters.id, id)).catch(() => undefined);
    });
  });
});
