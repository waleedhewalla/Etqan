/**
 * Recitation checking end to end: who gets checked, what is stored, disputes,
 * the teacher's decisions, the institution switch, and recovery after a restart.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, inArray } from 'drizzle-orm';
import { splitWords } from '@itqan/quran';
import { buildApp } from '../server';
import { closeDb, getDb } from '../db';
import { auditLogs, consents, quranAyat, sectionEnrollments, sections, tasmiSubmissions, tenants, users } from '../db/schema';
import { generateToken } from '../lib/jwt';
import { MemoryStorage, setStorage } from '../lib/storage';
import { setAsrProvider, type AsrProvider } from '../lib/asr';
import { drainChecks, sweepPendingChecks } from '../lib/asr/runner';

const hasDb = Boolean(process.env.DATABASE_URL);
const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(1996, 7)]);

function multipart(fields: Record<string, string>) {
  const boundary = `----itqan${randomUUID()}`;
  const parts = Object.entries(fields).map(([k, v]) =>
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="r.webm"\r\nContent-Type: audio/webm\r\n\r\n`), webm, Buffer.from('\r\n'));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe.skipIf(!hasDb)('AI recitation checking', () => {
  let app: FastifyInstance;
  const storage = new MemoryStorage();
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const tag = randomUUID().slice(0, 8);
  const auth = (who: string) => ({ authorization: `Bearer ${tokens[who]}` });
  const insertedRefs: string[] = [];

  /** Behaviour of the provider for the next check. */
  let hear: (expectedText: string) => Promise<{ text: string; confidence?: number }>;
  const provider: AsrProvider = { name: 'test', transcribe: ({ expectedText }) => hear(expectedText) };
  const dropSecondWord = async (expected: string) => {
    const w = splitWords(expected);
    w.splice(1, 1);
    return { text: w.join(' '), confidence: 0.95 };
  };

  beforeAll(async () => {
    setStorage(storage);
    app = await buildApp();
    await app.ready();
    const db = getDb();

    // Verses 112:1-4 must exist; reuse real text when it is loaded, otherwise placeholders.
    const rows = await db.insert(quranAyat).values([1, 2, 3, 4].map((a) => ({
      ref: `112:${a}`, sura: 112, ayah: a, suraNameAr: 'سورة', textUthmani: `كَلِمَةٌ رَقْمُ ${a} فِي الاِخْتِبَارِ`,
      textNormalized: 'كلمه', wordCount: 5,
    }))).onConflictDoNothing().returning({ ref: quranAyat.ref });
    insertedRefs.push(...rows.map((r) => r.ref));

    const [tenant] = await db.insert(tenants).values({ slug: `asr-${tag}`, nameAr: 'معهد', settings: { aiChecking: true } }).returning();
    const [off] = await db.insert(tenants).values({ slug: `asr-off-${tag}`, nameAr: 'معهد بلا فحص' }).returning();
    const mk = async (tenantId: string, role: typeof users.$inferInsert['role'], name: string) =>
      (await db.insert(users).values({ tenantId, role, displayNameAr: name }).returning())[0];
    const teacher = await mk(tenant.id, 'lecturer', 'المعلمة');
    const dean = await mk(tenant.id, 'dean', 'العميدة');
    const offTeacher = await mk(off.id, 'lecturer', 'معلمة');
    const a = await mk(tenant.id, 'student', 'طالبة أ');
    const b = await mk(tenant.id, 'student', 'طالبة ب');
    const noAi = await mk(tenant.id, 'student', 'طالبة بلا فحص');
    const offStudent = await mk(off.id, 'student', 'طالبة في معهد مغلق');
    const mkSection = async (tenantId: string, teacherId: string, code: string) =>
      (await db.insert(sections).values({ tenantId, nameAr: 'حلقة', joinCode: `${code}${tag.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5)}`, teacherId }).returning())[0];
    const section = await mkSection(tenant.id, teacher.id, 'A');
    const offSection = await mkSection(off.id, offTeacher.id, 'B');
    await db.insert(sectionEnrollments).values([
      { sectionId: section.id, studentId: a.id }, { sectionId: section.id, studentId: b.id },
      { sectionId: section.id, studentId: noAi.id }, { sectionId: offSection.id, studentId: offStudent.id },
    ]);
    const now = new Date();
    await db.insert(consents).values([
      { userId: a.id, purpose: 'voice_recording', grantedAt: now }, { userId: a.id, purpose: 'ai_processing', grantedAt: now },
      { userId: b.id, purpose: 'voice_recording', grantedAt: now }, { userId: b.id, purpose: 'ai_processing', grantedAt: now },
      { userId: noAi.id, purpose: 'voice_recording', grantedAt: now },
      { userId: offStudent.id, purpose: 'voice_recording', grantedAt: now }, { userId: offStudent.id, purpose: 'ai_processing', grantedAt: now },
    ]);

    Object.assign(ids, { tenant: tenant.id, off: off.id, section: section.id, offSection: offSection.id, a: a.id, b: b.id });
    const tok = (u: { id: string; role: string }, facultyId: string) => generateToken({ sub: u.id, role: u.role, facultyId });
    Object.assign(tokens, {
      teacher: tok(teacher, tenant.id), dean: tok(dean, tenant.id), offTeacher: tok(offTeacher, off.id),
      a: tok(a, tenant.id), b: tok(b, tenant.id), noAi: tok(noAi, tenant.id), offStudent: tok(offStudent, off.id),
    });
  });

  beforeEach(() => {
    setAsrProvider(provider);
    hear = dropSecondWord;
  });

  afterAll(async () => {
    await drainChecks();
    setAsrProvider(undefined);
    setStorage(null);
    if (insertedRefs.length) await getDb().delete(quranAyat).where(inArray(quranAyat.ref, insertedRefs));
    await app?.close();
    await closeDb();
  });

  const submit = (who: string, sectionId = ids.section, range = { startRef: '112:1', endRef: '112:2' }) => {
    const m = multipart({ ...range, sectionId, durationMs: '8000' });
    return app.inject({ method: 'POST', url: '/v1/tasmi', payload: m.payload, headers: { ...auth(who), 'content-type': m.contentType } });
  };
  const fetchOne = async (who: string, id: string) =>
    (await app.inject({ method: 'GET', url: `/v1/tasmi/${id}`, headers: auth(who) })).json();

  describe('who is checked', () => {
    it('checks a student who agreed, in an institution that switched it on', async () => {
      const res = await submit('a');
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().aiStatus).toBe('pending');
      await drainChecks();

      const t = await fetchOne('a', res.json().id);
      expect(t).toMatchObject({ aiStatus: 'done', aiProvider: 'test', aiReadyForApproval: false });
      expect(t.aiFlaggedErrors).toHaveLength(1);
      expect(t.aiFlaggedErrors[0]).toMatchObject({ id: 'f1', ayahRef: '112:1', position: 1, type: 'missing' });
      expect(t.aiHifzAccuracy).toBeGreaterThan(80);
      expect(t.aiHifzAccuracy).toBeLessThan(100);
    });

    it('skips a student who did not agree to AI processing', async () => {
      expect((await submit('noAi')).json().aiStatus).toBeNull();
    });

    it('skips an institution that has not switched it on', async () => {
      expect((await submit('offStudent', ids.offSection)).json().aiStatus).toBeNull();
    });

    it('skips everything when no provider is configured', async () => {
      setAsrProvider(null);
      expect((await submit('a')).json().aiStatus).toBeNull();
    });
  });

  describe('results', () => {
    it('marks a clean recitation ready for the teacher to approve', async () => {
      hear = async (text) => ({ text, confidence: 0.95 });
      const id = (await submit('a')).json().id;
      await drainChecks();
      expect(await fetchOne('a', id)).toMatchObject({ aiStatus: 'done', aiHifzAccuracy: 100, aiFlaggedErrors: [], aiReadyForApproval: true });
    });

    it('asks for a new recording instead of flagging when it heard almost nothing', async () => {
      hear = async () => ({ text: '', confidence: 0.9 });
      const id = (await submit('a')).json().id;
      await drainChecks();
      expect(await fetchOne('a', id)).toMatchObject({ aiStatus: 'unclear', aiFlaggedErrors: [], aiHifzAccuracy: null });
    });

    it('records a failed check without blocking the teacher', async () => {
      hear = async () => { throw new Error('service down'); };
      const id = (await submit('a')).json().id;
      await drainChecks();
      expect(await fetchOne('a', id)).toMatchObject({ aiStatus: 'failed', aiError: 'service down' });

      const review = await app.inject({
        method: 'POST', url: `/v1/tasmi/${id}/review`, headers: auth('teacher'),
        payload: { hifzScore: 90, tajweedScore: 90, fluencyScore: 90, verdict: 'approved' },
      });
      expect(review.statusCode).toBe(200);
    });

    it('does not send the recording to the service when the verses are not loaded', async () => {
      const exists = await getDb().select({ ref: quranAyat.ref }).from(quranAyat).where(eq(quranAyat.ref, '111:1'));
      if (exists.length) return; // real text is loaded in this database
      let called = false;
      hear = async (t) => { called = true; return { text: t }; };
      const id = (await submit('a', ids.section, { startRef: '111:1', endRef: '111:2' })).json().id;
      await drainChecks();
      expect(await fetchOne('a', id)).toMatchObject({ aiStatus: 'skipped' });
      expect(called).toBe(false);
    });

    it('skips a check whose recording was deleted before it ran', async () => {
      const db = getDb();
      const [row] = await db.insert(tasmiSubmissions).values({
        studentId: ids.a, sectionId: ids.section, startRef: '112:1', endRef: '112:2', aiStatus: 'pending', audioDeletedAt: new Date(),
      }).returning();
      await sweepPendingChecks(db);
      await drainChecks();
      expect((await fetchOne('a', row.id)).aiStatus).toBe('skipped');
    });
  });

  describe('disputes and decisions', () => {
    let first: string;
    let second: string;

    beforeAll(async () => {
      setAsrProvider(provider);
      hear = dropSecondWord;
      first = (await submit('b')).json().id;
      second = (await submit('b')).json().id;
      await drainChecks();
    });

    it('lets only the student dispute one of her own flags', async () => {
      const url = (id: string, flag = 'f1') => `/v1/tasmi/${id}/flags/${flag}/dispute`;
      expect((await app.inject({ method: 'POST', url: url(second), headers: auth('a') })).statusCode).toBe(404);
      expect((await app.inject({ method: 'POST', url: url(second), headers: auth('teacher') })).statusCode).toBe(404);
      expect((await app.inject({ method: 'POST', url: url(second, 'f9'), headers: auth('b') })).statusCode).toBe(404);

      const ok = await app.inject({ method: 'POST', url: url(second), headers: auth('b') });
      expect(ok.statusCode, ok.body).toBe(200);
      expect(ok.json().aiFlaggedErrors[0].disputed).toBe(true);
    });

    it('shows the teacher disputed recitations first', async () => {
      const res = await app.inject({ method: 'GET', url: `/v1/tasmi/pending?sectionId=${ids.section}`, headers: auth('teacher') });
      const order = res.json().map((r: { id: string }) => r.id);
      expect(order.indexOf(second)).toBeLessThan(order.indexOf(first));
      expect(res.json()[order.indexOf(second)].disputedCount).toBe(1);
    });

    it('keeps the teacher\'s call on each flag, and locks disputes after review', async () => {
      const review = await app.inject({
        method: 'POST', url: `/v1/tasmi/${second}/review`, headers: auth('teacher'),
        payload: { hifzScore: 90, tajweedScore: 90, fluencyScore: 90, verdict: 'approved', flagDecisions: { f1: 'dismissed', f7: 'confirmed' } },
      });
      expect(review.statusCode, review.body).toBe(200);
      const flags = review.json().aiFlaggedErrors;
      expect(flags).toHaveLength(1);
      expect(flags[0]).toMatchObject({ id: 'f1', disputed: true, decision: 'dismissed' });

      const late = await app.inject({ method: 'POST', url: `/v1/tasmi/${second}/flags/f1/dispute`, headers: auth('b') });
      expect(late.statusCode).toBe(409);
    });

    it('rejects an invalid decision', async () => {
      const res = await app.inject({
        method: 'POST', url: `/v1/tasmi/${first}/review`, headers: auth('teacher'),
        payload: { hifzScore: 90, tajweedScore: 90, fluencyScore: 90, verdict: 'approved', flagDecisions: { f1: 'maybe' } },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('recovery', () => {
    it('picks up a check that was queued before a restart', async () => {
      const db = getDb();
      const key = `tasmi/${ids.a}/${randomUUID()}.webm`;
      await storage.put(key, webm, 'audio/webm');
      const [row] = await db.insert(tasmiSubmissions).values({
        studentId: ids.a, sectionId: ids.section, startRef: '112:1', endRef: '112:2', audioKey: key, aiStatus: 'pending',
      }).returning();

      expect(await sweepPendingChecks(db)).toBeGreaterThanOrEqual(1);
      await drainChecks();
      expect((await fetchOne('a', row.id)).aiStatus).toBe('done');
    });

    it('releases a check stuck in processing', async () => {
      const db = getDb();
      const key = `tasmi/${ids.a}/${randomUUID()}.webm`;
      await storage.put(key, webm, 'audio/webm');
      const [row] = await db.insert(tasmiSubmissions).values({
        studentId: ids.a, sectionId: ids.section, startRef: '112:1', endRef: '112:2', audioKey: key,
        aiStatus: 'processing', aiCheckedAt: new Date(Date.now() - 10 * 60_000),
      }).returning();
      await sweepPendingChecks(db);
      await drainChecks();
      expect((await fetchOne('a', row.id)).aiStatus).toBe('done');
    });
  });

  describe('the institution switch', () => {
    it('reports availability and whether it is on for the caller\'s institution', async () => {
      const on = await app.inject({ method: 'GET', url: '/v1/voice/status', headers: auth('a') });
      expect(on.json()).toEqual({ available: true, provider: 'test', enabled: true });
      const off = await app.inject({ method: 'GET', url: '/v1/voice/status', headers: auth('offStudent') });
      expect(off.json()).toMatchObject({ available: true, enabled: false });
      setAsrProvider(null);
      expect((await app.inject({ method: 'GET', url: '/v1/voice/status', headers: auth('a') })).json())
        .toEqual({ available: false, provider: null, enabled: false });
    });

    it('lets an administrator turn it off and on, and records it', async () => {
      const put = (who: string, enabled: boolean) => app.inject({
        method: 'PUT', url: '/v1/voice/institution', headers: auth(who), payload: { enabled },
      });
      expect((await put('teacher', false)).statusCode).toBe(403);
      expect((await put('a', false)).statusCode).toBe(403);

      expect((await put('dean', false)).json()).toEqual({ enabled: false });
      expect((await submit('a')).json().aiStatus).toBeNull();

      expect((await put('dean', true)).json()).toEqual({ enabled: true });
      expect((await submit('a')).json().aiStatus).toBe('pending');
      await drainChecks();

      const rows = await getDb().select().from(auditLogs).where(eq(auditLogs.tenantId, ids.tenant));
      expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(['ai_checking.enable', 'ai_checking.disable']));
      // the other institution's setting is untouched
      const [other] = await getDb().select({ s: tenants.settings }).from(tenants).where(eq(tenants.id, ids.off));
      expect(other.s?.aiChecking).toBeUndefined();
    });
  });
});
