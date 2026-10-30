/**
 * End-to-end API tests for the pilot loop: sign-in, the student's daily queue,
 * the teacher's roster, attendance with guardian alerts, the guardian portal
 * and tasmi' review. Runs against the Postgres in DATABASE_URL (migrated).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../server';
import { closeDb, getDb } from '../db';
import {
  tenants, users, sections, sectionEnrollments, guardianLinks, studentCards, tasmiSubmissions, notifications,
} from '../db/schema';
import { eq } from 'drizzle-orm';
import { setWhatsAppTransport, type WhatsAppMessage } from '../lib/whatsapp';
import { setEmailTransport, type EmailMessage } from '../lib/email';
import { localDate } from '../lib/dates';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('phase 1 pilot loop', () => {
  let app: FastifyInstance;
  const whatsapp: WhatsAppMessage[] = [];
  const emails: EmailMessage[] = [];

  // Unique per run so tests never collide with seed data or earlier runs.
  const tag = randomUUID().slice(0, 8);
  const phone = (n: number) => `+2010${tag.replace(/\D/g, '').padEnd(6, '7').slice(0, 6)}${String(n).padStart(2, '0')}`;
  const joinCode = `T${tag.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7)}`;
  const ids: Record<string, string> = {};

  const lastOtp = (to: string) => {
    const msg = [...whatsapp].reverse().find((m) => m.to === to && m.template === 'otp');
    if (!msg) throw new Error(`no OTP sent to ${to}`);
    return msg.params[0];
  };

  async function login(number: string, extra: Record<string, string> = {}) {
    const req = await app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { whatsapp: number, ...extra } });
    expect(req.statusCode, req.body).toBe(200);
    const res = await app.inject({
      method: 'POST', url: '/v1/auth/otp/verify',
      payload: { whatsapp: number, code: lastOtp(number), ...extra },
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as { token: string; refreshToken: string; user: { id: string; role: string }; isNewUser: boolean };
  }

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    setWhatsAppTransport(async (m) => { whatsapp.push(m); return { status: 'sent', messageId: `wamid.${whatsapp.length}` }; });
    setEmailTransport(async (m) => { emails.push(m); return { status: 'sent' }; });
    app = await buildApp();
    await app.ready();

    const db = getDb();
    const [tenant] = await db.insert(tenants).values({ slug: `test-${tag}`, nameAr: 'معهد الاختبار' }).returning();
    const [other] = await db.insert(tenants).values({ slug: `other-${tag}`, nameAr: 'معهد آخر' }).returning();
    const [teacher] = await db.insert(users).values({
      tenantId: tenant.id, role: 'lecturer', displayNameAr: 'المعلمة', email: `teacher-${tag}@test.local`,
    }).returning();
    const [outsider] = await db.insert(users).values({
      tenantId: other.id, role: 'lecturer', displayNameAr: 'معلمة أخرى', email: `outsider-${tag}@test.local`,
    }).returning();
    const [section] = await db.insert(sections).values({
      tenantId: tenant.id, nameAr: 'حلقة الاختبار', joinCode, teacherId: teacher.id,
    }).returning();
    const [student] = await db.insert(users).values({
      tenantId: tenant.id, role: 'student', displayNameAr: 'طالبة قائمة', whatsappE164: phone(1),
    }).returning();
    await db.insert(sectionEnrollments).values({ sectionId: section.id, studentId: student.id });
    const [guardian] = await db.insert(users).values({
      tenantId: tenant.id, role: 'mahram', displayNameAr: 'ولي الأمر', whatsappE164: phone(2),
    }).returning();
    await db.insert(guardianLinks).values({ studentId: student.id, guardianId: guardian.id });
    const [card] = await db.insert(studentCards).values({
      studentId: student.id, ayahRef: '2:1', state: 'review', stability: 3, reps: 2,
      dueAt: new Date(Date.now() - 3_600_000), lastReviewedAt: new Date(Date.now() - 3 * 86_400_000),
    }).returning();
    const [tasmi] = await db.insert(tasmiSubmissions).values({
      studentId: student.id, sectionId: section.id, startRef: '2:1', endRef: '2:5', audioUrl: 'https://audio.test/1.webm',
    }).returning();

    Object.assign(ids, {
      tenant: tenant.id, teacher: teacher.id, outsider: outsider.id, section: section.id,
      student: student.id, guardian: guardian.id, card: card.id, tasmi: tasmi.id,
    });
  });

  afterAll(async () => {
    setWhatsAppTransport(null);
    setEmailTransport(null);
    await app?.close();
    await closeDb();
  });

  async function teacherToken(email = `teacher-${tag}@test.local`) {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/magic-link', payload: { email } });
    expect(res.statusCode).toBe(200);
    const mail = [...emails].reverse().find((m) => m.to === email);
    const token = decodeURIComponent(mail!.text.match(/token=([^\s]+)/)![1]);
    const verify = await app.inject({ method: 'POST', url: '/v1/auth/magic-link/verify', payload: { token } });
    expect(verify.statusCode, verify.body).toBe(200);
    return { access: verify.json().token as string, linkToken: token };
  }

  describe('sign-in', () => {
    it('refuses an unknown number without a join code', async () => {
      const res = await app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { whatsapp: phone(50) } });
      expect(res.statusCode).toBe(404);
      expect(whatsapp.some((m) => m.to === phone(50))).toBe(false);
    });

    it('signs up a new student with a join code and enrolls her', async () => {
      const session = await login(phone(3), { joinCode });
      expect(session.isNewUser).toBe(true);
      expect(session.user.role).toBe('student');

      const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: auth(session.token) });
      expect(me.json().sections.map((s: { id: string }) => s.id)).toContain(ids.section);

      const named = await app.inject({
        method: 'PATCH', url: '/v1/auth/me', headers: auth(session.token), payload: { displayNameAr: 'هاجر' },
      });
      expect(named.json().user.displayNameAr).toBe('هاجر');
    });

    it('rejects a wrong code and locks the code after three attempts', async () => {
      await app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { whatsapp: phone(1) } });
      const good = lastOtp(phone(1));
      const bad = good === '1111' ? '2222' : '1111';
      for (let i = 0; i < 3; i++) {
        const res = await app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { whatsapp: phone(1), code: bad } });
        expect(res.statusCode).toBe(400);
      }
      const late = await app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { whatsapp: phone(1), code: good } });
      expect(late.statusCode).toBe(400);
    });

    it('does not accept a refresh token as an access token, but exchanges it', async () => {
      const session = await login(phone(1));
      const misuse = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: auth(session.refreshToken) });
      expect(misuse.statusCode).toBe(401);

      const refreshed = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: session.refreshToken } });
      expect(refreshed.statusCode).toBe(200);
      expect(refreshed.json().token).toBeTruthy();
    });

    it('signs staff in with a one-time magic link', async () => {
      const { access, linkToken } = await teacherToken();
      const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: auth(access) });
      expect(me.json().user.id).toBe(ids.teacher);

      const reuse = await app.inject({ method: 'POST', url: '/v1/auth/magic-link/verify', payload: { token: linkToken } });
      expect(reuse.statusCode).toBe(401);
    });

    it('does not reveal whether a staff email exists', async () => {
      const before = emails.length;
      const res = await app.inject({ method: 'POST', url: '/v1/auth/magic-link', payload: { email: `nobody-${tag}@test.local` } });
      expect(res.statusCode).toBe(200);
      expect(emails.length).toBe(before);
    });
  });

  describe('student', () => {
    it('gets her queue, rates a card and starts a streak', async () => {
      const { token } = await login(phone(1));
      const queue = await app.inject({ method: 'GET', url: '/v1/scheduler/queue', headers: auth(token) });
      expect(queue.statusCode).toBe(200);
      const items = [...queue.json().queue.manzil.items, ...queue.json().queue.sabqi.items];
      expect(items.map((i: { card: { id: string } }) => i.card.id)).toContain(ids.card);

      const rated = await app.inject({
        method: 'POST', url: '/v1/scheduler/rate', headers: auth(token), payload: { cardId: ids.card, rating: 'good' },
      });
      expect(rated.statusCode, rated.body).toBe(200);
      expect(rated.json().streak.currentStreak).toBeGreaterThanOrEqual(1);
      expect(rated.json().streak.lastActiveDate).toBe(localDate());
    });

    it('cannot read another student’s report', async () => {
      const { token } = await login(phone(3), { joinCode });
      const res = await app.inject({ method: 'GET', url: `/v1/reports/student/${ids.student}`, headers: auth(token) });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('teacher', () => {
    it('sees her halaqa roster with progress, but not another institution’s', async () => {
      const { access } = await teacherToken();
      const res = await app.inject({ method: 'GET', url: `/v1/sections/${ids.section}/students`, headers: auth(access) });
      expect(res.statusCode).toBe(200);
      const row = res.json().students.find((s: { studentId: string }) => s.studentId === ids.student);
      expect(row).toBeTruthy();
      expect(res.json().summary.totalStudents).toBeGreaterThanOrEqual(1);

      const { access: outsider } = await teacherToken(`outsider-${tag}@test.local`);
      const blocked = await app.inject({ method: 'GET', url: `/v1/sections/${ids.section}/students`, headers: auth(outsider) });
      expect(blocked.statusCode).toBe(404);
    });

    it('marks an absence and alerts the guardian once', async () => {
      const { access } = await teacherToken();
      const date = localDate();
      const payload = { date, records: [{ studentId: ids.student, present: false }] };

      const first = await app.inject({ method: 'PUT', url: `/v1/sections/${ids.section}/attendance`, headers: auth(access), payload });
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json().alerts.sent).toBe(1);
      const alert = whatsapp.find((m) => m.template === 'absence_alert' && m.to === phone(2));
      expect(alert?.params?.slice(0, 2)).toEqual(['طالبة قائمة', 'حلقة الاختبار']);
      expect(alert?.params?.[2]).toMatch(/\p{Script=Arabic}/u);

      const again = await app.inject({ method: 'PUT', url: `/v1/sections/${ids.section}/attendance`, headers: auth(access), payload });
      expect(again.json().alerts.sent).toBe(0);

      const stored = await getDb().select().from(notifications).where(eq(notifications.userId, ids.guardian));
      expect(stored).toHaveLength(1);

      const day = await app.inject({ method: 'GET', url: `/v1/sections/${ids.section}/attendance?date=${date}`, headers: auth(access) });
      const mark = day.json().records.find((r: { studentId: string }) => r.studentId === ids.student);
      expect(mark.present).toBe(false);
    });

    it('rejects attendance for a future date', async () => {
      const { access } = await teacherToken();
      const res = await app.inject({
        method: 'PUT', url: `/v1/sections/${ids.section}/attendance`, headers: auth(access),
        payload: { date: '2999-01-01', records: [{ studentId: ids.student, present: true }] },
      });
      expect(res.statusCode).toBe(400);
    });

    it('reviews a pending tasmi’ submission from her halaqa', async () => {
      const { access } = await teacherToken();
      const pending = await app.inject({ method: 'GET', url: '/v1/tasmi/pending', headers: auth(access) });
      expect(pending.json().map((p: { id: string }) => p.id)).toContain(ids.tasmi);

      const review = await app.inject({
        method: 'POST', url: `/v1/tasmi/${ids.tasmi}/review`, headers: auth(access),
        payload: { hifzScore: 90, tajweedScore: 80, fluencyScore: 70, verdict: 'approved' },
      });
      expect(review.statusCode, review.body).toBe(200);
      expect(review.json().reviewWeightedTotal).toBe(83);

      const { access: outsider } = await teacherToken(`outsider-${tag}@test.local`);
      const blocked = await app.inject({
        method: 'POST', url: `/v1/tasmi/${ids.tasmi}/review`, headers: auth(outsider),
        payload: { hifzScore: 0, tajweedScore: 0, fluencyScore: 0, verdict: 'redo' },
      });
      expect(blocked.statusCode).toBe(404);
    });

    it('links a guardian by WhatsApp number', async () => {
      const { access } = await teacherToken();
      const res = await app.inject({
        method: 'POST', url: `/v1/sections/${ids.section}/students/${ids.student}/guardians`, headers: auth(access),
        payload: { displayNameAr: 'أم الطالبة', whatsapp: phone(4) },
      });
      expect(res.statusCode, res.body).toBe(200);
      const list = await app.inject({
        method: 'GET', url: `/v1/sections/${ids.section}/students/${ids.student}/guardians`, headers: auth(access),
      });
      expect(list.json().map((g: { whatsappE164: string }) => g.whatsappE164)).toContain(phone(4));
    });
  });

  describe('guardian', () => {
    it('sees her linked student’s weekly report and nobody else’s', async () => {
      const { token, user } = await login(phone(2));
      expect(user.role).toBe('mahram');

      const res = await app.inject({ method: 'GET', url: '/v1/guardian/students', headers: auth(token) });
      expect(res.statusCode).toBe(200);
      const [report] = res.json().students;
      expect(report.student.id).toBe(ids.student);
      expect(report.attendance.absent).toBeGreaterThanOrEqual(1);
      expect(report.week.start <= localDate() && localDate() <= report.week.end).toBe(true);

      const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: auth(token) });
      const other = (await login(phone(3), { joinCode })).user.id;
      expect(me.statusCode).toBe(200);
      const blocked = await app.inject({ method: 'GET', url: `/v1/reports/student/${other}/weekly`, headers: auth(token) });
      expect(blocked.statusCode).toBe(404);
    });
  });
});
