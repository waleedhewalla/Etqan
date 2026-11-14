/**
 * Recording a live lesson: only the host records, pieces arrive in order, the result is shared
 * with the halaqa (not guardians, not other halaqat), can be removed, and expires.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../server';
import { closeDb, getDb } from '../db';
import { guardianLinks, liveSessions, sectionEnrollments, sections, tenants, users } from '../db/schema';
import { generateToken } from '../lib/jwt';
import { setLiveGateway } from '../lib/live';
import { MemoryStorage, setStorage } from '../lib/storage';
import { purgeExpiredRecordings, sniffVideo } from '../lib/live-recording';

const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6]);
const MORE = Buffer.from([7, 8, 9, 10, 11]);

function multipart(seq: number | null, chunk?: Buffer) {
  const boundary = `----itqan${randomUUID()}`;
  const parts: Buffer[] = [];
  if (seq !== null) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="seq"\r\n\r\n${seq}\r\n`));
  if (chunk) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chunk"; filename="c.webm"\r\nContent-Type: video/webm\r\n\r\n`), chunk, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe.skipIf(!process.env.DATABASE_URL)('recording a live lesson', () => {
  let app: FastifyInstance;
  const tag = randomUUID().slice(0, 8);
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const storage = new MemoryStorage();
  const call = (who: string, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url: `/v1${url}`, headers: { authorization: `Bearer ${tokens[who]}` }, payload });
  const send = (who: string, seq: number | null, chunk?: Buffer, session = ids.session) => {
    const m = multipart(seq, chunk);
    return app.inject({
      method: 'POST', url: `/v1/live/${session}/recording/chunks`,
      headers: { authorization: `Bearer ${tokens[who]}`, 'content-type': m.contentType }, payload: m.payload,
    });
  };
  const startLesson = async () => (await call('teacher', 'POST', `/sections/${ids.section}/live`, { title: 'درس مسجَّل', startRef: '67:1', endRef: '67:5' })).json().id as string;
  const row = async (id = ids.session) => (await getDb().select().from(liveSessions).where(eq(liveSessions.id, id)))[0];

  beforeAll(async () => {
    setStorage(storage);
    setLiveGateway({ joinToken: async () => 'token', setCanSpeak: async () => undefined, closeRoom: async () => undefined });
    app = await buildApp();
    await app.ready();
    const db = getDb();
    const [tenant] = await db.insert(tenants).values({ slug: `rec-${tag}`, nameAr: 'معهد' }).returning();
    const mk = async (role: typeof users.$inferInsert['role'], name: string) =>
      (await db.insert(users).values({ tenantId: tenant.id, role, displayNameAr: name }).returning())[0];
    const [teacher, otherTeacher, dean, student, outsider, guardian] = [
      await mk('lecturer', 'المعلمة'), await mk('lecturer', 'معلمة أخرى'), await mk('dean', 'العميدة'),
      await mk('student', 'أسماء'), await mk('student', 'من حلقة أخرى'), await mk('mahram', 'ولي الأمر'),
    ];
    const code = (p: string) => `${p}${tag.toUpperCase().slice(0, 6)}`;
    const [section] = await db.insert(sections).values({ tenantId: tenant.id, nameAr: 'حلقة', joinCode: code('R'), teacherId: teacher.id }).returning();
    const [other] = await db.insert(sections).values({ tenantId: tenant.id, nameAr: 'أخرى', joinCode: code('Q'), teacherId: otherTeacher.id }).returning();
    await db.insert(sectionEnrollments).values([{ sectionId: section.id, studentId: student.id }, { sectionId: other.id, studentId: outsider.id }]);
    await db.insert(guardianLinks).values({ studentId: student.id, guardianId: guardian.id });
    ids.section = section.id;
    const tok = (u: { id: string; role: string; tenantId: string | null }) => generateToken({ sub: u.id, role: u.role, facultyId: u.tenantId! });
    Object.assign(tokens, { teacher: tok(teacher), otherTeacher: tok(otherTeacher), dean: tok(dean), student: tok(student), outsider: tok(outsider), guardian: tok(guardian) });
    ids.session = await startLesson();
  });

  afterAll(async () => {
    setLiveGateway(null);
    setStorage(null);
    await app?.close();
    await closeDb();
  });

  it('tells a WebM or MP4 recording from anything else', () => {
    expect(sniffVideo(WEBM)).toBe('webm');
    expect(sniffVideo(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42')]))).toBe('mp4');
    expect(sniffVideo(Buffer.from('<html>'))).toBeNull();
  });

  it('is started by the host only, once', async () => {
    expect((await send('teacher', 0, WEBM)).statusCode).toBe(409); // not recording yet
    expect((await call('student', 'POST', `/live/${ids.session}/recording/start`)).statusCode).toBe(403);
    expect((await call('dean', 'POST', `/live/${ids.session}/recording/start`)).statusCode).toBe(403);
    for (const who of ['outsider', 'guardian', 'otherTeacher']) {
      expect((await call(who, 'POST', `/live/${ids.session}/recording/start`)).statusCode).toBe(404);
    }
    const res = await call('teacher', 'POST', `/live/${ids.session}/recording/start`);
    expect(res.statusCode).toBe(200);
    expect(res.json().recordingStatus).toBe('recording');
    expect(res.json()).not.toHaveProperty('recordingKey');
    expect((await call('teacher', 'POST', `/live/${ids.session}/recording/start`)).statusCode).toBe(409);
    // Everyone in the room is told the lesson is being recorded.
    expect((await call('student', 'GET', `/live/${ids.session}/state`)).json().session.recordingStatus).toBe('recording');
  });

  it('takes the pieces in order, from the host, and only a video', async () => {
    expect((await send('student', 0, WEBM)).statusCode).toBe(403);
    expect((await send('teacher', 0, Buffer.from('<html>not a video</html>'))).statusCode).toBe(415);
    expect((await send('teacher', 1, MORE)).statusCode).toBe(409); // skipped the first
    expect((await send('teacher', null, WEBM)).statusCode).toBe(400);
    expect((await send('teacher', 0)).statusCode).toBe(400);
    expect((await send('teacher', 0, WEBM)).json()).toEqual({ received: 1 });
    // The same piece again (its reply was lost) is not appended twice.
    expect((await send('teacher', 0, WEBM)).json()).toEqual({ received: 1 });
    expect((await send('teacher', 1, MORE)).json()).toEqual({ received: 2 });
    expect((await row()).recordingBytes).toBe(WEBM.length + MORE.length);
  });

  it('is not offered until it is finished', async () => {
    expect((await call('student', 'GET', `/live/${ids.session}/recording-link`)).statusCode).toBe(404);
    expect((await call('student', 'GET', '/live/recordings')).json()).toEqual([]);
  });

  it('becomes the lesson’s recording when the host stops it', async () => {
    expect((await call('student', 'POST', `/live/${ids.session}/recording/finish`, {})).statusCode).toBe(403);
    const res = await call('teacher', 'POST', `/live/${ids.session}/recording/finish`, { durationMs: 20_000 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ recordingStatus: 'ready', recordingBytes: 15, recordingDurationMs: 20_000 });
    const saved = await row();
    expect((await storage.get(saved.recordingKey!))?.contentLength).toBe(15);
    // Stopped is stopped: no more pieces, no second recording.
    expect((await send('teacher', 2, MORE)).statusCode).toBe(409);
    expect((await call('teacher', 'POST', `/live/${ids.session}/recording/start`)).statusCode).toBe(409);
    expect((await call('teacher', 'POST', `/live/${ids.session}/recording/finish`, {})).json().recordingStatus).toBe('ready');
  });

  it('is listed for the halaqa and its staff, and for nobody else', async () => {
    for (const who of ['student', 'teacher', 'dean']) {
      const list = (await call(who, 'GET', '/live/recordings')).json();
      expect(list.map((s: { id: string }) => s.id)).toContain(ids.session);
      expect(list[0]).toMatchObject({ sectionName: 'حلقة', teacherName: 'المعلمة', startRef: '67:1' });
      expect(list[0]).not.toHaveProperty('recordingKey');
      expect(list[0]).not.toHaveProperty('roomName');
    }
    for (const who of ['outsider', 'guardian', 'otherTeacher']) {
      expect((await call(who, 'GET', '/live/recordings')).json()).toEqual([]);
      expect((await call(who, 'GET', `/live/${ids.session}/recording-link`)).statusCode).toBe(404);
    }
  });

  it('plays through a short-lived link, in parts, as a video', async () => {
    const link = (await call('student', 'GET', `/live/${ids.session}/recording-link`)).json();
    expect(link.contentType).toBe('video/webm');
    const whole = await app.inject({ method: 'GET', url: link.url });
    expect(whole.statusCode).toBe(200);
    expect(whole.headers['content-type']).toBe('video/webm');
    expect(whole.rawPayload.equals(Buffer.concat([WEBM, MORE]))).toBe(true);
    const part = await app.inject({ method: 'GET', url: link.url, headers: { range: 'bytes=10-14' } });
    expect(part.statusCode).toBe(206);
    expect(part.rawPayload.equals(MORE)).toBe(true);
    expect((await app.inject({ method: 'GET', url: `/v1/live/${ids.session}/recording?token=nope` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/v1/live/${ids.session}/recording` })).statusCode).toBe(401);
  });

  it('is removed by whoever manages the halaqa; the lesson’s record stays', async () => {
    const link = (await call('student', 'GET', `/live/${ids.session}/recording-link`)).json();
    const key = (await row()).recordingKey!;
    expect((await call('student', 'DELETE', `/live/${ids.session}/recording`)).statusCode).toBe(404);
    expect((await call('otherTeacher', 'DELETE', `/live/${ids.session}/recording`)).statusCode).toBe(404);
    const res = await call('teacher', 'DELETE', `/live/${ids.session}/recording`);
    expect(res.json().recordingStatus).toBe('deleted');
    expect(await storage.get(key)).toBeNull();
    expect((await app.inject({ method: 'GET', url: link.url })).statusCode).toBe(404); // a link already handed out stops working
    expect((await call('student', 'GET', '/live/recordings')).json()).toEqual([]);
    expect((await call('teacher', 'DELETE', `/live/${ids.session}/recording`)).statusCode).toBe(404);
    expect((await row()).title).toBe('درس مسجَّل');
  });

  it('is closed with what arrived when the lesson ends before the browser stops it', async () => {
    await call('teacher', 'POST', `/live/${ids.session}/end`);
    const id = await startLesson();
    await call('teacher', 'POST', `/live/${id}/recording/start`);
    await send('teacher', 0, WEBM, id);
    const ended = (await call('teacher', 'POST', `/live/${id}/end`)).json();
    expect(ended).toMatchObject({ status: 'ended', recordingStatus: 'ready', recordingBytes: WEBM.length });
    expect((await send('teacher', 1, MORE, id)).statusCode).toBe(409);
    ids.kept = id;
  });

  it('is marked failed when nothing was received, and cannot be started after the lesson', async () => {
    const id = await startLesson();
    await call('teacher', 'POST', `/live/${id}/recording/start`);
    expect((await call('teacher', 'POST', `/live/${id}/recording/finish`, {})).json().recordingStatus).toBe('failed');
    await call('teacher', 'POST', `/live/${id}/end`);
    const unrecorded = await startLesson();
    await call('teacher', 'POST', `/live/${unrecorded}/end`);
    expect((await call('teacher', 'POST', `/live/${unrecorded}/recording/start`)).statusCode).toBe(410);
    expect((await row(unrecorded)).recordingStatus).toBeNull();
  });

  it('stops growing at the size limit', async () => {
    const id = await startLesson();
    await call('teacher', 'POST', `/live/${id}/recording/start`);
    await send('teacher', 0, WEBM, id);
    await getDb().update(liveSessions).set({ recordingBytes: 600 * 1024 * 1024 - 2 }).where(eq(liveSessions.id, id));
    const res = await send('teacher', 1, MORE, id);
    expect(res.statusCode).toBe(413);
    expect(res.json().code).toBe('RECORDING_FULL');
    await call('teacher', 'POST', `/live/${id}/end`);
    await call('teacher', 'DELETE', `/live/${id}/recording`);
  });

  it('expires after the retention period, and not before', async () => {
    const db = getDb();
    const key = (await row(ids.kept)).recordingKey!;
    await purgeExpiredRecordings(db, new Date(Date.now() + 89 * 86_400_000));
    expect((await row(ids.kept)).recordingStatus).toBe('ready');
    expect(await purgeExpiredRecordings(db, new Date(Date.now() + 91 * 86_400_000))).toBeGreaterThanOrEqual(1);
    expect((await row(ids.kept)).recordingStatus).toBe('deleted');
    expect(await storage.get(key)).toBeNull();
  });
});
