/**
 * Recording a recitation: consent, upload validation, who may listen,
 * streaming with seeking, deletion, and the audit trail. Uses in-memory storage.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../server';
import { closeDb, getDb } from '../db';
import { auditLogs, consents, guardianLinks, sectionEnrollments, sections, tenants, users } from '../db/schema';
import { generateToken } from '../lib/jwt';
import { MemoryStorage, setStorage } from '../lib/storage';

const hasDb = Boolean(process.env.DATABASE_URL);

/** A tiny but correctly-labelled WebM file (EBML header + padding). */
const webm = (size = 2000) => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(size - 4, 7)]);

function multipart(fields: Record<string, string>, file?: { name: string; type: string; data: Buffer }) {
  const boundary = `----itqan${randomUUID()}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
    ), file.data, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe.skipIf(!hasDb)('recitation recordings', () => {
  let app: FastifyInstance;
  const storage = new MemoryStorage();
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const tag = randomUUID().slice(0, 8);
  const auth = (who: string) => ({ authorization: `Bearer ${tokens[who]}` });

  beforeAll(async () => {
    setStorage(storage);
    app = await buildApp();
    await app.ready();
    const db = getDb();

    const [tenant] = await db.insert(tenants).values({ slug: `rec-${tag}`, nameAr: 'معهد التسجيل' }).returning();
    const [other] = await db.insert(tenants).values({ slug: `rec-other-${tag}`, nameAr: 'معهد آخر' }).returning();
    const mk = async (tenantId: string, role: typeof users.$inferInsert['role'], name: string) =>
      (await db.insert(users).values({ tenantId, role, displayNameAr: name }).returning())[0];

    const teacher = await mk(tenant.id, 'lecturer', 'المعلمة');
    const outsider = await mk(other.id, 'lecturer', 'معلمة أخرى');
    const dean = await mk(tenant.id, 'dean', 'العميدة');
    const otherDean = await mk(other.id, 'dean', 'عميدة أخرى');
    const student = await mk(tenant.id, 'student', 'طالبة');
    const classmate = await mk(tenant.id, 'student', 'زميلة');
    const guardian = await mk(tenant.id, 'mahram', 'ولي الأمر');
    const [section] = await db.insert(sections).values({
      tenantId: tenant.id, nameAr: 'حلقة', joinCode: `R${tag.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7)}`, teacherId: teacher.id,
    }).returning();
    await db.insert(sectionEnrollments).values([
      { sectionId: section.id, studentId: student.id },
      { sectionId: section.id, studentId: classmate.id },
    ]);
    await db.insert(guardianLinks).values({ studentId: student.id, guardianId: guardian.id });
    await db.insert(consents).values([
      { userId: classmate.id, purpose: 'voice_recording', grantedAt: new Date() },
    ]);

    Object.assign(ids, {
      tenant: tenant.id, other: other.id, teacher: teacher.id, student: student.id, classmate: classmate.id,
      section: section.id,
    });
    const tok = (u: { id: string; role: string }, facultyId: string) =>
      generateToken({ sub: u.id, role: u.role, facultyId });
    Object.assign(tokens, {
      teacher: tok(teacher, tenant.id), outsider: tok(outsider, other.id), dean: tok(dean, tenant.id),
      otherDean: tok(otherDean, other.id), student: tok(student, tenant.id), classmate: tok(classmate, tenant.id),
      guardian: tok(guardian, tenant.id),
    });
  });

  afterAll(async () => {
    setStorage(null);
    await app?.close();
    await closeDb();
  });

  const submit = (who: string, fields: Record<string, string>, file: { name: string; type: string; data: Buffer } | null = {
    name: 'r.webm', type: 'audio/webm', data: webm(),
  }) => {
    const m = multipart(fields, file ?? undefined);
    return app.inject({
      method: 'POST', url: '/v1/tasmi', payload: m.payload,
      headers: { ...auth(who), 'content-type': m.contentType },
    });
  };
  const valid = () => ({ startRef: '112:1', endRef: '112:4', sectionId: ids.section, durationMs: '9000' });

  describe('consent', () => {
    it('blocks recording until the student has agreed', async () => {
      const res = await submit('student', valid());
      expect(res.statusCode).toBe(403);
      expect(res.json().code ?? res.json().type ?? res.body).toContain('CONSENT_REQUIRED');
    });

    it('blocks it again once consent is withdrawn', async () => {
      const db = getDb();
      await db.update(consents).set({ withdrawnAt: new Date() }).where(eq(consents.userId, ids.classmate));
      expect((await submit('classmate', valid())).statusCode).toBe(403);
      await db.update(consents).set({ withdrawnAt: null }).where(eq(consents.userId, ids.classmate));
    });
  });

  describe('upload', () => {
    it('stores the recording and hides the storage details', async () => {
      const res = await submit('classmate', valid());
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({ startRef: '112:1', endRef: '112:4', hasAudio: true, studentId: ids.classmate });
      expect(body).not.toHaveProperty('audioKey');
      expect(body).not.toHaveProperty('audioUrl');
      expect(storage.size).toBeGreaterThan(0);
    });

    it('rejects files that are not audio, even when labelled as audio', async () => {
      const res = await submit('classmate', valid(), { name: 'x.webm', type: 'audio/webm', data: Buffer.from('<script>alert(1)</script>'.padEnd(64)) });
      expect(res.statusCode).toBe(415);
    });

    it('rejects bad ranges, missing audio and halaqat she is not in', async () => {
      expect((await submit('classmate', { ...valid(), startRef: '2:300' })).statusCode).toBe(400);
      expect((await submit('classmate', { ...valid(), startRef: '112:4', endRef: '112:1' })).statusCode).toBe(400);
      expect((await submit('classmate', { ...valid(), startRef: '2:1', endRef: '3:200' })).statusCode).toBe(400);
      expect((await submit('classmate', { startRef: '112:1', endRef: '112:2' })).statusCode).toBe(400);
      expect((await submit('classmate', valid(), null)).statusCode).toBe(400);
      expect((await submit('classmate', { ...valid(), sectionId: randomUUID() })).statusCode).toBe(400);
    });

    it('is for students only, and needs a signed-in user', async () => {
      expect((await submit('teacher', valid())).statusCode).toBe(403);
      const res = await app.inject({ method: 'POST', url: '/v1/tasmi', payload: {} });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('listening', () => {
    let tasmiId: string;
    let link: string;

    beforeAll(async () => {
      const res = await submit('classmate', valid());
      tasmiId = res.json().id;
    });

    const getLink = (who: string, id = tasmiId) =>
      app.inject({ method: 'GET', url: `/v1/tasmi/${id}/audio-link`, headers: auth(who) });

    it('gives a link to the student and to her own teacher and admin', async () => {
      for (const who of ['classmate', 'teacher', 'dean']) {
        const res = await getLink(who);
        expect(res.statusCode, who).toBe(200);
        expect(res.json().url).toContain(`/v1/tasmi/${tasmiId}/audio?token=`);
        link = res.json().url;
      }
    });

    it('refuses everyone else, guardians and other classmates included', async () => {
      for (const who of ['student', 'guardian', 'outsider', 'otherDean']) {
        expect((await getLink(who)).statusCode, who).toBe(404);
      }
      expect((await getLink('classmate', randomUUID())).statusCode).toBe(404);
    });

    it('records who asked to listen', async () => {
      const rows = await getDb().select().from(auditLogs).where(eq(auditLogs.resourceId, tasmiId));
      const views = rows.filter((r) => r.action === 'tasmi.audio.view');
      expect(views.length).toBeGreaterThanOrEqual(3);
      expect(views.every((r) => r.tenantId === ids.tenant)).toBe(true);
    });

    it('streams the whole file with safe headers', async () => {
      const res = await app.inject({ method: 'GET', url: link });
      expect(res.statusCode).toBe(200);
      expect(res.rawPayload.length).toBe(2000);
      expect(res.headers['content-type']).toBe('audio/webm');
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.headers['cache-control']).toContain('no-store');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    });

    it('supports seeking with Range', async () => {
      const part = await app.inject({ method: 'GET', url: link, headers: { range: 'bytes=100-199' } });
      expect(part.statusCode).toBe(206);
      expect(part.headers['content-range']).toBe('bytes 100-199/2000');
      expect(part.rawPayload.length).toBe(100);

      const bad = await app.inject({ method: 'GET', url: link, headers: { range: 'bytes=5000-' } });
      expect(bad.statusCode).toBe(416);
    });

    it('rejects missing, forged, expired-style and mismatched tokens', async () => {
      const url = `/v1/tasmi/${tasmiId}/audio`;
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url: `${url}?token=nope` })).statusCode).toBe(401);
      // an ordinary access token is not an audio link
      expect((await app.inject({ method: 'GET', url: `${url}?token=${tokens.classmate}` })).statusCode).toBe(401);
      // a link for another recording
      const otherLink = generateToken({ sub: randomUUID(), role: 'audio', purpose: 'audio' }, '5m');
      expect((await app.inject({ method: 'GET', url: `${url}?token=${otherLink}` })).statusCode).toBe(401);
      // an audio link cannot be used to sign in
      const audioTok = new URL(link, 'http://x').searchParams.get('token')!;
      const me = await app.inject({ method: 'GET', url: '/v1/tasmi', headers: { authorization: `Bearer ${audioTok}` } });
      expect(me.statusCode).toBe(401);
    });

    it('lists her submissions without storage details', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/tasmi', headers: auth('classmate') });
      expect(res.statusCode).toBe(200);
      expect(res.json()[0]).toMatchObject({ hasAudio: true });
      expect(JSON.stringify(res.json())).not.toContain('audioKey');
    });

    it('lets only the student delete her recording; the submission stays', async () => {
      const del = (who: string) => app.inject({ method: 'DELETE', url: `/v1/tasmi/${tasmiId}/audio`, headers: auth(who) });
      expect((await del('teacher')).statusCode).toBe(404);
      expect((await del('student')).statusCode).toBe(404);
      const before = storage.size;

      expect((await del('classmate')).statusCode).toBe(204);
      expect(storage.size).toBe(before - 1);
      expect((await del('classmate')).statusCode).toBe(404);
      expect((await getLink('classmate')).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: link })).statusCode).toBe(404);

      const one = await app.inject({ method: 'GET', url: `/v1/tasmi/${tasmiId}`, headers: auth('teacher') });
      expect(one.json()).toMatchObject({ id: tasmiId, hasAudio: false });
    });
  });

  describe('GET /v1/audit', () => {
    it('shows an institution only its own entries', async () => {
      const mine = await app.inject({ method: 'GET', url: '/v1/audit?action=tasmi.audio.view', headers: auth('dean') });
      expect(mine.statusCode).toBe(200);
      expect(mine.json().length).toBeGreaterThan(0);
      expect(mine.json().every((r: { tenantId: string }) => r.tenantId === ids.tenant)).toBe(true);

      const theirs = await app.inject({ method: 'GET', url: '/v1/audit?action=tasmi.audio.view', headers: auth('otherDean') });
      expect(theirs.json().some((r: { tenantId: string }) => r.tenantId === ids.tenant)).toBe(false);
    });

    it('is for administrators only', async () => {
      expect((await app.inject({ method: 'GET', url: '/v1/audit', headers: auth('teacher') })).statusCode).toBe(403);
    });
  });
});
