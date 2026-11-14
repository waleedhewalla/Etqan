/**
 * Live lessons and guardians: the reminders a guardian gets about her daughter's lesson, and a recitation of a
 * recorded lesson's verses, which remembers which lesson it answers.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../server';
import { closeDb, getDb } from '../db';
import {
  consents, guardianLinks, liveSessions, notifications, sectionEnrollments, sections, tasmiSubmissions, tenants, users,
} from '../db/schema';
import { generateToken } from '../lib/jwt';
import { MemoryStorage, setStorage } from '../lib/storage';
import { setWhatsAppTransport, type WhatsAppMessage } from '../lib/whatsapp';
import { sendDueReminders } from '../lib/live-reminders';

const HOUR = 3_600_000;
const webm = (size = 2400) => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(size - 4, 7)]);
function multipart(fields: Record<string, string>, audio: Buffer) {
  const boundary = `----itqan${randomUUID()}`;
  const parts: Buffer[] = Object.entries(fields).map(([k, v]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="a.webm"\r\nContent-Type: audio/webm\r\n\r\n`), audio, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe.skipIf(!process.env.DATABASE_URL)('live lessons and guardians', () => {
  let app: FastifyInstance;
  const tag = randomUUID().slice(0, 8);
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const sent: WhatsAppMessage[] = [];
  const db = () => getDb();
  const phone = (n: number) => `+2011${tag.replace(/\D/g, '').padEnd(4, '3').slice(0, 4)}${String(n).padStart(4, '0')}`;
  const mailOf = (userId: string) => db().select().from(notifications).where(eq(notifications.userId, userId));
  const plant = async (over: Partial<typeof liveSessions.$inferInsert>) => (await db().insert(liveSessions).values({
    sectionId: ids.section, teacherId: ids.teacher, title: 'درس الملك', roomName: `r-${randomUUID()}`, ...over,
  }).returning())[0];
  const recite = (who: string, fields: Record<string, string>) => {
    const m = multipart({ sectionId: ids.section, ...fields }, webm());
    return app.inject({ method: 'POST', url: '/v1/tasmi', payload: m.payload, headers: { authorization: `Bearer ${tokens[who]}`, 'content-type': m.contentType } });
  };

  beforeAll(async () => {
    setStorage(new MemoryStorage());
    setWhatsAppTransport(async (m) => { sent.push(m); return { status: 'sent' }; });
    app = await buildApp();
    await app.ready();
    const [tenant] = await db().insert(tenants).values({ slug: `lg-${tag}`, nameAr: 'معهد' }).returning();
    const mk = async (role: typeof users.$inferInsert['role'], name: string, extra: Partial<typeof users.$inferInsert> = {}) =>
      (await db().insert(users).values({ tenantId: tenant.id, role, displayNameAr: name, ...extra }).returning())[0];
    const teacher = await mk('lecturer', 'المعلمة');
    const lina = await mk('student', 'لينا');
    const mona = await mk('student', 'منى');
    const nour = await mk('student', 'نور');
    const outsider = await mk('student', 'من حلقة أخرى');
    const mother = await mk('mahram', 'أم لينا ومنى', { whatsappE164: phone(1) });
    const father = await mk('mahram', 'أب نور', { whatsappE164: phone(2) });
    const [section] = await db().insert(sections).values({ tenantId: tenant.id, nameAr: 'حلقة', joinCode: `G${tag.toUpperCase().slice(0, 6)}`, teacherId: teacher.id }).returning();
    const [other] = await db().insert(sections).values({ tenantId: tenant.id, nameAr: 'أخرى', joinCode: `H${tag.toUpperCase().slice(0, 6)}`, teacherId: teacher.id }).returning();
    await db().insert(sectionEnrollments).values([lina, mona, nour].map((s) => ({ sectionId: section.id, studentId: s.id })).concat({ sectionId: other.id, studentId: outsider.id }));
    await db().insert(guardianLinks).values([
      { studentId: lina.id, guardianId: mother.id }, { studentId: mona.id, guardianId: mother.id }, { studentId: nour.id, guardianId: father.id },
    ]);
    // Nour withdrew guardian access.
    await db().insert(consents).values([
      { userId: nour.id, purpose: 'mahram_access', grantedAt: new Date(Date.now() - HOUR), withdrawnAt: new Date() },
      ...[lina, outsider].map((u) => ({ userId: u.id, purpose: 'voice_recording' as const, grantedAt: new Date() })),
    ]);
    Object.assign(ids, { section: section.id, other: other.id, teacher: teacher.id, mother: mother.id, father: father.id });
    const tok = (u: { id: string; role: string; tenantId: string | null }) => generateToken({ sub: u.id, role: u.role, facultyId: u.tenantId! });
    Object.assign(tokens, { lina: tok(lina), outsider: tok(outsider) });
    Object.assign(ids, { lina: lina.id });
  });

  afterAll(async () => {
    setWhatsAppTransport(null);
    setStorage(null);
    await app?.close();
    await closeDb();
  });

  describe('reminders for guardians', () => {
    it('reaches each guardian once, naming her daughters in the halaqa, but not for a student who withdrew access', async () => {
      const lesson = await plant({ status: 'scheduled', scheduledAt: new Date(Date.now() + 10 * 60_000), startedAt: new Date(Date.now() - 3 * 24 * HOUR) });
      sent.length = 0;
      expect(await sendDueReminders(db())).toMatchObject({ shortlyBefore: 1 });
      const mine = (id: string) => mailOf(id).then((rows) => rows.filter((n) => (n.data as { sessionId?: string })?.sessionId === lesson.id));

      const mother = await mine(ids.mother);
      expect(mother).toHaveLength(1); // one message although two daughters are in the halaqa
      expect(mother[0].bodyAr).toContain('لينا');
      expect(mother[0].bodyAr).toContain('منى');
      expect(mother[0].data).toMatchObject({ type: 'live_reminder_guardian' }); // no link to a room she cannot enter
      expect(await mine(ids.father)).toHaveLength(0); // Nour withdrew guardian access

      expect(sent.filter((m) => m.to === phone(1))).toHaveLength(1);
      expect(sent.some((m) => m.to === phone(2))).toBe(false);
      expect(await sendDueReminders(db())).toMatchObject({ shortlyBefore: 0 }); // not again
      expect(await mine(ids.mother)).toHaveLength(1);
    });
  });

  describe('reciting a recorded lesson', () => {
    it('remembers which lesson the recitation answers, and shows it in the list and in the lesson count', async () => {
      const lesson = await plant({ status: 'ended', endedAt: new Date(), startRef: '67:1', endRef: '67:5', recordingStatus: 'ready' });
      const res = await recite('lina', { startRef: '67:1', endRef: '67:5', liveSessionId: lesson.id });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ liveSessionId: lesson.id });

      const mine = await app.inject({ method: 'GET', url: '/v1/tasmi', headers: { authorization: `Bearer ${tokens.lina}` } });
      expect(mine.json().find((t: { id: string }) => t.id === res.json().id)).toMatchObject({ liveSessionTitle: 'درس الملك' });

      const [row] = await db().select().from(tasmiSubmissions).where(eq(tasmiSubmissions.id, res.json().id));
      expect(row.liveSessionId).toBe(lesson.id);
      // Deleting the lesson leaves the recitation.
      await db().delete(liveSessions).where(eq(liveSessions.id, lesson.id));
      const [after] = await db().select().from(tasmiSubmissions).where(eq(tasmiSubmissions.id, row.id));
      expect(after.liveSessionId).toBeNull();
    });

    it('refuses other verses, another halaqa’s lesson, a lesson still running, and an unknown lesson', async () => {
      const lesson = await plant({ status: 'ended', endedAt: new Date(), startRef: '67:1', endRef: '67:5' });
      expect((await recite('lina', { startRef: '67:1', endRef: '67:6', liveSessionId: lesson.id })).statusCode).toBe(400);
      expect((await recite('lina', { startRef: '67:1', endRef: '67:5', liveSessionId: randomUUID() })).statusCode).toBe(400);
      const running = await plant({ status: 'live', startRef: '67:1', endRef: '67:5' });
      expect((await recite('lina', { startRef: '67:1', endRef: '67:5', liveSessionId: running.id })).statusCode).toBe(400);
      const elsewhere = await plant({ sectionId: ids.other, status: 'ended', endedAt: new Date(), startRef: '67:1', endRef: '67:5' });
      expect((await recite('lina', { startRef: '67:1', endRef: '67:5', liveSessionId: elsewhere.id })).statusCode).toBe(400);
    });
  });
});
