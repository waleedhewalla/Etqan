/** Plan limits: what is reported always, what is enforced only in 'block' mode, and the AI-checking gate. */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { buildApp } from '../server';
import { closeDb, getDb } from '../db';
import { sectionEnrollments, sections, tenants, users } from '../db/schema';
import { config } from '../config';
import { generateToken } from '../lib/jwt';
import { setWhatsAppTransport, type WhatsAppMessage } from '../lib/whatsapp';
import { limitState, planExpired, planFeatures, planIncludes } from '../lib/plan';
import { setAsrProvider } from '../lib/asr';
import { isCheckEnabled } from '../lib/asr/runner';
import { consents } from '../db/schema';

const mode = (m: 'warn' | 'block') => { (config as { PLAN_ENFORCEMENT: string }).PLAN_ENFORCEMENT = m; };
const day = 86_400_000;

describe('plan rules', () => {
  it('reports how close a limit is', () => {
    expect(limitState(5, 10)).toBe('ok');
    expect(limitState(9, 10)).toBe('near');
    expect(limitState(10, 10)).toBe('full');
    expect(limitState(11, 10)).toBe('over');
    expect(limitState(0, 0)).toBe('ok');
  });

  it('knows when a plan has expired', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    expect(planExpired({ planValidUntil: null }, now)).toBe(false);
    expect(planExpired({ planValidUntil: new Date('2026-07-01') }, now)).toBe(false);
    expect(planExpired({ planValidUntil: new Date('2026-05-01') }, now)).toBe(true);
  });

  it('includes what the tier includes plus extras, and nothing once expired', () => {
    const base = { planFeatures: [] as string[], planValidUntil: null };
    expect(planIncludes({ ...base, planTier: 'free' }, 'ai_checking')).toBe(false);
    expect(planIncludes({ ...base, planTier: 'madrasa_basic' }, 'ai_checking')).toBe(false);
    expect(planIncludes({ ...base, planTier: 'madrasa_pro' }, 'ai_checking')).toBe(true);
    expect(planIncludes({ ...base, planTier: 'enterprise' }, 'ai_checking')).toBe(true);
    expect(planIncludes({ planTier: 'free', planFeatures: ['ai_checking'], planValidUntil: null }, 'ai_checking')).toBe(true);
    expect([...planFeatures({ planTier: 'madrasa_pro', planFeatures: [], planValidUntil: new Date(Date.now() - day) })]).toEqual([]);
  });
});

