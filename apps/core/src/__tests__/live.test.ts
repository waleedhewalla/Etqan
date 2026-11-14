/**
 * Live lessons: who may start, join, speak and end; raised hands and written questions; attendance.
 * The media server is replaced by a recorder, so these run without one.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../server';
import { closeDb, getDb } from '../db';
import { guardianLinks, sectionEnrollments, sections, tenants, users } from '../db/schema';
import { generateToken } from '../lib/jwt';
import { setLiveGateway, type LiveGateway } from '../lib/live';

describe.skipIf(!process.env.DATABASE_URL)('live lessons', () => {
  let app: FastifyInstance;
  const tag = randomUUID().slice(0, 8);
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const calls: string[] = [];
  let refuseSpeak = false;
  const gateway: LiveGateway = {
    joinToken: async (room, identity, _name, role) => `token:${room}:${identity}:${role}`,
    setCanSpeak: async (room, identity, canSpeak) => {
      if (refuseSpeak) throw new Error('participant not found');
      calls.push(`speak:${identity}:${canSpeak}`);
    },
    closeRoom: async (room) => { calls.push(`close:${room}`); },
  };
  const call = (who: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) =>
    app.inject({ method, url: `/v1${url}`, headers: { authorization: `Bearer ${tokens[who]}` }, payload });
  const start = (who: string, payload: object = { title: 'درس سورة الملك' }, section = 'section') => call(who, 'POST', `/sections/${ids[section]}/live`, payload);
  const state = async (who: string) => (await call(who, 'GET', `/live/${ids.session}/state`)).json();

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const db = getDb();
    const [tenant] = await db.insert(tenants).values({ slug: `liv-${tag}`, nameAr: 'معهد' }).returning();
    const mk = async (role: typeof users.$inferInsert['role'], name: string) =>
      (await db.insert(users).values({ tenantId: tenant.id, role, displayNameAr: name }).returning())[0];
    const teacher = await mk('lecturer', 'المعلمة');
    const otherTeacher = await mk('lecturer', 'معلمة أخرى');
    const dean = await mk('dean', 'العميدة');
    const student = await mk('student', 'أسماء');
    const classmate = await mk('student', 'بسمة');
    const absent = await mk('student', 'جميلة');
    const outsider = await mk('student', 'من حلقة أخرى');
    const guardian = await mk('mahram', 'ولي الأمر');
    const code = (p: string) => `${p}${tag.toUpperCase().slice(0, 6)}`;
    const [section] = await db.insert(sections).values({ tenantId: tenant.id, nameAr: 'حلقة', joinCode: code('V'), teacherId: teacher.id }).returning();
    const [otherSection] = await db.insert(sections).values({ tenantId: tenant.id, nameAr: 'أخرى', joinCode: code('W'), teacherId: otherTeacher.id }).returning();
    await db.insert(sectionEnrollments).values([
      ...[student, classmate, absent].map((u) => ({ sectionId: section.id, studentId: u.id })),
      { sectionId: otherSection.id, studentId: outsider.id },
    ]);
    await db.insert(guardianLinks).values({ studentId: student.id, guardianId: guardian.id });
    Object.assign(ids, { section: section.id, otherSection: otherSection.id, teacher: teacher.id, student: student.id, classmate: classmate.id, absent: absent.id, dean: dean.id });
    const tok = (u: { id: string; role: string; tenantId: string | null }) => generateToken({ sub: u.id, role: u.role, facultyId: u.tenantId! });
    Object.assign(tokens, {
      teacher: tok(teacher), otherTeacher: tok(otherTeacher), dean: tok(dean), student: tok(student),
      classmate: tok(classmate), outsider: tok(outsider), guardian: tok(guardian),
    });
  });

  afterAll(async () => {
    setLiveGateway(null);
    await app?.close();
    await closeDb();
  });

  it('says so when live lessons are not set up, instead of opening a room nobody can enter', async () => {
    const res = await start('teacher');
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('LIVE_NOT_CONFIGURED');
    expect((await call('teacher', 'GET', `/sections/${ids.section}/live`)).json()).toEqual({ enabled: false, sessions: [] });
    setLiveGateway(gateway);
  });

  it('is started only by whoever manages the halaqa, one at a time', async () => {
    for (const who of ['student', 'otherTeacher', 'guardian']) expect((await start(who)).statusCode).toBe(404);
    expect((await start('teacher', { title: 'x' })).statusCode).toBe(400);
    expect((await start('teacher', { title: 'درس', startRef: '67:1' })).statusCode).toBe(400);
    expect((await start('teacher', { title: 'درس', startRef: '67:5', endRef: '67:1' })).statusCode).toBe(400);

    const res = await start('teacher', { title: '  درس سورة الملك  ', startRef: '67:1', endRef: '67:5' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ title: 'درس سورة الملك', status: 'live', sectionId: ids.section, teacherId: ids.teacher, startRef: '67:1', endRef: '67:5' });
    // The room name is the key to the room: it never leaves the server.
    expect(res.json().roomName).toBeUndefined();
    ids.session = res.json().id;
    expect((await start('teacher')).statusCode).toBe(409);
  });

  it('shows the live lesson to the halaqa and its staff, and to nobody else', async () => {
    for (const who of ['student', 'classmate', 'teacher', 'dean']) {
      const now = (await call(who, 'GET', '/live/now')).json();
      expect(now.map((s: { id: string }) => s.id)).toEqual([ids.session]);
      expect(now[0]).toMatchObject({ sectionName: 'حلقة', teacherName: 'المعلمة' });
      expect(now[0].roomName).toBeUndefined();
    }
    for (const who of ['outsider', 'guardian', 'otherTeacher']) expect((await call(who, 'GET', '/live/now')).json()).toEqual([]);
  });

  it('lets them in with the right role: the teacher hosts, students and the dean listen', async () => {
    for (const who of ['outsider', 'guardian', 'otherTeacher']) expect((await call(who, 'POST', `/live/${ids.session}/join`)).statusCode).toBe(404);
    expect((await call('student', 'POST', `/live/${randomUUID()}/join`)).statusCode).toBe(404);

    const host = (await call('teacher', 'POST', `/live/${ids.session}/join`)).json();
    expect(host.role).toBe('host');
    expect(host.token).toMatch(new RegExp(`^token:itqan-[0-9a-f]{36}:${ids.teacher}:host$`));
    const listener = (await call('student', 'POST', `/live/${ids.session}/join`)).json();
    expect(listener.role).toBe('listener');
    expect(listener.token.endsWith(`:${ids.student}:listener`)).toBe(true);
    expect((await call('classmate', 'POST', `/live/${ids.session}/join`)).json().role).toBe('listener');
    expect((await call('dean', 'POST', `/live/${ids.session}/join`)).json().role).toBe('listener');
  });

  it('shows the teacher who is here; a student sees only herself', async () => {
    const forTeacher = await state('teacher');
    expect(forTeacher).toMatchObject({ role: 'host', attending: 2 });
    expect(forTeacher.participants.map((p: { name: string }) => p.name)).toEqual(['أسماء', 'بسمة']); // students, not the dean
    const forStudent = await state('student');
    expect(forStudent).toMatchObject({ role: 'listener', attending: 2, participants: [], me: { handRaised: false, canSpeak: false } });
    expect((await call('outsider', 'GET', `/live/${ids.session}/state`)).statusCode).toBe(404);
  });

  it('carries a raised hand to the teacher, who gives and takes back the microphone', async () => {
    expect((await call('outsider', 'PUT', `/live/${ids.session}/hand`, { raised: true })).statusCode).toBe(404);
    expect((await call('student', 'PUT', `/live/${ids.session}/hand`, { raised: true })).json()).toEqual({ handRaised: true });
    expect((await state('teacher')).participants.find((p: { userId: string }) => p.userId === ids.student)).toMatchObject({ handRaised: true, canSpeak: false });

    const speak = (who: string, userId: string, canSpeak: boolean) => call(who, 'PUT', `/live/${ids.session}/participants/${userId}/speak`, { canSpeak });
    for (const who of ['student', 'classmate', 'dean']) expect((await speak(who, ids.student, true)).statusCode).toBe(403);
    expect((await speak('teacher', ids.absent, true)).statusCode).toBe(404); // never joined
    expect(calls).toEqual([]);

    expect((await speak('teacher', ids.student, true)).json()).toEqual({ userId: ids.student, canSpeak: true });
    expect(calls).toEqual([`speak:${ids.student}:true`]);
    // Being given the microphone lowers her hand.
    expect((await state('student')).me).toEqual({ handRaised: false, canSpeak: true });

    await speak('teacher', ids.student, false);
    expect((await state('student')).me.canSpeak).toBe(false);
    expect(calls).toEqual([`speak:${ids.student}:true`, `speak:${ids.student}:false`]);

    // If the media server refuses (she dropped off), nothing here says she can speak.
    refuseSpeak = true;
    expect((await speak('teacher', ids.classmate, true)).statusCode).toBe(409);
    expect((await state('classmate')).me.canSpeak).toBe(false);
    refuseSpeak = false;
  });

  it('takes the microphone back when she reconnects', async () => {
    await call('teacher', 'PUT', `/live/${ids.session}/participants/${ids.student}/speak`, { canSpeak: true });
    await call('student', 'POST', `/live/${ids.session}/join`);
    expect((await state('student')).me).toEqual({ handRaised: false, canSpeak: false });
    expect((await state('teacher')).attending).toBe(2); // joining twice is one person
  });

  it('keeps written questions for everyone in the lesson, and the teacher marks them answered', async () => {
    expect((await call('outsider', 'POST', `/live/${ids.session}/questions`, { text: 'سؤال' })).statusCode).toBe(404);
    expect((await call('student', 'POST', `/live/${ids.session}/questions`, { text: '   ' })).statusCode).toBe(400);
    const asked = await call('student', 'POST', `/live/${ids.session}/questions`, { text: '  ما معنى «تبارك»؟  ' });
    expect(asked.statusCode).toBe(201);
    const qid = asked.json().id;

    expect((await state('classmate')).questions).toMatchObject([{ id: qid, name: 'أسماء', text: 'ما معنى «تبارك»؟', mine: false, answeredAt: null }]);
    expect((await state('student')).questions[0].mine).toBe(true);

    expect((await call('student', 'PATCH', `/live/${ids.session}/questions/${qid}`, { answered: true })).statusCode).toBe(403);
    expect((await call('teacher', 'PATCH', `/live/${ids.session}/questions/${randomUUID()}`, { answered: true })).statusCode).toBe(404);
    expect((await call('teacher', 'PATCH', `/live/${ids.session}/questions/${qid}`, { answered: true })).json().answeredAt).toBeTruthy();
    expect((await state('student')).questions[0].answeredAt).toBeTruthy();
  });

  it('ends for everyone, closes the room, and then refuses new activity', async () => {
    for (const who of ['student', 'otherTeacher']) expect((await call(who, 'POST', `/live/${ids.session}/end`)).statusCode).toBe(404);
    const ended = await call('teacher', 'POST', `/live/${ids.session}/end`);
    expect(ended.json()).toMatchObject({ status: 'ended' });
    expect(ended.json().endedAt).toBeTruthy();
    expect(calls.filter((c) => c.startsWith('close:itqan-'))).toHaveLength(1);
    expect((await call('teacher', 'POST', `/live/${ids.session}/end`)).json().status).toBe('ended'); // ending twice is harmless
    expect(calls.filter((c) => c.startsWith('close:'))).toHaveLength(1);

    expect((await call('student', 'GET', '/live/now')).json()).toEqual([]);
    expect((await call('student', 'POST', `/live/${ids.session}/join`)).statusCode).toBe(410);
    expect((await call('student', 'POST', `/live/${ids.session}/questions`, { text: 'بعد الدرس' })).statusCode).toBe(410);
    expect((await call('student', 'PUT', `/live/${ids.session}/hand`, { raised: true })).statusCode).toBe(410);
    // The questions stay readable after the room closes.
    expect((await state('student')).questions).toHaveLength(1);
    // A new lesson can start once the previous one has ended.
    const next = await start('teacher', { title: 'درس ثانٍ' });
    expect(next.statusCode).toBe(201);
    await call('teacher', 'POST', `/live/${next.json().id}/end`);
  });

  it('reports who of the halaqa came, for the attendance sheet', async () => {
    const res = await call('teacher', 'GET', `/live/${ids.session}/attendance`);
    expect(res.statusCode).toBe(200);
    expect(res.json().records.map((r: { name: string; present: boolean }) => [r.name, r.present]))
      .toEqual([['أسماء', true], ['بسمة', true], ['جميلة', false]]);
    expect((await call('student', 'GET', `/live/${ids.session}/attendance`)).statusCode).toBe(404);

    const list = (await call('teacher', 'GET', `/sections/${ids.section}/live`)).json();
    expect(list.enabled).toBe(true);
    expect(list.sessions.map((s: { title: string; status: string; attended: number }) => [s.title, s.status, s.attended]))
      .toEqual([['درس ثانٍ', 'ended', 0], ['درس سورة الملك', 'ended', 2]]);
    expect((await call('student', 'GET', `/sections/${ids.section}/live`)).statusCode).toBe(404);
  });
});
