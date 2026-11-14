/**
 * The people of an institution, managed by its dean: the directory, creating students, guardians and staff,
 * correcting and stopping accounts (which must cut an open session at once), halaqa membership, guardians,
 * adding a class in bulk, and the audit log.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { buildApp } from '../server';
import { closeDb, getDb } from '../db';
import { guardianLinks, sectionEnrollments, sections, tenants, users } from '../db/schema';
import { generateToken } from '../lib/jwt';

describe.skipIf(!process.env.DATABASE_URL)('managing users', () => {
  let app: FastifyInstance;
  const tag = randomUUID().slice(0, 8);
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const n = (i: number) => `+2010${tag.replace(/\D/g, '').padEnd(4, '7').slice(0, 4)}${String(i).padStart(4, '0')}`;
  const call = (who: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url: `/v1${url}`, headers: { authorization: `Bearer ${tokens[who]}` }, payload });
  const tok = (u: { id: string; role: string; tenantId: string | null }) => generateToken({ sub: u.id, role: u.role, facultyId: u.tenantId! });

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const db = getDb();
    const [tenant] = await db.insert(tenants).values({ slug: `usr-${tag}`, nameAr: 'معهد' }).returning();
    const [other] = await db.insert(tenants).values({ slug: `usx-${tag}`, nameAr: 'معهد آخر' }).returning();
    const mk = async (tenantId: string, role: typeof users.$inferInsert['role'], name: string, extra: Partial<typeof users.$inferInsert> = {}) =>
      (await db.insert(users).values({ tenantId, role, displayNameAr: name, ...extra }).returning())[0];
    const dean = await mk(tenant.id, 'dean', 'العميدة', { email: `dean-${tag}@x.test` });
    const otherDean = await mk(tenant.id, 'dean', 'عميدة ثانية', { email: `dean2-${tag}@x.test` });
    const operator = await mk(tenant.id, 'operator', 'مشغّل المنصة', { email: `op-${tag}@x.test` });
    const advisor = await mk(tenant.id, 'advisor', 'المرشدة', { email: `adv-${tag}@x.test` });
    const teacher = await mk(tenant.id, 'lecturer', 'المعلمة', { email: `t-${tag}@x.test` });
    const foreignDean = await mk(other.id, 'dean', 'عميدة معهد آخر', { email: `fd-${tag}@x.test` });
    const foreignStudent = await mk(other.id, 'student', 'طالبة من معهد آخر', { whatsappE164: n(900) });
    const student = await mk(tenant.id, 'student', 'أسماء', { whatsappE164: n(1) });
    const [halaqa] = await db.insert(sections).values({ tenantId: tenant.id, nameAr: 'حلقة', joinCode: `U${tag.toUpperCase().slice(0, 6)}`, teacherId: teacher.id, maxStudents: 3 }).returning();
    const [small] = await db.insert(sections).values({ tenantId: tenant.id, nameAr: 'حلقة صغيرة', joinCode: `V${tag.toUpperCase().slice(0, 6)}`, teacherId: teacher.id, maxStudents: 1 }).returning();
    const [foreignHalaqa] = await db.insert(sections).values({ tenantId: other.id, nameAr: 'حلقة أخرى', joinCode: `W${tag.toUpperCase().slice(0, 6)}`, teacherId: foreignDean.id }).returning();
    await db.insert(sectionEnrollments).values({ sectionId: halaqa.id, studentId: student.id });
    Object.assign(ids, { tenant: tenant.id, dean: dean.id, otherDean: otherDean.id, teacher: teacher.id, student: student.id, halaqa: halaqa.id, small: small.id, foreignHalaqa: foreignHalaqa.id, foreignStudent: foreignStudent.id, operator: operator.id });
    Object.assign(tokens, {
      dean: tok(dean), otherDean: tok(otherDean), operator: tok(operator), advisor: tok(advisor), teacher: tok(teacher), student: tok(student), foreignDean: tok(foreignDean),
    });
  });

  afterAll(async () => {
    await app?.close();
    await closeDb();
  });

  it('is for the institution managers only', async () => {
    for (const who of ['teacher', 'student', 'advisor']) {
      expect((await call(who, 'GET', '/admin/users')).statusCode).toBe(403);
      expect((await call(who, 'POST', '/admin/users', { role: 'student', displayNameAr: 'طالبة', whatsapp: n(50) })).statusCode).toBe(403);
      expect((await call(who, 'GET', '/admin/audit')).statusCode).toBe(403);
    }
  });

  it('lists the institution’s people with what each is attached to, and never the platform’s', async () => {
    const res = (await call('dean', 'GET', '/admin/users')).json();
    const names = res.users.map((u: { displayNameAr: string }) => u.displayNameAr);
    expect(names).toContain('أسماء');
    expect(names).not.toContain('مشغّل المنصة'); // the operator belongs to the platform
    expect(names).not.toContain('طالبة من معهد آخر');
    const asma = res.users.find((u: { id: string }) => u.id === ids.student);
    expect(asma).toMatchObject({ role: 'student', whatsappE164: n(1), active: true, halaqat: [{ id: ids.halaqa, nameAr: 'حلقة' }], guardians: [] });
    expect(res.users.find((u: { id: string }) => u.id === ids.teacher).halaqat.map((h: { nameAr: string }) => h.nameAr)).toEqual(expect.arrayContaining(['حلقة']));
    expect(res.counts).toMatchObject({ student: 1, lecturer: 1, dean: 2, advisor: 1 });
    expect(res.counts.operator).toBeUndefined();
  });

  it('filters by role, by a search and by whether the account is active', async () => {
    const get = async (q: string) => (await call('dean', 'GET', `/admin/users?${q}`)).json();
    expect((await get('role=student')).users.map((u: { id: string }) => u.id)).toEqual([ids.student]);
    expect((await get(`q=${encodeURIComponent('أسما')}`)).total).toBe(1);
    expect((await get(`q=${encodeURIComponent(n(1).slice(0, 9))}`)).users[0].id).toBe(ids.student);
    expect((await get(`q=t-${tag}`)).users[0].id).toBe(ids.teacher);
    expect((await get('active=false')).total).toBe(0);
    expect((await call('dean', 'GET', '/admin/users?active=maybe')).statusCode).toBe(400);
  });

  it('keeps institutions apart', async () => {
    expect((await call('foreignDean', 'GET', '/admin/users')).json().users.map((u: { id: string }) => u.id)).not.toContain(ids.student);
    expect((await call('foreignDean', 'PATCH', `/admin/users/${ids.student}`, { displayNameAr: 'تغيير' })).statusCode).toBe(404);
    expect((await call('dean', 'PATCH', `/admin/users/${ids.foreignStudent}`, { displayNameAr: 'تغيير' })).statusCode).toBe(404);
    expect((await call('dean', 'PUT', `/admin/users/${ids.student}/halaqat/${ids.foreignHalaqa}`)).statusCode).toBe(404);
    expect((await call('dean', 'POST', '/admin/users', { role: 'student', displayNameAr: 'طالبة', whatsapp: n(51), sectionId: ids.foreignHalaqa })).statusCode).toBe(404);
  });

  it('creates a student in a halaqa with her guardian, and a number is only ever used once', async () => {
    const res = await call('dean', 'POST', '/admin/users', {
      role: 'student', displayNameAr: 'بسمة', whatsapp: ` ${n(2).slice(0, 5)} ${n(2).slice(5)} `, sectionId: ids.halaqa, guardian: { displayNameAr: 'والد بسمة', whatsapp: n(3) },
    });
    expect(res.statusCode).toBe(201);
    const made = res.json();
    ids.basma = made.id;
    expect(made).toMatchObject({ role: 'student', whatsappE164: n(2), active: true, halaqat: [{ id: ids.halaqa }], guardians: [{ displayNameAr: 'والد بسمة', whatsappE164: n(3) }] });
    ids.basmaGuardian = made.guardians[0].id;
    expect((await call('dean', 'POST', '/admin/users', { role: 'student', displayNameAr: 'أخرى', whatsapp: n(2) })).statusCode).toBe(409);
    expect((await call('dean', 'POST', '/admin/users', { role: 'student', displayNameAr: 'أخرى', whatsapp: n(900) })).statusCode).toBe(409); // another institution's
    expect((await call('dean', 'POST', '/admin/users', { role: 'student', displayNameAr: 'طالبة', whatsapp: '0100' })).statusCode).toBe(400);
    expect((await call('dean', 'POST', '/admin/users', { role: 'student', displayNameAr: 'طالبة', whatsapp: n(60), guardian: { displayNameAr: 'ولي', whatsapp: n(60) } })).statusCode).toBe(400);
    // A guardian number that is a teacher's account is refused, and no student is left behind.
    await getDb().update(users).set({ whatsappE164: n(70) }).where(eq(users.id, ids.teacher));
    expect((await call('dean', 'POST', '/admin/users', { role: 'student', displayNameAr: 'طالبة', whatsapp: n(61), guardian: { displayNameAr: 'ولي', whatsapp: n(70) } })).statusCode).toBe(409);
    expect((await call('dean', 'GET', `/admin/users?q=${encodeURIComponent(n(61))}`)).json().total).toBe(0);
  });

  it('refuses a student to a full halaqa and leaves nothing behind', async () => {
    await getDb().insert(sectionEnrollments).values({ sectionId: ids.small, studentId: ids.student });
    const res = await call('dean', 'POST', '/admin/users', { role: 'student', displayNameAr: 'طالبة', whatsapp: n(62), sectionId: ids.small });
    expect(res.statusCode).toBe(409);
    expect((await call('dean', 'GET', `/admin/users?q=${encodeURIComponent(n(62))}`)).json().total).toBe(0);
  });

  it('creates a guardian linked to a student, and staff who are invited by email', async () => {
    const guardian = await call('dean', 'POST', '/admin/users', { role: 'mahram', displayNameAr: 'ولي أسماء', whatsapp: n(4), studentId: ids.student });
    expect(guardian.statusCode).toBe(201);
    expect(guardian.json()).toMatchObject({ role: 'mahram', children: [{ id: ids.student }] });
    expect((await call('dean', 'POST', '/admin/users', { role: 'mahram', displayNameAr: 'ولي', whatsapp: n(63), studentId: ids.foreignStudent })).statusCode).toBe(400);

    const staff = await call('dean', 'POST', '/admin/users', { role: 'advisor', displayNameAr: 'مرشدة جديدة', email: `NEW-${tag}@X.test` });
    expect(staff.statusCode).toBe(201);
    expect(staff.json()).toMatchObject({ role: 'advisor', email: `new-${tag}@x.test`, invitation: expect.stringMatching(/sent|skipped|failed/) });
    expect((await call('dean', 'POST', '/admin/users', { role: 'lecturer', displayNameAr: 'معلمة', email: `new-${tag}@x.test` })).statusCode).toBe(409);
    expect((await call('dean', 'POST', '/admin/users', { role: 'lecturer', displayNameAr: 'معلمة' })).statusCode).toBe(400); // no email
    expect((await call('dean', 'POST', '/admin/users', { role: 'superadmin', displayNameAr: 'مدير', email: `sa-${tag}@x.test` })).statusCode).toBe(400);
  });

  it('lets only the platform operator add a dean', async () => {
    expect((await call('dean', 'POST', '/admin/users', { role: 'dean', displayNameAr: 'عميدة جديدة', email: `nd-${tag}@x.test` })).statusCode).toBe(403);
    const res = await call('operator', 'POST', '/admin/users', { role: 'dean', displayNameAr: 'عميدة جديدة', email: `nd-${tag}@x.test` });
    expect(res.statusCode).toBe(201);
    expect(res.json().role).toBe('dean');
  });

  it('corrects a name or a number, but only the contact the account signs in with', async () => {
    expect((await call('dean', 'PATCH', `/admin/users/${ids.basma}`, { displayNameAr: 'بسمة الأحمد', whatsapp: n(5) })).json())
      .toMatchObject({ displayNameAr: 'بسمة الأحمد', whatsappE164: n(5) });
    expect((await call('dean', 'PATCH', `/admin/users/${ids.basma}`, { whatsapp: n(1) })).statusCode).toBe(409); // another account's number
    expect((await call('dean', 'PATCH', `/admin/users/${ids.basma}`, { email: 'a@b.test' })).statusCode).toBe(400);
    expect((await call('dean', 'PATCH', `/admin/users/${ids.teacher}`, { whatsapp: n(71) })).statusCode).toBe(400);
    expect((await call('dean', 'PATCH', `/admin/users/${ids.teacher}`, { email: `dean-${tag}@x.test` })).statusCode).toBe(409);
    expect((await call('dean', 'PATCH', `/admin/users/${ids.teacher}`, { email: `T2-${tag}@x.test` })).json().email).toBe(`t2-${tag}@x.test`);
    expect((await call('dean', 'PATCH', `/admin/users/${ids.basma}`, {})).statusCode).toBe(400);
  });

  it('stops an account at once, even for a session already open, and restores it', async () => {
    expect((await call('student', 'GET', '/auth/me')).statusCode).toBe(200);
    const stopped = await call('dean', 'PATCH', `/admin/users/${ids.student}`, { active: false });
    expect(stopped.json().active).toBe(false);
    expect((await call('student', 'GET', '/auth/me')).statusCode).toBe(401); // her token is still valid, her account is not
    expect((await call('dean', 'GET', '/admin/users?active=false')).json().users.map((u: { id: string }) => u.id)).toEqual([ids.student]);
    expect((await call('dean', 'PUT', `/admin/users/${ids.student}/halaqat/${ids.halaqa}`)).statusCode).toBe(400); // an active student only
    expect((await call('dean', 'PATCH', `/admin/users/${ids.student}`, { active: true })).json().active).toBe(true);
    expect((await call('student', 'GET', '/auth/me')).statusCode).toBe(200);
  });

  it('never stops your own access, and a dean cannot change another dean', async () => {
    expect((await call('dean', 'PATCH', `/admin/users/${ids.dean}`, { active: false })).statusCode).toBe(400);
    expect((await call('dean', 'PATCH', `/admin/users/${ids.otherDean}`, { active: false })).statusCode).toBe(403);
    expect((await call('operator', 'PATCH', `/admin/users/${ids.otherDean}`, { active: false })).json().active).toBe(false);
    expect((await call('operator', 'PATCH', `/admin/users/${ids.otherDean}`, { active: true })).json().active).toBe(true);
    expect((await call('dean', 'PATCH', `/admin/users/${ids.operator}`, { active: false })).statusCode).toBe(404); // the platform's own
  });

  it('changes a staff member’s role, and it applies at once, to a session already open', async () => {
    const role = (who: string, id: string, to: string) => call(who, 'PATCH', `/admin/users/${id}`, { role: to });
    expect((await call('advisor', 'GET', '/admin/users')).statusCode).toBe(403);
    expect((await role('dean', ids.teacher, 'advisor')).statusCode).toBe(409); // she leads halaqat: hand them over first
    expect((await role('dean', ids.student, 'advisor')).statusCode).toBe(400); // students and guardians do not change role
    expect((await role('dean', ids.dean, 'lecturer')).statusCode).toBe(400); // not your own
    expect((await call('dean', 'PATCH', `/admin/users/${ids.teacher}`, { role: 'superadmin' })).statusCode).toBe(400); // not a role to give
    expect((await role('dean', ids.teacher, 'dean')).statusCode).toBe(403); // only the operator makes a dean
    // The operator makes the advisor a dean: her old token (which says advisor) opens the admin screens straight away.
    const [advisor] = await getDb().select().from(users).where(and(eq(users.displayNameAr, 'المرشدة'), eq(users.tenantId, ids.tenant)));
    const promoted = await role('operator', advisor.id, 'dean');
    expect(promoted.json().role).toBe('dean');
    expect((await call('advisor', 'GET', '/admin/users')).statusCode).toBe(200);
    // And back: the dean's access goes as fast.
    expect((await role('dean', advisor.id, 'lecturer')).statusCode).toBe(403); // a dean is changed by the operator only
    expect((await role('operator', advisor.id, 'advisor')).json().role).toBe('advisor');
    expect((await call('advisor', 'GET', '/admin/users')).statusCode).toBe(403);
    // A role to a teaching role needs no hand-over, and the same role changes nothing.
    expect((await role('dean', advisor.id, 'muhaffiza')).json().role).toBe('muhaffiza');
    expect((await role('dean', advisor.id, 'muhaffiza')).statusCode).toBe(200);
    const entries = (await call('dean', 'GET', '/admin/audit?action=user.role_changed')).json().entries;
    expect(entries).toHaveLength(3);
    expect(entries[0].details).toMatchObject({ from: 'advisor', to: 'muhaffiza' });
    await role('operator', advisor.id, 'advisor');
  });

  it('puts a student in a halaqa and takes her out, keeping her record', async () => {
    const db = getDb();
    const joined = await call('dean', 'PUT', `/admin/users/${ids.basma}/halaqat/${ids.small}`);
    expect(joined.statusCode).toBe(409); // that halaqa is full (one place, taken)
    const left = await call('dean', 'DELETE', `/admin/users/${ids.student}/halaqat/${ids.small}`);
    expect(left.json().halaqat.map((h: { id: string }) => h.id)).toEqual([ids.halaqa]);
    const [row] = await db.select().from(sectionEnrollments).where(and(eq(sectionEnrollments.sectionId, ids.small), eq(sectionEnrollments.studentId, ids.student)));
    expect(row.droppedAt).not.toBeNull(); // dropped, not deleted
    const moved = await call('dean', 'PUT', `/admin/users/${ids.basma}/halaqat/${ids.small}`);
    expect(moved.json().halaqat.map((h: { id: string }) => h.id).sort()).toEqual([ids.halaqa, ids.small].sort());
    // Putting her in again changes nothing.
    expect((await call('dean', 'PUT', `/admin/users/${ids.basma}/halaqat/${ids.small}`)).statusCode).toBe(200);
    expect(await db.select().from(sectionEnrollments).where(and(eq(sectionEnrollments.studentId, ids.basma), isNull(sectionEnrollments.droppedAt)))).toHaveLength(2);
    expect((await call('dean', 'PUT', `/admin/users/${ids.teacher}/halaqat/${ids.halaqa}`)).statusCode).toBe(400); // students only
  });

  it('links and unlinks guardians', async () => {
    const linked = await call('dean', 'POST', `/admin/users/${ids.student}/guardians`, { displayNameAr: 'عمة أسماء', whatsapp: n(6) });
    expect(linked.json().guardians.map((g: { whatsappE164: string }) => g.whatsappE164)).toEqual(expect.arrayContaining([n(4), n(6)]));
    // The same number again links nothing new.
    expect((await call('dean', 'POST', `/admin/users/${ids.student}/guardians`, { displayNameAr: 'عمة أسماء', whatsapp: n(6) })).json().guardians).toHaveLength(2);
    // An existing guardian can be linked to a second student.
    expect((await call('dean', 'POST', `/admin/users/${ids.basma}/guardians`, { displayNameAr: 'عمة أسماء', whatsapp: n(6) })).json().guardians.map((g: { whatsappE164: string }) => g.whatsappE164)).toContain(n(6));
    expect((await call('dean', 'POST', `/admin/users/${ids.student}/guardians`, { displayNameAr: 'معلمة', whatsapp: n(70) })).statusCode).toBe(409);
    expect((await call('dean', 'POST', `/admin/users/${ids.student}/guardians`, { displayNameAr: 'نفسها', whatsapp: n(1) })).statusCode).toBe(400);
    expect((await call('dean', 'POST', `/admin/users/${ids.teacher}/guardians`, { displayNameAr: 'ولي', whatsapp: n(64) })).statusCode).toBe(400);

    const [guardian] = await getDb().select().from(users).where(eq(users.whatsappE164, n(6)));
    const removed = await call('dean', 'DELETE', `/admin/users/${ids.student}/guardians/${guardian.id}`);
    expect(removed.json().guardians.map((g: { whatsappE164: string }) => g.whatsappE164)).toEqual([n(4)]);
    expect(await getDb().select().from(users).where(eq(users.id, guardian.id))).toHaveLength(1); // her account stays, and her other link
    expect(await getDb().select().from(guardianLinks).where(eq(guardianLinks.guardianId, guardian.id))).toHaveLength(1);
  });

  it('adds a class in bulk, each row on its own', async () => {
    const rows = [
      { displayNameAr: 'منى', whatsapp: n(10) },
      { displayNameAr: 'هدى', whatsapp: `${n(11).slice(0, 5)} ${n(11).slice(5)}` },
      { displayNameAr: 'منى مكررة', whatsapp: n(10) },     // the same number twice in the list
      { displayNameAr: 'أسماء', whatsapp: n(1) },            // already has an account, in this halaqa
      { displayNameAr: 'بسمة الأحمد', whatsapp: n(5) },      // has an account, in the halaqa too
      { displayNameAr: 'س', whatsapp: n(12) },               // name too short
      { displayNameAr: 'بلا رقم', whatsapp: '123' },
      { displayNameAr: 'ولي', whatsapp: n(4) },              // a guardian's number
    ];
    const res = (await call('dean', 'POST', '/admin/users/students/bulk', { students: rows })).json();
    expect(res.results.map((r: { status: string }) => r.status)).toEqual(['created', 'created', 'exists', 'exists', 'exists', 'invalid', 'invalid', 'invalid']);
    expect(res).toMatchObject({ created: 2, enrolled: 0, exists: 3, failed: 3 });
    const again = (await call('dean', 'POST', '/admin/users/students/bulk', { students: rows.slice(0, 2) })).json();
    expect(again.results.map((r: { status: string }) => r.status)).toEqual(['exists', 'exists']);
  });

  it('puts bulk students in a halaqa until it is full', async () => {
    const res = (await call('dean', 'POST', '/admin/users/students/bulk', {
      sectionId: ids.halaqa,
      students: [{ displayNameAr: 'منى', whatsapp: n(10) }, { displayNameAr: 'هدى', whatsapp: n(11) }, { displayNameAr: 'جديدة', whatsapp: n(13) }, { displayNameAr: 'أخرى', whatsapp: n(14) }],
    })).json();
    // The halaqa holds three: أسماء and بسمة are in; منى fits; the rest do not.
    expect(res.results.map((r: { status: string }) => r.status)).toEqual(['enrolled', 'full', 'full', 'full']);
    expect(res).toMatchObject({ created: 0, enrolled: 1, failed: 3 });
    expect((await call('dean', 'POST', '/admin/users/students/bulk', { sectionId: ids.foreignHalaqa, students: [{ displayNameAr: 'منى', whatsapp: n(10) }] })).statusCode).toBe(404);
    expect((await call('dean', 'POST', '/admin/users/students/bulk', { students: [] })).statusCode).toBe(400);
  });

  it('pages through the directory', async () => {
    const first = (await call('dean', 'GET', '/admin/users?offset=0')).json();
    expect(first.pageSize).toBe(50);
    expect(first.total).toBeGreaterThan(10);
    expect((await call('dean', 'GET', `/admin/users?offset=${first.total}`)).json().users).toEqual([]);
  });

  it('shows who did what, newest first, with names and no outsiders’ entries', async () => {
    const res = (await call('dean', 'GET', '/admin/audit')).json();
    expect(res.entries.length).toBeGreaterThan(5);
    const created = res.entries.find((e: { action: string; actorId: string }) => e.action === 'user.created' && e.actorId === ids.dean);
    expect(created).toMatchObject({ actorName: 'العميدة', actorRole: 'dean', resource: 'user', details: { role: expect.any(String) } });
    expect(created).not.toHaveProperty('ipAddress');
    const times = res.entries.map((e: { at: string }) => Date.parse(e.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(res.actions).toEqual(expect.arrayContaining(['user.created', 'user.stopped', 'user.restored', 'user.updated', 'users.bulk_added', 'guardian.linked', 'guardian.unlinked']));
    expect((await call('dean', 'GET', '/admin/audit?action=user.stopped')).json().entries.every((e: { action: string }) => e.action === 'user.stopped')).toBe(true);
    expect((await call('dean', 'GET', `/admin/audit?actorId=${ids.dean}`)).json().entries.every((e: { actorId: string }) => e.actorId === ids.dean)).toBe(true);
    expect((await call('foreignDean', 'GET', '/admin/audit')).json().entries).toEqual([]);
  });

  it('pages the audit log with a cursor', async () => {
    const first = (await call('dean', 'GET', '/admin/audit?limit=3')).json();
    expect(first.entries).toHaveLength(3);
    expect(first.nextBefore).not.toBeNull();
    const second = (await call('dean', 'GET', `/admin/audit?limit=3&before=${encodeURIComponent(first.nextBefore)}`)).json();
    expect(second.entries.length).toBeGreaterThan(0);
    expect(Date.parse(second.entries[0].at)).toBeLessThan(Date.parse(first.nextBefore) + 1);
    const ids1 = new Set(first.entries.map((e: { id: string }) => e.id));
    expect(second.entries.every((e: { id: string }) => !ids1.has(e.id))).toBe(true);
    expect((await call('dean', 'GET', '/admin/audit?limit=500')).statusCode).toBe(400);
  });
});