describe.skipIf(!process.env.DATABASE_URL)('plan enforcement', () => {
  let app: FastifyInstance;
  const whatsapp: WhatsAppMessage[] = [];
  const tag = randomUUID().slice(0, 8);
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const auth = (who: string) => ({ authorization: `Bearer ${tokens[who]}` });
  const phone = (n: number) => `+2011${tag.replace(/\D/g, '').padEnd(5, '3').slice(0, 5)}${String(n).padStart(2, '0')}`;
  const code = (prefix: string) => `${prefix}${tag.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)}`;
  const setPlan = (patch: Partial<typeof tenants.$inferInsert>) => getDb().update(tenants).set(patch).where(eq(tenants.id, ids.tenant));

  async function signUp(number: string, joinCode: string) {
    await app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { whatsapp: number, joinCode } });
    const msg = [...whatsapp].reverse().find((m) => m.to === number && m.template === 'otp');
    return app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { whatsapp: number, code: msg!.params[0], joinCode, displayNameAr: 'طالبة جديدة' } });
  }

  beforeAll(async () => {
    setWhatsAppTransport(async (m) => { whatsapp.push(m); return { status: 'sent', messageId: 'x' }; });
    app = await buildApp();
    await app.ready();
    const db = getDb();
    const [tenant] = await db.insert(tenants).values({
      slug: `plan-${tag}`, nameAr: 'معهد الخطة', planTier: 'madrasa_pro', planMaxStudents: 2, planMaxHalaqat: 2,
    }).returning();
    const mk = async (role: typeof users.$inferInsert['role'], name: string, whatsappE164?: string) =>
      (await db.insert(users).values({ tenantId: tenant.id, role, displayNameAr: name, whatsappE164 }).returning())[0];
    const teacher = await mk('lecturer', 'المعلمة');
    const dean = await mk('dean', 'العميدة');
    const first = await mk('student', 'الأولى', phone(1));
    const outsider = await mk('student', 'خارج الحلقات', phone(2));
    const [s1] = await db.insert(sections).values({ tenantId: tenant.id, nameAr: 'حلقة ١', joinCode: code('P1'), teacherId: teacher.id }).returning();
    const [s2] = await db.insert(sections).values({ tenantId: tenant.id, nameAr: 'حلقة ٢', joinCode: code('P2'), teacherId: teacher.id }).returning();
    await db.insert(sectionEnrollments).values({ sectionId: s1.id, studentId: first.id }); // 1 of 2 seats used
    Object.assign(ids, { tenant: tenant.id, s1: s1.id, s2: s2.id, first: first.id, outsider: outsider.id });
    const tok = (u: { id: string; role: string }) => generateToken({ sub: u.id, role: u.role, facultyId: tenant.id });
    Object.assign(tokens, { teacher: tok(teacher), dean: tok(dean), first: tok(first), outsider: tok(outsider) });
  });

  afterEach(() => mode('warn'));

  afterAll(async () => {
    mode('warn');
    setWhatsAppTransport(null);
    setAsrProvider(undefined);
    await app?.close();
    await closeDb();
  });

  const overview = async () => (await app.inject({ method: 'GET', url: '/v1/admin/overview', headers: auth('dean') })).json().institution.plan;
  const createHalaqa = (name: string) => app.inject({ method: 'POST', url: '/v1/sections', headers: auth('teacher'), payload: { nameAr: name, maxStudents: 25 } });
  const joinAs = (who: string, joinCode: string) => app.inject({ method: 'POST', url: '/v1/sections/join', headers: auth(who), payload: { code: joinCode } });

  it('reports usage against the limits whatever the mode', async () => {
    const plan = await overview();
    expect(plan.status).toMatchObject({
      enforcement: 'warn', expired: false,
      students: { used: 1, limit: 2, state: 'ok' }, halaqat: { used: 2, limit: 2, state: 'full' },
    });
    expect(plan.features).toEqual(['ai_checking', 'analytics', 'priority_support']);
  });

  describe("in 'warn' mode", () => {
    it('lets an institution go past its limits and says it is over', async () => {
      expect((await createHalaqa('حلقة زائدة')).statusCode).toBe(200);
      expect((await overview()).status.halaqat.state).toBe('over');
      await setPlan({ planValidUntil: new Date(Date.now() - day) });
      expect((await createHalaqa('بعد الانتهاء')).statusCode).toBe(200);
      const plan = await overview();
      expect(plan.status.expired).toBe(true);
      expect(plan.features).toEqual([]);
      await setPlan({ planValidUntil: null });
    });
  });

  describe("in 'block' mode", () => {
    it('stops a full institution creating another halaqa, and an expired one too', async () => {
      mode('block');
      await getDb().delete(sections).where(and(eq(sections.tenantId, ids.tenant), eq(sections.nameAr, 'حلقة زائدة')));
      await getDb().delete(sections).where(and(eq(sections.tenantId, ids.tenant), eq(sections.nameAr, 'بعد الانتهاء')));
      const full = await createHalaqa('ثالثة');
      expect(full.statusCode).toBe(403);
      expect(full.json().code).toBe('PLAN_LIMIT_REACHED');

      await setPlan({ planMaxHalaqat: 5, planValidUntil: new Date(Date.now() - day) });
      expect((await createHalaqa('منتهية')).json().code).toBe('PLAN_LIMIT_REACHED');
      await setPlan({ planValidUntil: null });
      expect((await createHalaqa('مسموحة')).statusCode).toBe(200);
      await setPlan({ planMaxHalaqat: 2 });
    });

    it('lets students in until the seats are used, then refuses a new student without leaving an account behind', async () => {
      mode('block');
      expect((await joinAs('outsider', code('P1'))).statusCode).toBe(200); // second seat
      const refused = await signUp(phone(3), code('P1'));
      expect(refused.statusCode).toBe(403);
      expect(refused.json().code).toBe('PLAN_LIMIT_REACHED');
      const left = await getDb().select().from(users).where(eq(users.whatsappE164, phone(3)));
      expect(left).toEqual([]);

      // a signed-in student without a seat is refused the same way
      await getDb().update(sectionEnrollments).set({ droppedAt: new Date() }).where(eq(sectionEnrollments.studentId, ids.outsider));
      const [extra] = await getDb().insert(users).values({ tenantId: ids.tenant, role: 'student', displayNameAr: 'ثالثة', whatsappE164: phone(4) }).returning();
      await getDb().insert(sectionEnrollments).values({ sectionId: ids.s1, studentId: extra.id });
      expect((await joinAs('outsider', code('P2'))).statusCode).toBe(403);
    });

    it('does not count a student who already has a seat when she joins a second halaqa', async () => {
      mode('block');
      expect((await joinAs('first', code('P2'))).statusCode).toBe(200);
    });

    it('never locks out students already learning', async () => {
      mode('block');
      await setPlan({ planValidUntil: new Date(Date.now() - day), planMaxStudents: 1 });
      const me = await app.inject({ method: 'GET', url: '/v1/scheduler/queue', headers: auth('first') });
      expect(me.statusCode).toBe(200);
      await setPlan({ planValidUntil: null, planMaxStudents: 2 });
    });
  });

  describe('AI checking is part of the plan', () => {
    const provider = { name: 'test', transcribe: async () => ({ text: '' }) };

    it('runs only when the plan includes it, in either mode', async () => {
      setAsrProvider(provider);
      await setPlan({ settings: { aiChecking: true } });
      await getDb().insert(consents).values({ userId: ids.first, purpose: 'ai_processing', grantedAt: new Date() }).onConflictDoNothing();
      for (const m of ['warn', 'block'] as const) {
        mode(m);
        await setPlan({ planTier: 'madrasa_pro' });
        expect(await isCheckEnabled(getDb(), ids.tenant, ids.first), m).toBe(true);
        await setPlan({ planTier: 'free' });
        expect(await isCheckEnabled(getDb(), ids.tenant, ids.first), m).toBe(false);
      }
      await setPlan({ planTier: 'free', planFeatures: ['ai_checking'] });
      expect(await isCheckEnabled(getDb(), ids.tenant, ids.first)).toBe(true);
      await setPlan({ planTier: 'madrasa_pro', planFeatures: [], planValidUntil: new Date(Date.now() - day) });
      expect(await isCheckEnabled(getDb(), ids.tenant, ids.first)).toBe(false);
      await setPlan({ planValidUntil: null });
    });

    it('is reported to the institution and cannot be switched on without it', async () => {
      setAsrProvider(provider);
      const status = (who: string) => app.inject({ method: 'GET', url: '/v1/voice/status', headers: auth(who) });
      await setPlan({ planTier: 'free', settings: { aiChecking: true } });
      expect((await status('dean')).json()).toMatchObject({ available: true, included: false, enabled: false });
      const refused = await app.inject({ method: 'PUT', url: '/v1/voice/institution', headers: auth('dean'), payload: { enabled: true } });
      expect(refused.statusCode).toBe(403);
      expect(refused.json().code).toBe('PLAN_FEATURE_NOT_INCLUDED');
      // switching it OFF is always allowed
      expect((await app.inject({ method: 'PUT', url: '/v1/voice/institution', headers: auth('dean'), payload: { enabled: false } })).statusCode).toBe(200);

      await setPlan({ planTier: 'madrasa_pro' });
      expect((await app.inject({ method: 'PUT', url: '/v1/voice/institution', headers: auth('dean'), payload: { enabled: true } })).statusCode).toBe(200);
      expect((await status('dean')).json()).toMatchObject({ included: true, enabled: true });
    });
  });
});
