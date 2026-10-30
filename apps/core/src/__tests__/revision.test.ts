/**
 * What happens after a teacher reviews a recitation (revision cards and streak), how long
 * recordings are kept, and the report on how well the automatic flags agree with teachers.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { AYAH_COUNTS } from '@itqan/quran';
import { buildApp } from '../server';
import { closeDb, getDb } from '../db';
import { auditLogs, sectionEnrollments, sections, streaks, studentCards, tasmiSubmissions, tenants, users } from '../db/schema';
import { generateToken } from '../lib/jwt';
import { MemoryStorage, setStorage } from '../lib/storage';
import { ayatBetween, ratingsFor } from '../lib/grading';
import { purgeExpiredAudio } from '../lib/retention';
import { summarizeEval, type EvalRow } from '../lib/asr/eval';
import type { FlaggedWord } from '../lib/asr/types';

const flag = (over: Partial<FlaggedWord>): FlaggedWord => ({ id: 'f1', ayahRef: '1:1', position: 0, type: 'missing', ...over });

describe('ayatBetween', () => {
  it('lists the ayat of a range, across suras', () => {
    expect(ayatBetween('112:1', '112:3', AYAH_COUNTS)).toEqual(['112:1', '112:2', '112:3']);
    expect(ayatBetween('113:5', '114:2', AYAH_COUNTS)).toEqual(['113:5', '114:1', '114:2']);
    expect(ayatBetween('2:5', '2:1', AYAH_COUNTS)).toEqual([]);
    expect(ayatBetween('x', '2:1', AYAH_COUNTS)).toEqual([]);
  });
});

describe('ratingsFor', () => {
  const ayat = ['1:1', '1:2', '1:3'];
  const base = { ayat, flags: [] as FlaggedWord[] };

  it('reschedules nothing while the sheikha still has to decide', () => {
    expect(ratingsFor({ ...base, verdict: 'flagged', hifzScore: 90 }).size).toBe(0);
  });

  it('sends every ayah back soon when the student must recite again', () => {
    expect([...ratingsFor({ ...base, verdict: 'redo', hifzScore: 40 }).values()]).toEqual(['again', 'again', 'again']);
  });

  it('rates a clean recitation good, or easy at a high memorization score', () => {
    expect([...ratingsFor({ ...base, verdict: 'approved', hifzScore: 90 }).values()]).toEqual(['good', 'good', 'good']);
    expect(ratingsFor({ ...base, verdict: 'approved', hifzScore: 95 }).get('1:1')).toBe('easy');
  });

  it('rates each ayah by the memory errors the teacher confirmed in it', () => {
    const flags = [
      flag({ id: 'a', ayahRef: '1:2', decision: 'confirmed' }),
      flag({ id: 'b', ayahRef: '1:3', decision: 'confirmed' }),
      flag({ id: 'c', ayahRef: '1:3', type: 'wrong', decision: 'confirmed' }),
    ];
    const r = ratingsFor({ ayat, flags, verdict: 'approved', hifzScore: 90 });
    expect([r.get('1:1'), r.get('1:2'), r.get('1:3')]).toEqual(['good', 'hard', 'again']);
  });

  it('ignores flags that were dismissed, undecided, or are only added words', () => {
    const flags = [
      flag({ id: 'a', ayahRef: '1:1', decision: 'dismissed' }),
      flag({ id: 'b', ayahRef: '1:2' }),
      flag({ id: 'c', ayahRef: '1:3', type: 'added', decision: 'confirmed' }),
    ];
    expect([...ratingsFor({ ayat, flags, verdict: 'approved', hifzScore: 90 }).values()]).toEqual(['good', 'good', 'good']);
  });
});

describe('summarizeEval', () => {
  const row = (over: Partial<EvalRow>): EvalRow => ({ studentId: 'x', aiStatus: 'done', flags: [], reviewVerdict: 'approved', aiReadyForApproval: false, ...over });

  it('reports precision overall, by type and per student, with students numbered', () => {
    const r = summarizeEval([
      row({ studentId: 'ann', flags: [flag({ decision: 'confirmed' }), flag({ id: 'f2', type: 'wrong', decision: 'dismissed', disputed: true })] }),
      row({ studentId: 'ann', flags: [flag({ decision: 'confirmed' })], aiReadyForApproval: true }),
      row({ studentId: 'bea', flags: [flag({ decision: 'dismissed', type: 'added' }), flag({ id: 'f3' })], reviewVerdict: null }),
      row({ aiStatus: 'unclear' }), row({ aiStatus: 'failed' }), row({ aiStatus: null }),
    ]);
    expect(r).toMatchObject({ checked: 3, reviewed: 2, unclear: 1, failed: 1 });
    expect(r.flags).toEqual({ confirmed: 2, dismissed: 2, undecided: 0, precision: 50 });
    expect(r.byType.missing).toEqual({ confirmed: 2, dismissed: 0 });
    expect(r.byType.wrong).toEqual({ confirmed: 0, dismissed: 1 });
    expect(r.disputes).toEqual({ total: 1, dismissed: 1 });
    expect(r.ready).toEqual({ total: 1, approved: 1 });
    expect(r.perStudent).toEqual([
      { student: 'S1', reviewed: 2, decided: 3, precision: 66.7 },
      { student: 'S2', reviewed: 0, decided: 1, precision: 0 },
    ]);
    expect(JSON.stringify(r)).not.toContain('ann');
  });

  it('has no precision when nothing was decided', () => {
    expect(summarizeEval([]).flags.precision).toBeNull();
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('after the review', () => {
  let app: FastifyInstance;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const tag = randomUUID().slice(0, 8);
  const auth = (who: string) => ({ authorization: `Bearer ${tokens[who]}` });
  const storage = new MemoryStorage();

  const dueOf = async (ref: string) => {
    const [c] = await getDb().select().from(studentCards)
      .where(and(eq(studentCards.studentId, ids.student), eq(studentCards.ayahRef, ref)));
    return c;
  };
  const review = (id: string, payload: object, who = 'teacher') =>
    app.inject({ method: 'POST', url: `/v1/tasmi/${id}/review`, headers: auth(who), payload });
  const scores = { hifzScore: 90, tajweedScore: 90, fluencyScore: 90 };

  beforeAll(async () => {
    setStorage(storage);
    app = await buildApp();
    await app.ready();
    const db = getDb();
    const [tenant] = await db.insert(tenants).values({ slug: `rev-${tag}`, nameAr: 'معهد' }).returning();
    const mk = async (role: typeof users.$inferInsert['role'], name: string) =>
      (await db.insert(users).values({ tenantId: tenant.id, role, displayNameAr: name }).returning())[0];
    const teacher = await mk('lecturer', 'المعلمة');
    const student = await mk('student', 'طالبة');
    const [section] = await db.insert(sections).values({
      tenantId: tenant.id, nameAr: 'حلقة', joinCode: `V${tag.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7)}`, teacherId: teacher.id,
    }).returning();
    await db.insert(sectionEnrollments).values({ sectionId: section.id, studentId: student.id });

    const past = new Date(Date.now() - 3_600_000);
    await db.insert(studentCards).values(['112:1', '112:2', '112:3', '112:4', '111:1'].map((ayahRef) => ({
      studentId: student.id, ayahRef, state: 'review' as const, stability: 3, reps: 2, dueAt: past,
      lastReviewedAt: new Date(Date.now() - 3 * 86_400_000),
    })));
    Object.assign(ids, { tenant: tenant.id, student: student.id, section: section.id, teacher: teacher.id });
    tokens.teacher = generateToken({ sub: teacher.id, role: 'lecturer', facultyId: tenant.id });
    tokens.student = generateToken({ sub: student.id, role: 'student', facultyId: tenant.id });
  });

  afterAll(async () => {
    setStorage(null);
    await app?.close();
    await closeDb();
  });

  const submission = async (startRef: string, endRef: string, extra: Partial<typeof tasmiSubmissions.$inferInsert> = {}) =>
    (await getDb().insert(tasmiSubmissions).values({
      studentId: ids.student, sectionId: ids.section, startRef, endRef, ...extra,
    }).returning())[0];

  it('reschedules each recited ayah by what the teacher confirmed, and counts the day for her streak', async () => {
    const t = await submission('112:1', '112:2', { aiFlaggedErrors: [flag({ ayahRef: '112:2' })] });
    const res = await review(t.id, { ...scores, verdict: 'approved', flagDecisions: { f1: 'confirmed' } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().graded).toBe(2);

    const [good, hard, untouched] = [await dueOf('112:1'), await dueOf('112:2'), await dueOf('111:1')];
    expect(good.reps).toBe(3);
    expect(hard.reps).toBe(3);
    expect(good.dueAt!.getTime()).toBeGreaterThan(hard.dueAt!.getTime()); // good is further away than hard
    expect(good.dueAt!.getTime()).toBeGreaterThan(Date.now() + 86_400_000);
    expect(untouched.reps).toBe(2); // outside the recited range

    const [streak] = await getDb().select().from(streaks).where(eq(streaks.studentId, ids.student));
    expect(streak.currentStreak).toBe(1);
  });

  it('brings ayat back soon when the student has to recite again', async () => {
    const t = await submission('112:3', '112:4');
    const res = await review(t.id, { ...scores, verdict: 'redo' });
    expect(res.json().graded).toBe(2);
    const again = await dueOf('112:3');
    expect(again.lapses).toBe(1);
    expect(again.dueAt!.getTime()).toBeLessThan((await dueOf('112:1')).dueAt!.getTime());
  });

  it('does not reschedule anything for a recitation sent to the sheikha, but does when she decides', async () => {
    const t = await submission('111:1', '111:1');
    expect((await review(t.id, { ...scores, verdict: 'flagged' })).json().graded).toBe(0);
    expect((await dueOf('111:1')).reps).toBe(2);

    expect((await review(t.id, { ...scores, verdict: 'approved' })).json().graded).toBe(1);
    expect((await dueOf('111:1')).reps).toBe(3);
  });

  it('does not count a review twice when the teacher edits it', async () => {
    const t = await submission('112:1', '112:1');
    expect((await review(t.id, { ...scores, verdict: 'approved' })).json().graded).toBe(1);
    const reps = (await dueOf('112:1')).reps;
    expect((await review(t.id, { ...scores, verdict: 'approved', notes: 'تعديل' })).json().graded).toBe(0);
    expect((await dueOf('112:1')).reps).toBe(reps);
  });

  it('leaves a review alone when it is not hers to make', async () => {
    const t = await submission('112:1', '112:1');
    const reps = (await dueOf('112:1')).reps;
    expect((await review(t.id, { ...scores, verdict: 'approved' }, 'student')).statusCode).toBe(404);
    expect((await dueOf('112:1')).reps).toBe(reps);
  });

  describe('keeping recordings', () => {
    const put = async (extra: Partial<typeof tasmiSubmissions.$inferInsert>) => {
      const key = `tasmi/${ids.student}/${randomUUID()}.webm`;
      await storage.put(key, Buffer.alloc(32, 1), 'audio/webm');
      const t = await submission('112:1', '112:1', { audioKey: key, ...extra });
      return { id: t.id, key };
    };
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

    it('deletes audio a day after review, or a month after submission if nobody reviewed it, and nothing else', async () => {
      const reviewedOld = await put({ reviewedAt: hoursAgo(30), reviewVerdict: 'approved', reviewNotes: 'ممتاز' });
      const reviewedNew = await put({ reviewedAt: hoursAgo(2), reviewVerdict: 'approved' });
      const unreviewedOld = await put({ submittedAt: hoursAgo(24 * 40) });
      const unreviewedNew = await put({ submittedAt: hoursAgo(24 * 2) });

      expect(await purgeExpiredAudio(getDb())).toBeGreaterThanOrEqual(2);

      expect(storage.has(reviewedOld.key)).toBe(false);
      expect(storage.has(unreviewedOld.key)).toBe(false);
      expect(storage.has(reviewedNew.key)).toBe(true);
      expect(storage.has(unreviewedNew.key)).toBe(true);

      const rows = await getDb().select().from(tasmiSubmissions).where(eq(tasmiSubmissions.studentId, ids.student));
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(reviewedOld.id)).toMatchObject({ audioKey: null, reviewNotes: 'ممتاز', reviewVerdict: 'approved' });
      expect(byId.get(reviewedOld.id)!.audioDeletedAt).toBeTruthy();
      expect(byId.get(reviewedNew.id)!.audioKey).toBe(reviewedNew.key);

      const audits = await getDb().select().from(auditLogs).where(eq(auditLogs.resourceId, reviewedOld.id));
      expect(audits.find((a) => a.action === 'tasmi.audio.expire')).toMatchObject({ tenantId: ids.tenant });
    });

    it('keeps the row for another try when the file cannot be removed', async () => {
      const stuck = await put({ reviewedAt: hoursAgo(48), reviewVerdict: 'approved' });
      const original = storage.delete.bind(storage);
      storage.delete = async () => { throw new Error('storage down'); };
      try {
        await purgeExpiredAudio(getDb());
      } finally {
        storage.delete = original;
      }
      const [row] = await getDb().select().from(tasmiSubmissions).where(eq(tasmiSubmissions.id, stuck.id));
      expect(row.audioKey).toBe(stuck.key);
      expect(row.audioDeletedAt).toBeNull();

      await purgeExpiredAudio(getDb());
      expect(storage.has(stuck.key)).toBe(false);
    });
  });
});
