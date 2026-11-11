import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../server';
import { closeDb, getDb } from '../db';
import { sectionEnrollments, sections, tenants, users } from '../db/schema';
import { generateToken } from '../lib/jwt';
import { setEmailTransport } from '../lib/email';

describe.skipIf(!process.env.DATABASE_URL)('institution setup by its dean', () => {
  let app: FastifyInstance;
  const tag = randomUUID().slice(0, 8);
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const sent: { to: string; text: string }[] = [];
  const call = (who: string, method: 'GET' | 'POST' | 'PATCH', path: string, payload?: object) =>
    app.inject({ method, url: `/v1/admin/${path}`, headers: { authorization: `Bearer ${tokens[who]}` }, payload });
  const email = (name: string) => `${name}-${tag}@example.test`;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    setEmailTransport(async (m) => { sent.push({ to: m.to, text: m.text }); return { status: 'sent' }; });
    const db = getDb();
    const [tenant] = await db.insert(tenants).values({ slug: `su-${tag}`, nameAr: 'معهد' }).returning();
    const [other] = await db.insert(tenants).values({ slug: `su-o-${tag}`, nameAr: 'آخر' }).returning();
    const mk = async (tenantId: string, role: typeof users.$inferInsert['role'], name: string, mail?: string) =>
      (await db.insert(users).values({ tenantId, role, displayNameAr: name, email: mail }).returning())[0];
    const dean = await mk(tenant.id, 'dean', 'العميدة', email('dean'));
    const dean2 = await mk(tenant.id, 'dean', 'عميدة ثانية');
    const advisor = await mk(tenant.id, 'advisor', 'مرشدة');
    const teacher = await mk(tenant.id, 'lecturer', 'معلمة قديمة', email('old'));
    const student = await mk(tenant.id, 'student', 'طالبة');
    const otherDean = await mk(other.id, 'dean', 'عميدة أخرى');
    const otherTeacher = await mk(other.id, 'lecturer', 'معلمة أخرى', email('elsewhere'));
    const [otherSection] = await db.insert(sections).values({ tenantId: other.id, nameAr: 'حلقة أخرى', joinCode: `O${tag.toUpperCase().slice(0, 7)}`, teacherId: otherTeacher.id }).returning();
    Object.assign(ids, { dean: dean.id, dean2: dean2.id, teacher: teacher.id, student: student.id, otherTeacher: otherTeacher.id, otherSection: otherSection.id });
    const tok = (u: { id: string; role: string; tenantId: string | null }) => generateToken({ sub: u.id, role: u.role, facultyId: u.tenantId! });
    Object.assign(tokens, { dean: tok(dean), advisor: tok(advisor), teacher: tok(teacher), student: tok(student), otherDean: tok(otherDean) });
  });

  afterAll(async () => {
    setEmailTransport(null);
    await app?.close();
    await closeDb();
  });

  it('is for deans and operators only', async () => {
    for (const who of ['teacher', 'student', 'advisor']) {
      expect((await call(who, 'GET', 'setup')).statusCode).toBe(403);
      expect((await call(who, 'POST', 'staff', { displayNameAr: 'معلمة', email: email('x') })).statusCode).toBe(403);
      expect((await call(who, 'POST', 'halaqat', { nameAr: 'حلقة', teacherId: ids.teacher })).statusCode).toBe(403);
    }
  });

  it('lists only the institution\'s own teachers and halaqat', async () => {
    const res = (await call('dean', 'GET', 'setup')).json();
    expect(res.staff.map((s: { displayNameAr: string }) => s.displayNameAr).sort()).toEqual(['العميدة', 'عميدة ثانية', 'معلمة قديمة'].sort());
    expect(res.halaqat).toEqual([]);
  });

  it('adds a teacher who can then ask for a sign-in link, and invites her by email', async () => {
    const res = await call('dean', 'POST', 'staff', { displayNameAr: ' فاطمة أحمد ', email: ` ${email('Fatima').toUpperCase()} ` });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ displayNameAr: 'فاطمة أحمد', email: email('fatima'), role: 'lecturer', active: true, halaqat: 0, invitation: 'sent' });
    ids.fatima = res.json().id;
    expect(sent.at(-1)).toMatchObject({ to: email('fatima') });
    expect(sent.at(-1)!.text).toContain('/auth/login/faculty');

    const before = sent.length;
    await app.inject({ method: 'POST', url: '/v1/auth/magic-link', payload: { email: email('fatima') }, remoteAddress: '10.9.8.7' });
    expect(sent.length).toBe(before + 1);
  });

  it('refuses an email that already has an account, here or elsewhere, and bad input', async () => {
    expect((await call('dean', 'POST', 'staff', { displayNameAr: 'مكررة', email: email('FATIMA') })).statusCode).toBe(409);
    expect((await call('dean', 'POST', 'staff', { displayNameAr: 'مكررة', email: email('elsewhere') })).statusCode).toBe(409);
    expect((await call('dean', 'POST', 'staff', { displayNameAr: 'م', email: email('short') })).statusCode).toBe(400);
    expect((await call('dean', 'POST', 'staff', { displayNameAr: 'معلمة', email: 'not-an-email' })).statusCode).toBe(400);
    expect((await call('dean', 'POST', 'staff', { displayNameAr: 'معلمة', email: email('boss'), role: 'dean' })).statusCode).toBe(400);
  });

  it('opens a halaqa for a teacher of the institution, with a join code', async () => {
    expect((await call('dean', 'POST', 'halaqat', { nameAr: 'حلقة', teacherId: ids.otherTeacher })).statusCode).toBe(400);
    expect((await call('dean', 'POST', 'halaqat', { nameAr: 'حلقة', teacherId: ids.student })).statusCode).toBe(400);
    const res = await call('dean', 'POST', 'halaqat', { nameAr: 'حلقة جزء عمّ', teacherId: ids.fatima });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ nameAr: 'حلقة جزء عمّ', teacherId: ids.fatima, teacherName: 'فاطمة أحمد', students: 0, maxStudents: 25 });
    expect(res.json().joinCode).toMatch(/^[A-Z0-9]{6}$/);
    ids.halaqa = res.json().id;

    await getDb().insert(sectionEnrollments).values({ sectionId: ids.halaqa, studentId: ids.student });
    const setup = (await call('dean', 'GET', 'setup')).json();
    expect(setup.halaqat).toHaveLength(1);
    expect(setup.halaqat[0].students).toBe(1);
    expect(setup.staff.find((s: { id: string }) => s.id === ids.fatima).halaqat).toBe(1);
  });

  it('hands a halaqa to another teacher and renames it, within the institution only', async () => {
    expect((await call('dean', 'PATCH', `halaqat/${ids.otherSection}`, { nameAr: 'مسروقة' })).statusCode).toBe(404);
    expect((await call('otherDean', 'PATCH', `halaqat/${ids.halaqa}`, { nameAr: 'مسروقة' })).statusCode).toBe(404);
    expect((await call('dean', 'PATCH', `halaqat/${ids.halaqa}`, { teacherId: ids.otherTeacher })).statusCode).toBe(400);
    expect((await call('dean', 'PATCH', `halaqat/${ids.halaqa}`, {})).statusCode).toBe(400);
    const res = await call('dean', 'PATCH', `halaqat/${ids.halaqa}`, { nameAr: 'حلقة تبارك', teacherId: ids.teacher, maxStudents: 30 });
    expect(res.json()).toMatchObject({ nameAr: 'حلقة تبارك', teacherId: ids.teacher, teacherName: 'معلمة قديمة', maxStudents: 30 });
    // The new teacher now manages it; the old one no longer does.
    const roster = (who: string) => app.inject({ method: 'GET', url: `/v1/sections/${ids.halaqa}/students`, headers: { authorization: `Bearer ${tokens[who]}` } });
    expect((await roster('teacher')).statusCode).toBe(200);
  });

  it('closes a halaqa without deleting anything, and reopens it', async () => {
    const mine = async (who: string) => (await app.inject({ method: 'GET', url: '/v1/sections', headers: { authorization: `Bearer ${tokens[who]}` } }))
      .json().map((x: { id: string }) => x.id);
    const code = (await call('dean', 'GET', 'setup')).json().halaqat[0].joinCode;
    const lookup = () => app.inject({ method: 'GET', url: `/v1/sections/lookup/${code}`, remoteAddress: '10.9.8.5' });
    expect(await mine('teacher')).toContain(ids.halaqa);
    expect(await mine('student')).toContain(ids.halaqa);
    expect((await lookup()).statusCode).toBe(200);

    expect((await call('otherDean', 'PATCH', `halaqat/${ids.halaqa}`, { active: false })).statusCode).toBe(404);
    const closed = await call('dean', 'PATCH', `halaqat/${ids.halaqa}`, { active: false });
    expect(closed.json()).toMatchObject({ id: ids.halaqa, active: false, students: 1 });
    expect(await mine('teacher')).not.toContain(ids.halaqa);
    expect(await mine('student')).not.toContain(ids.halaqa);
    expect((await lookup()).statusCode).toBe(404);
    const setup = (await call('dean', 'GET', 'setup')).json();
    expect(setup.halaqat.find((h: { id: string }) => h.id === ids.halaqa).active).toBe(false);
    expect(setup.staff.find((x: { id: string }) => x.id === ids.teacher).halaqat).toBe(0);
    expect(await getDb().select().from(sectionEnrollments).where(eq(sectionEnrollments.sectionId, ids.halaqa))).toHaveLength(1);

    expect((await call('dean', 'PATCH', `halaqat/${ids.halaqa}`, { active: true })).json()).toMatchObject({ active: true });
    expect(await mine('teacher')).toContain(ids.halaqa);
  });

  it('stops and restores a teacher\'s access, but not the dean\'s own or another dean\'s', async () => {
    expect((await call('dean', 'PATCH', `staff/${ids.dean}`, { active: false })).statusCode).toBe(400);
    expect((await call('dean', 'PATCH', `staff/${ids.dean2}`, { active: false })).statusCode).toBe(403);
    expect((await call('dean', 'PATCH', `staff/${ids.otherTeacher}`, { active: false })).statusCode).toBe(404);
    expect((await call('dean', 'PATCH', `staff/${ids.student}`, { active: false })).statusCode).toBe(404);

    const stopped = await call('dean', 'PATCH', `staff/${ids.fatima}`, { active: false });
    expect(stopped.json()).toMatchObject({ id: ids.fatima, active: false });
    const before = sent.length;
    await app.inject({ method: 'POST', url: '/v1/auth/magic-link', payload: { email: email('fatima') }, remoteAddress: '10.9.8.6' });
    expect(sent.length).toBe(before);
    expect((await call('dean', 'POST', 'halaqat', { nameAr: 'حلقة جديدة', teacherId: ids.fatima })).statusCode).toBe(400);

    const restored = await call('dean', 'PATCH', `staff/${ids.fatima}`, { active: true, displayNameAr: 'فاطمة أحمد علي' });
    expect(restored.json()).toMatchObject({ active: true, displayNameAr: 'فاطمة أحمد علي' });
    const [row] = await getDb().select().from(users).where(eq(users.id, ids.fatima));
    expect(row.active).toBe(true);
  });
});
