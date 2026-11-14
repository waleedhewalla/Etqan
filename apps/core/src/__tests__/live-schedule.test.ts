/**
 * Scheduled live lessons: setting one for later, starting or cancelling it, the verse the room follows, and the
 * reminders students get over WhatsApp and in the app.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { buildApp } from '../server';
import { closeDb, getDb } from '../db';
import { consents, liveSessions, notifications, sectionEnrollments, sections, tenants, users } from '../db/schema';
import { generateToken } from '../lib/jwt';
import { setLiveGateway } from '../lib/live';
import { setWhatsAppTransport, type WhatsAppMessage } from '../lib/whatsapp';
import { MISSED_AFTER_MS, sendDueReminders, whenAr } from '../lib/live-reminders';

const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

describe.skipIf(!process.env.DATABASE_URL)('scheduled live lessons', () => {
  let app: FastifyInstance;
  const tag = randomUUID().slice(0, 8);
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const sent: WhatsAppMessage[] = [];
  const call = (who: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url: `/v1${url}`, headers: { authorization: `Bearer ${tokens[who]}` }, payload });
  const tok = (u: { id: string; role: string; tenantId: string | null }) => generateToken({ sub: u.id, role: u.role, facultyId: u.tenantId! });
  const schedule = (offsetMs: number, extra: object = {}) =>
    call('teacher', 'POST', `/sections/${ids.section}/live`, { title: 'درس مجدول', startRef: '67:1', endRef: '67:10', scheduledAt: iso(offsetMs), ...extra });
  const row = async (id: string) => (await getDb().select().from(liveSessions).where(eq(liveSessions.id, id)))[0];
  /** A scheduled lesson put straight in the database, so its times can be anything. */
  const plant = async (scheduledAt: Date, over: Partial<typeof liveSessions.$inferInsert> = {}) => (await getDb().insert(liveSessions).values({
    sectionId: ids.section, teacherId: ids.teacher, title: 'مجدول', status: 'scheduled', scheduledAt, roomName: `r-${randomUUID()}`, ...over,
  }).returning())[0];
  const mailOf = (userId: string) => getDb().select().from(notifications).where(eq(notifications.userId, userId));

  beforeAll(async () => {
    setWhatsAppTransport(async (m) => { sent.push(m); return { status: 'sent' }; });
    setLiveGateway({ joinToken: async () => 'token', setCanSpeak: async () => undefined, closeRoom: async () => undefined });
    app = await buildApp();
    await app.ready();
    const db = getDb();
    const [tenant] = await db.insert(tenants).values({ slug: `sch-${tag}`, nameAr: 'معهد' }).returning();
    const mk = async (role: typeof users.$inferInsert['role'], name: string, extra: Partial<typeof users.$inferInsert> = {}) =>
      (await db.insert(users).values({ tenantId: tenant.id, role, displayNameAr: name, ...extra }).returning())[0];
    const teacher = await mk('lecturer', 'المعلمة');
    const dean = await mk('dean', 'العميدة');
    const asma = await mk('student', 'أسماء', { whatsappE164: `+2010${tag.replace(/\D/g, '').padEnd(4, '1').slice(0, 4)}0001` });
    const basma = await mk('student', 'بسمة', { whatsappE164: `+2010${tag.replace(/\D/g, '').padEnd(4, '1').slice(0, 4)}0002` });
    const stopped = await mk('student', 'موقوفة', { active: false });
    const outsider = await mk('student', 'من حلقة أخرى');
    const [section] = await db.insert(sections).values({ tenantId: tenant.id, nameAr: 'حلقة', joinCode: `S${tag.toUpperCase().slice(0, 6)}`, teacherId: teacher.id }).returning();
    const [other] = await db.insert(sections).values({ tenantId: tenant.id, nameAr: 'أخرى', joinCode: `T${tag.toUpperCase().slice(0, 6)}`, teacherId: teacher.id }).returning();
    await db.insert(sectionEnrollments).values([asma, basma, stopped].map((s) => ({ sectionId: section.id, studentId: s.id })).concat({ sectionId: other.id, studentId: outsider.id }));
    // Asma agreed to WhatsApp messages; Basma did not.
    await db.insert(consents).values({ userId: asma.id, purpose: 'whatsapp_notifications', grantedAt: new Date() });
    Object.assign(ids, { tenant: tenant.id, section: section.id, other: other.id, teacher: teacher.id, asma: asma.id, basma: basma.id, stopped: stopped.id });
    Object.assign(tokens, { teacher: tok(teacher), dean: tok(dean), asma: tok(asma), basma: tok(basma), outsider: tok(outsider) });
  });

  afterAll(async () => {
    setWhatsAppTransport(null);
    setLiveGateway(null);
    await app?.close();
    await closeDb();
  });

  it('sets a lesson for later, within limits, without starting it', async () => {
    expect((await schedule(60_000)).statusCode).toBe(400); // under five minutes
    expect((await schedule(61 * 24 * HOUR)).statusCode).toBe(400); // over two months
    expect((await call('teacher', 'POST', `/sections/${ids.section}/live`, { title: 'درس', scheduledAt: 'tomorrow' })).statusCode).toBe(400);
    const res = await schedule(2 * HOUR);
    expect(res.statusCode).toBe(201);
    const lesson = res.json();
    ids.lesson = lesson.id;
    expect(lesson).toMatchObject({ status: 'scheduled', title: 'درس مجدول', startRef: '67:1', endRef: '67:10' });
    expect(Date.parse(lesson.scheduledAt)).toBeGreaterThan(Date.now() + HOUR);
    expect(lesson).not.toHaveProperty('roomName');
    expect(lesson).not.toHaveProperty('remindersSent');
    // Setting one does not stop the halaqa holding a lesson now.
    expect((await call('teacher', 'POST', `/sections/${ids.section}/live`, { title: 'الآن' })).statusCode).toBe(201);
  });

  it('is listed for the halaqa and its staff as upcoming, not as live now', async () => {
    for (const who of ['asma', 'teacher', 'dean']) {
      const upcoming = (await call(who, 'GET', '/live/upcoming')).json();
      expect(upcoming.map((s: { id: string }) => s.id), who).toContain(ids.lesson);
      expect(upcoming.find((s: { id: string }) => s.id === ids.lesson)).toMatchObject({ sectionName: 'حلقة', teacherName: 'المعلمة' });
    }
    expect((await call('outsider', 'GET', '/live/upcoming')).json().map((s: { id: string }) => s.id)).not.toContain(ids.lesson);
    expect((await call('asma', 'GET', '/live/now')).json().map((s: { id: string }) => s.id)).not.toContain(ids.lesson);
    const mine = (await call('teacher', 'GET', `/sections/${ids.section}/live`)).json().sessions.find((s: { id: string }) => s.id === ids.lesson);
    expect(mine.status).toBe('scheduled');
  });

  it('cannot be joined until the teacher starts it', async () => {
    const res = await call('asma', 'POST', `/live/${ids.lesson}/join`);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('LESSON_NOT_STARTED');
    expect((await call('teacher', 'POST', `/live/${ids.lesson}/end`)).statusCode).toBe(409); // not started: cancel it instead
  });

  it('is started by its host, once the halaqa has no other lesson running', async () => {
    expect((await call('asma', 'POST', `/live/${ids.lesson}/start`)).statusCode).toBe(403);
    expect((await call('outsider', 'POST', `/live/${ids.lesson}/start`)).statusCode).toBe(404);
    // The lesson started a moment ago is still running.
    expect((await call('teacher', 'POST', `/live/${ids.lesson}/start`)).statusCode).toBe(409);
    const running = (await call('teacher', 'GET', `/sections/${ids.section}/live`)).json().sessions.find((s: { status: string; title: string }) => s.status === 'live');
    await call('teacher', 'POST', `/live/${running.id}/end`);
    const started = await call('teacher', 'POST', `/live/${ids.lesson}/start`);
    expect(started.statusCode).toBe(200);
    expect(started.json().status).toBe('live');
    expect(Date.parse(started.json().startedAt)).toBeGreaterThan(Date.now() - 60_000);
    expect(started.json().scheduledAt).toBeTruthy(); // what it was set for is kept
    expect((await call('teacher', 'POST', `/live/${ids.lesson}/start`)).json().status).toBe('live'); // again: no change
    expect((await call('asma', 'POST', `/live/${ids.lesson}/join`)).statusCode).toBe(200);
    expect((await call('asma', 'GET', '/live/now')).json().map((s: { id: string }) => s.id)).toContain(ids.lesson);
  });

  it('is followed by the room: the host says which verse, everyone reads it', async () => {
    const focus = (who: string, ref: string | null) => call(who, 'PUT', `/live/${ids.lesson}/focus`, { ref });
    expect((await focus('asma', '67:3')).statusCode).toBe(403);
    expect((await focus('outsider', '67:3')).statusCode).toBe(404);
    expect((await focus('teacher', '67:999')).statusCode).toBe(400);
    expect((await focus('teacher', 'nonsense')).statusCode).toBe(400);
    expect((await focus('teacher', '67:3')).json()).toMatchObject({ focusRef: '67:3' });
    const state = (await call('asma', 'GET', `/live/${ids.lesson}/state`)).json();
    expect(state.session.focusRef).toBe('67:3');
    expect(state.session.focusAt).toBeTruthy();
    expect((await focus('teacher', null)).json()).toMatchObject({ focusRef: null, focusAt: null });
    await call('teacher', 'POST', `/live/${ids.lesson}/end`);
    expect((await focus('teacher', '67:4')).statusCode).toBe(410);
  });

  it('can be cancelled by whoever manages the halaqa, before it starts', async () => {
    const lesson = (await schedule(3 * HOUR)).json();
    expect((await call('asma', 'POST', `/live/${lesson.id}/cancel`)).statusCode).toBe(404);
    expect((await call('dean', 'POST', `/live/${lesson.id}/cancel`)).json().status).toBe('cancelled');
    expect((await call('teacher', 'POST', `/live/${lesson.id}/cancel`)).json().status).toBe('cancelled'); // again: no change
    expect((await call('teacher', 'POST', `/live/${lesson.id}/start`)).statusCode).toBe(410);
    expect((await call('asma', 'POST', `/live/${lesson.id}/join`)).statusCode).toBe(410);
    expect((await call('asma', 'GET', '/live/upcoming')).json().map((s: { id: string }) => s.id)).not.toContain(lesson.id);
    // A lesson that has run cannot be cancelled.
    expect((await call('teacher', 'POST', `/live/${ids.lesson}/cancel`)).statusCode).toBe(409);
  });

  describe('reminders', () => {
    it('writes the time the way a student reads it, in the institution’s time zone', () => {
      expect(whenAr(new Date('2026-11-15T18:00:00Z'))).toMatch(/١٥/); // 20:00 in Cairo, still the 15th
      expect(whenAr(new Date('2026-11-15T18:00:00Z'))).toContain('٨:٠٠');
    });

    it('reminds the day before, once, in the app and over WhatsApp to those who agreed', async () => {
      const lesson = await plant(new Date(Date.now() + 20 * HOUR), { startedAt: new Date(Date.now() - 3 * 24 * HOUR) });
      sent.length = 0;
      expect(await sendDueReminders(getDb())).toMatchObject({ dayBefore: 1, shortlyBefore: 0, whatsapp: 1 });
      const asma = (await mailOf(ids.asma)).filter((n) => (n.data as { sessionId?: string })?.sessionId === lesson.id);
      expect(asma).toHaveLength(1);
      expect(asma[0]).toMatchObject({ titleAr: 'درس مباشر غداً', channel: 'in_app' });
      expect(asma[0].bodyAr).toContain('مجدول');
      expect((await mailOf(ids.basma)).some((n) => (n.data as { sessionId?: string })?.sessionId === lesson.id)).toBe(true);
      expect((await mailOf(ids.teacher)).some((n) => (n.data as { sessionId?: string })?.sessionId === lesson.id)).toBe(false); // not for the day-before
      expect((await mailOf(ids.stopped)).length).toBe(0); // a stopped account gets nothing
      // Only Asma agreed to WhatsApp messages.
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ template: 'live_reminder', params: ['مجدول', expect.stringMatching(/[٠-٩]/), 'حلقة'] });
      expect(sent[0].to.endsWith('0001')).toBe(true);
      // The next minute sends nothing more.
      expect(await sendDueReminders(getDb())).toMatchObject({ dayBefore: 0, shortlyBefore: 0 });
      expect((await row(lesson.id)).remindersSent).toBe(1);
    });

    it('reminds shortly before the start, including the teacher, and does not repeat the day-before one', async () => {
      const lesson = await plant(new Date(Date.now() + 10 * 60_000), { startedAt: new Date(Date.now() - 3 * 24 * HOUR), remindersSent: 1 });
      sent.length = 0;
      expect(await sendDueReminders(getDb())).toMatchObject({ dayBefore: 0, shortlyBefore: 1 });
      const mine = (id: string) => mailOf(id).then((rows) => rows.filter((n) => (n.data as { sessionId?: string })?.sessionId === lesson.id));
      expect((await mine(ids.asma))[0].titleAr).toBe('درس مباشر بعد قليل');
      expect(await mine(ids.teacher)).toHaveLength(1);
      expect(sent).toHaveLength(1);
      expect(await sendDueReminders(getDb())).toMatchObject({ shortlyBefore: 0 });
      expect((await row(lesson.id)).remindersSent).toBe(2);
    });

    it('sends no day-before reminder for a lesson set less than a day ahead, only the one shortly before', async () => {
      const lesson = await plant(new Date(Date.now() + 20 * HOUR), { startedAt: new Date(Date.now() - 2 * HOUR) });
      sent.length = 0;
      expect(await sendDueReminders(getDb())).toMatchObject({ dayBefore: 0 });
      expect(sent).toHaveLength(0);
      expect((await row(lesson.id)).remindersSent).toBe(1); // marked, so it is not looked at again
      await getDb().update(liveSessions).set({ scheduledAt: new Date(Date.now() + 5 * 60_000) }).where(eq(liveSessions.id, lesson.id));
      expect(await sendDueReminders(getDb())).toMatchObject({ shortlyBefore: 1 });
    });

    it('sends nothing for a lesson that is far off, started, cancelled, or whose halaqa is closed', async () => {
      const far = await plant(new Date(Date.now() + 5 * 24 * HOUR));
      const cancelled = await plant(new Date(Date.now() + 10 * 60_000), { status: 'cancelled' });
      const live = await plant(new Date(Date.now() + 10 * 60_000), { status: 'live' });
      sent.length = 0;
      expect(await sendDueReminders(getDb())).toMatchObject({ dayBefore: 0, shortlyBefore: 0 });
      for (const l of [far, cancelled, live]) expect((await row(l.id)).remindersSent).toBe(0);
      expect(sent).toHaveLength(0);
      await getDb().update(sections).set({ active: false }).where(eq(sections.id, ids.section));
      const closed = await plant(new Date(Date.now() + 10 * 60_000));
      expect(await sendDueReminders(getDb())).toMatchObject({ shortlyBefore: 0 });
      expect((await row(closed.id)).remindersSent).toBe(0);
      await getDb().update(sections).set({ active: true }).where(eq(sections.id, ids.section));
      await getDb().delete(liveSessions).where(eq(liveSessions.id, closed.id));
    });

    it('closes a lesson nobody started, three hours after its time', async () => {
      const old = await plant(new Date(Date.now() - MISSED_AFTER_MS - 60_000));
      const recent = await plant(new Date(Date.now() - 60 * 60_000));
      expect((await sendDueReminders(getDb())).missed).toBeGreaterThanOrEqual(1);
      expect((await row(old.id)).status).toBe('cancelled');
      expect((await row(recent.id)).status).toBe('scheduled'); // still within the grace
      await getDb().delete(liveSessions).where(eq(liveSessions.id, recent.id));
    });

    it('respects the institution’s module choices: live off sends nothing, notifications off sends no in-app message', async () => {
      const put = (key: string, enabled: boolean) => app.inject({
        method: 'PUT', url: `/v1/admin/modules/${key}`, headers: { authorization: `Bearer ${tokens.dean}` }, payload: { enabled },
      });
      const lesson = await plant(new Date(Date.now() + 10 * 60_000), { startedAt: new Date(Date.now() - 3 * 24 * HOUR) });
      const before = (await mailOf(ids.asma)).length;
      expect((await put('live', false)).statusCode).toBe(200);
      sent.length = 0;
      expect(await sendDueReminders(getDb())).toMatchObject({ shortlyBefore: 0 });
      expect((await row(lesson.id)).remindersSent).toBe(0); // not claimed: it goes when the module is back
      expect((await put('live', true)).statusCode).toBe(200);
      expect((await put('notifications', false)).statusCode).toBe(200);
      expect(await sendDueReminders(getDb())).toMatchObject({ shortlyBefore: 1, whatsapp: 1 });
      expect((await mailOf(ids.asma)).length).toBe(before); // no in-app message
      expect(sent).toHaveLength(1);
      await put('notifications', true);
    });
  });
});
