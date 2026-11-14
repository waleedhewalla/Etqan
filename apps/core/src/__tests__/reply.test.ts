/**
 * The teacher's reply to a recording: text, a recorded voice message, or both. Who may send it,
 * who may listen, replacing and removing it, and its retention. Uses in-memory storage.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../server';
import { closeDb, getDb } from '../db';
import { guardianLinks, sectionEnrollments, sections, tasmiSubmissions, tenants, users } from '../db/schema';
import { generateToken } from '../lib/jwt';
import { purgeExpiredAudio } from '../lib/retention';
import { MemoryStorage, setStorage } from '../lib/storage';

/** A tiny but correctly-labelled WebM file (EBML header + padding). */
const webm = (size = 2000, fill = 7) => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(size - 4, fill)]);

function multipart(fields: Record<string, string>, file?: { type: string; data: Buffer }) {
  const boundary = `----itqan${randomUUID()}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="reply"\r\nContent-Type: ${file.type}\r\n\r\n`,
    ), file.data, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe.skipIf(!process.env.DATABASE_URL)('teacher reply to a recording', () => {
  let app: FastifyInstance;
  const storage = new MemoryStorage();
  const tag = randomUUID().slice(0, 8);
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const auth = (who: string) => ({ authorization: `Bearer ${tokens[who]}` });
  const row = async (id = ids.tasmi) => (await getDb().select().from(tasmiSubmissions).where(eq(tasmiSubmissions.id, id)))[0];
  const reply = (who: string, fields: Record<string, string>, audio?: Buffer, type = 'audio/webm', id = ids.tasmi) => {
    const m = multipart(fields, audio ? { type, data: audio } : undefined);
    return app.inject({ method: 'POST', url: `/v1/tasmi/${id}/reply`, payload: m.payload, headers: { ...auth(who), 'content-type': m.contentType } });
  };
  const link = (who: string) => app.inject({ method: 'GET', url: `/v1/tasmi/${ids.tasmi}/reply-audio-link`, headers: auth(who) });

  beforeAll(async () => {
    setStorage(storage);
    app = await buildApp();
    await app.ready();
    const db = getDb();
    const [tenant] = await db.insert(tenants).values({ slug: `rep-${tag}`, nameAr: 'معهد' }).returning();
    const [other] = await db.insert(tenants).values({ slug: `rep-o-${tag}`, nameAr: 'آخر' }).returning();
    const mk = async (tenantId: string, role: typeof users.$inferInsert['role'], name: string) =>
      (await db.insert(users).values({ tenantId, role, displayNameAr: name }).returning())[0];
    const teacher = await mk(tenant.id, 'lecturer', 'المعلمة');
    const outsider = await mk(other.id, 'lecturer', 'معلمة أخرى');
    const student = await mk(tenant.id, 'student', 'طالبة');
    const classmate = await mk(tenant.id, 'student', 'زميلة');
    const guardian = await mk(tenant.id, 'mahram', 'ولي الأمر');
    const [section] = await db.insert(sections).values({ tenantId: tenant.id, nameAr: 'حلقة', joinCode: `P${tag.toUpperCase().slice(0, 7)}`, teacherId: teacher.id }).returning();
    await db.insert(sectionEnrollments).values([{ sectionId: section.id, studentId: student.id }, { sectionId: section.id, studentId: classmate.id }]);
    await db.insert(guardianLinks).values({ studentId: student.id, guardianId: guardian.id });
    const [tasmi] = await db.insert(tasmiSubmissions).values({ studentId: student.id, sectionId: section.id, startRef: '1:1', endRef: '1:7' }).returning();
    Object.assign(ids, { tasmi: tasmi.id, teacher: teacher.id });
    const tok = (u: { id: string; role: string; tenantId: string | null }) => generateToken({ sub: u.id, role: u.role, facultyId: u.tenantId! });
    Object.assign(tokens, { teacher: tok(teacher), outsider: tok(outsider), student: tok(student), classmate: tok(classmate), guardian: tok(guardian) });
  });

  afterAll(async () => {
    setStorage(null);
    await app?.close();
    await closeDb();
  });

  it('is for the student\'s own staff, and needs something to say', async () => {
    for (const who of ['student', 'classmate', 'guardian', 'outsider']) {
      expect((await reply(who, { text: 'أحسنتِ' })).statusCode).toBe(404);
    }
    expect((await reply('teacher', { text: 'x' }, undefined, undefined, randomUUID())).statusCode).toBe(404);
    expect((await reply('teacher', {})).statusCode).toBe(400);
    expect((await reply('teacher', { text: '   ' })).statusCode).toBe(400);
    expect((await reply('teacher', { text: 'x'.repeat(2001) })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/v1/tasmi/${ids.tasmi}/reply`, headers: auth('teacher'), payload: { text: 'json' } })).statusCode).toBe(400);
    expect(await row()).toMatchObject({ reviewNotes: null, replyAudioKey: null, replyAt: null });
  });

  it('saves a text reply the student then sees on her recitation', async () => {
    const res = await reply('teacher', { text: '  أحسنتِ، راجعي مدّ «الضالين».  ' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ reviewNotes: 'أحسنتِ، راجعي مدّ «الضالين».', hasReplyAudio: false, replyBy: ids.teacher });
    expect(res.json().replyAt).toBeTruthy();
    // No verdict is implied: a reply is not a grade.
    expect(res.json().reviewVerdict).toBeNull();

    const mine = (await app.inject({ method: 'GET', url: '/v1/tasmi', headers: auth('student') })).json();
    expect(mine[0]).toMatchObject({ reviewNotes: 'أحسنتِ، راجعي مدّ «الضالين».', hasReplyAudio: false });
    expect((await link('student')).statusCode).toBe(404);
  });

  it('rejects a voice reply that is not audio', async () => {
    expect((await reply('teacher', {}, Buffer.from('not audio at all, just text'))).statusCode).toBe(415);
    expect((await row()).replyAudioKey).toBeNull();
  });

  it('saves a voice reply in the recordings store, without exposing where', async () => {
    const res = await reply('teacher', { durationMs: '4200' }, webm(3000));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ hasReplyAudio: true, replyDurationMs: 4200, reviewNotes: 'أحسنتِ، راجعي مدّ «الضالين».' });
    expect(JSON.stringify(body)).not.toContain('tasmi-replies');
    expect(body.replyAudioKey).toBeUndefined();

    const saved = await row();
    expect(saved.replyAudioKey!.startsWith(`tasmi-replies/${ids.tasmi}/`) && saved.replyAudioKey!.endsWith('.webm')).toBe(true);
    expect(saved).toMatchObject({ replyAudioContentType: 'audio/webm', replyAudioBytes: 3000 });
    expect(await storage.get(saved.replyAudioKey!)).toBeTruthy();
  });

  it('lets the student and her teacher listen, with seeking, but not a guardian or anyone else', async () => {
    for (const who of ['guardian', 'classmate', 'outsider']) expect((await link(who)).statusCode).toBe(404);
    expect((await link('teacher')).statusCode).toBe(200);
    const { url } = (await link('student')).json();

    const full = await app.inject({ method: 'GET', url });
    expect(full.statusCode).toBe(200);
    expect(full.headers['content-type']).toBe('audio/webm');
    expect(full.rawPayload.length).toBe(3000);

    const part = await app.inject({ method: 'GET', url, headers: { range: 'bytes=0-9' } });
    expect(part.statusCode).toBe(206);
    expect(part.rawPayload.length).toBe(10);

    expect((await app.inject({ method: 'GET', url: `/v1/tasmi/${ids.tasmi}/reply-audio` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/v1/tasmi/${ids.tasmi}/reply-audio?token=nonsense` })).statusCode).toBe(401);
    // A link to the student's own recording does not open the reply, and the other way round.
    const recordingToken = generateToken({ sub: ids.tasmi, role: 'audio', purpose: 'audio' }, '5m');
    expect((await app.inject({ method: 'GET', url: `/v1/tasmi/${ids.tasmi}/reply-audio?token=${recordingToken}` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: url.replace('/reply-audio', '/audio') })).statusCode).toBe(401);
  });

  it('replaces the previous voice reply and removes its file; text and voice can be sent together', async () => {
    const before = (await row()).replyAudioKey!;
    const res = await reply('teacher', { text: 'ردّ جديد', durationMs: '1000' }, webm(2500, 9));
    expect(res.json()).toMatchObject({ reviewNotes: 'ردّ جديد', hasReplyAudio: true, replyDurationMs: 1000 });
    const after = (await row()).replyAudioKey!;
    expect(after).not.toBe(before);
    expect(await storage.get(before)).toBeNull();
    expect(await storage.get(after)).toBeTruthy();
  });

  it('keeps the reply when the recitation is graded afterwards', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/tasmi/${ids.tasmi}/review`, headers: auth('teacher'),
      payload: { hifzScore: 90, tajweedScore: 80, fluencyScore: 70, verdict: 'approved' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ reviewNotes: 'ردّ جديد', hasReplyAudio: true, reviewWeightedTotal: 83, reviewVerdict: 'approved' });
  });

  it('lets the teacher take the voice reply back, leaving the text', async () => {
    const key = (await row()).replyAudioKey!;
    const del = (who: string) => app.inject({ method: 'DELETE', url: `/v1/tasmi/${ids.tasmi}/reply-audio`, headers: auth(who) });
    expect((await del('student')).statusCode).toBe(404);
    expect((await del('teacher')).statusCode).toBe(204);
    expect(await storage.get(key)).toBeNull();
    expect(await row()).toMatchObject({ replyAudioKey: null, replyAudioBytes: null, reviewNotes: 'ردّ جديد' });
    expect((await link('student')).statusCode).toBe(404);
    expect((await del('teacher')).statusCode).toBe(404);
  });

  it('deletes an old voice reply on the retention run, keeping the text', async () => {
    await reply('teacher', {}, webm(2100));
    const key = (await row()).replyAudioKey!;
    await purgeExpiredAudio(getDb(), new Date(Date.now() + 10 * 86_400_000));
    expect((await row()).replyAudioKey).toBe(key); // ten days on: still there for her to hear

    await purgeExpiredAudio(getDb(), new Date(Date.now() + 31 * 86_400_000));
    expect(await storage.get(key)).toBeNull();
    expect(await row()).toMatchObject({ replyAudioKey: null, reviewNotes: 'ردّ جديد', reviewWeightedTotal: 83 });
  });
});
