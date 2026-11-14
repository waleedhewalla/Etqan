/**
 * The recitation cycle: a status the student and teacher can both read, recording again after «يُعاد»,
 * the chain of attempts, and one grade per lesson in the monthly record. Uses in-memory storage.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../server';
import { closeDb, getDb } from '../db';
import { consents, sectionEnrollments, sections, tenants, users } from '../db/schema';
import { generateToken } from '../lib/jwt';
import { MemoryStorage, setStorage } from '../lib/storage';
import { MAX_ATTEMPTS, canRevise, tasmiStatus, type StatusFacts } from '../lib/tasmi-status';
import { currentMonth } from '../lib/monthly';

describe('tasmiStatus', () => {
  const f = (over: Partial<StatusFacts>): StatusFacts => ({ verdict: null, attempt: 1, hasLaterAttempt: false, reviewStartedAt: null, hasReply: false, ...over });

  it('moves from submitted to under review to feedback given before any grade', () => {
    expect(tasmiStatus(f({}))).toBe('submitted');
    expect(tasmiStatus(f({ reviewStartedAt: new Date() }))).toBe('under_review');
    expect(tasmiStatus(f({ reviewStartedAt: new Date(), hasReply: true }))).toBe('feedback_given');
    expect(tasmiStatus(f({ hasReply: true }))).toBe('feedback_given');
  });

  it('treats «مقبول» as final and «عند الشيخة» as referred', () => {
    expect(tasmiStatus(f({ verdict: 'approved' }))).toBe('final_graded');
    expect(tasmiStatus(f({ verdict: 'approved', attempt: 2 }))).toBe('final_graded');
    expect(tasmiStatus(f({ verdict: 'flagged' }))).toBe('referred');
  });

  it('asks for a revision after «يُعاد» until she records again or runs out of attempts', () => {
    expect(tasmiStatus(f({ verdict: 'redo' }))).toBe('revision_requested');
    expect(tasmiStatus(f({ verdict: 'redo', hasLaterAttempt: true }))).toBe('revised');
    expect(tasmiStatus(f({ verdict: 'redo', attempt: MAX_ATTEMPTS }))).toBe('final_graded');
    expect(canRevise(f({ verdict: 'redo' }))).toBe(true);
    for (const facts of [f({}), f({ verdict: 'approved' }), f({ verdict: 'flagged' }), f({ verdict: 'redo', hasLaterAttempt: true }), f({ verdict: 'redo', attempt: MAX_ATTEMPTS })]) {
      expect(canRevise(facts)).toBe(false);
    }
  });
});

/** A tiny but correctly-labelled WebM file (EBML header + padding). */
const webm = () => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(1996, 7)]);
function multipart(fields: Record<string, string>, withAudio = true) {
  const boundary = `----itqan${randomUUID()}`;
  const parts: Buffer[] = Object.entries(fields).map(([k, v]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  if (withAudio) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="a.webm"\r\nContent-Type: audio/webm\r\n\r\n`), webm(), Buffer.from('\r\n'));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe.skipIf(!process.env.DATABASE_URL)('recording again after «يُعاد»', () => {
  let app: FastifyInstance;
  const tag = randomUUID().slice(0, 8);
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const auth = (who: string) => ({ authorization: `Bearer ${tokens[who]}` });
  const submit = (who: string, fields: Record<string, string> = {}) => {
    const m = multipart({ sectionId: ids.section, startRef: '67:1', endRef: '67:5', ...fields });
    return app.inject({ method: 'POST', url: '/v1/tasmi', payload: m.payload, headers: { ...auth(who), 'content-type': m.contentType } });
  };
  const review = (id: string, verdict: 'approved' | 'redo' | 'flagged', score: number, notes?: string) => app.inject({
    method: 'POST', url: `/v1/tasmi/${id}/review`, headers: auth('teacher'),
    payload: { hifzScore: score, tajweedScore: score, fluencyScore: score, verdict, notes },
  });
  const one = async (who: string, id: string) => (await app.inject({ method: 'GET', url: `/v1/tasmi/${id}`, headers: auth(who) })).json();

  beforeAll(async () => {
    setStorage(new MemoryStorage());
    app = await buildApp();
    await app.ready();
    const db = getDb();
    const [tenant] = await db.insert(tenants).values({ slug: `cyc-${tag}`, nameAr: 'معهد' }).returning();
    const mk = async (role: typeof users.$inferInsert['role'], name: string) =>
      (await db.insert(users).values({ tenantId: tenant.id, role, displayNameAr: name }).returning())[0];
    const teacher = await mk('lecturer', 'المعلمة');
    const student = await mk('student', 'طالبة');
    const classmate = await mk('student', 'زميلة');
    const [section] = await db.insert(sections).values({ tenantId: tenant.id, nameAr: 'حلقة', joinCode: `C${tag.toUpperCase().slice(0, 7)}`, teacherId: teacher.id }).returning();
    await db.insert(sectionEnrollments).values([{ sectionId: section.id, studentId: student.id }, { sectionId: section.id, studentId: classmate.id }]);
    await db.insert(consents).values([student, classmate].map((u) => ({ userId: u.id, purpose: 'voice_recording' as const, grantedAt: new Date() })));
    Object.assign(ids, { section: section.id, student: student.id });
    const tok = (u: { id: string; role: string; tenantId: string | null }) => generateToken({ sub: u.id, role: u.role, facultyId: u.tenantId! });
    Object.assign(tokens, { teacher: tok(teacher), student: tok(student), classmate: tok(classmate) });
  });

  afterAll(async () => {
    setStorage(null);
    await app?.close();
    await closeDb();
  });

  it('shows each side where a new recitation stands, step by step', async () => {
    const res = await submit('student');
    expect(res.json()).toMatchObject({ status: 'submitted', attempt: 1, revisionOf: null, canRevise: false, maxAttempts: MAX_ATTEMPTS });
    ids.first = res.json().id;

    // The student listening to her own recording does not start the review; the teacher opening it does.
    await app.inject({ method: 'GET', url: `/v1/tasmi/${ids.first}/audio-link`, headers: auth('student') });
    expect((await one('student', ids.first)).status).toBe('submitted');
    await app.inject({ method: 'GET', url: `/v1/tasmi/${ids.first}/audio-link`, headers: auth('teacher') });
    expect((await one('student', ids.first)).status).toBe('under_review');
    const pending = (await app.inject({ method: 'GET', url: '/v1/tasmi/pending', headers: auth('teacher') })).json();
    expect(pending.find((p: { id: string }) => p.id === ids.first)).toMatchObject({ status: 'under_review', attempt: 1 });

    const m = multipart({ text: 'راجعي الآية الثالثة' }, false);
    const reply = await app.inject({ method: 'POST', url: `/v1/tasmi/${ids.first}/reply`, payload: m.payload, headers: { ...auth('teacher'), 'content-type': m.contentType } });
    expect(reply.statusCode).toBe(200);
    expect(reply.json().status).toBe('feedback_given');
  });

  it('lets her record again only after «يُعاد», only her own, and only the same verses', async () => {
    expect((await submit('student', { revisionOf: ids.first })).statusCode).toBe(409); // not graded yet
    expect((await review(ids.first, 'redo', 55, 'أعيدي بتأنٍّ')).json()).toMatchObject({ status: 'revision_requested', canRevise: true });

    expect((await submit('classmate', { revisionOf: ids.first })).statusCode).toBe(400);
    expect((await submit('student', { revisionOf: ids.first, endRef: '67:4' })).statusCode).toBe(400);
    expect((await submit('student', { revisionOf: randomUUID() })).statusCode).toBe(400);
    expect((await submit('student', { revisionOf: 'nonsense' })).statusCode).toBe(400);

    const second = await submit('student', { revisionOf: ids.first });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ attempt: 2, revisionOf: ids.first, status: 'submitted' });
    ids.second = second.json().id;

    // The first attempt is now "revised", keeps its grade and feedback, and cannot be replaced twice.
    expect(await one('student', ids.first)).toMatchObject({ status: 'revised', canRevise: false, reviewWeightedTotal: 55, reviewNotes: 'أعيدي بتأنٍّ' });
    expect((await submit('student', { revisionOf: ids.first })).statusCode).toBe(409);
  });

  it('makes the last allowed attempt final whatever its verdict', async () => {
    await review(ids.second, 'redo', 65);
    const third = await submit('student', { revisionOf: ids.second });
    expect(third.json()).toMatchObject({ attempt: 3, revisionOf: ids.second });
    ids.third = third.json().id;
    expect(MAX_ATTEMPTS).toBe(3);
    expect((await review(ids.third, 'redo', 72)).json()).toMatchObject({ status: 'final_graded', canRevise: false });
    expect((await submit('student', { revisionOf: ids.third })).statusCode).toBe(409);
  });

  it('returns the whole chain in order, from any attempt, to the student and her teacher only', async () => {
    for (const from of [ids.first, ids.second, ids.third]) {
      const res = await app.inject({ method: 'GET', url: `/v1/tasmi/${from}/history`, headers: auth('teacher') });
      expect(res.statusCode).toBe(200);
      expect(res.json().map((a: { id: string; attempt: number; status: string; reviewWeightedTotal: number }) => [a.id, a.attempt, a.status, a.reviewWeightedTotal]))
        .toEqual([[ids.first, 1, 'revised', 55], [ids.second, 2, 'revised', 65], [ids.third, 3, 'final_graded', 72]]);
    }
    expect((await app.inject({ method: 'GET', url: `/v1/tasmi/${ids.first}/history`, headers: auth('student') })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/v1/tasmi/${ids.first}/history`, headers: auth('classmate') })).statusCode).toBe(404);
    const mine = (await app.inject({ method: 'GET', url: '/v1/tasmi', headers: auth('student') })).json();
    expect(mine.map((t: { attempt: number; status: string }) => [t.attempt, t.status])).toEqual([[3, 'final_graded'], [2, 'revised'], [1, 'revised']]);
  });

  it('counts the verses once in the monthly record: the last graded attempt', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/reports/student/${ids.student}/monthly?month=${currentMonth()}`, headers: auth('teacher') });
    const r = res.json();
    expect(r.recitations).toMatchObject({ submitted: 3, counted: 1 });
    expect(r.totalAppraisal.average).toBe(72); // not the average of 55, 65 and 72
    expect(r.degree).toMatchObject({ score: 72, grade: 'good' });
    expect(r.items.map((i: { attempt: number; replaced: boolean }) => [i.attempt, i.replaced])).toEqual([[1, true], [2, true], [3, false]]);
  });
});
