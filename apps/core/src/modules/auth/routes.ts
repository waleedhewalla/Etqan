import { randomInt, randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb, type Database } from '../../db';
import { consents, sectionEnrollments, sections, tenants, users } from '../../db/schema';
import { config } from '../../config';
import { ItqanError, ValidationError, UnauthorizedError } from '../../lib/errors';
import { generateToken, issueSessionTokens, verifyToken, TokenPayload } from '../../lib/jwt';
import { STAFF_ROLES } from '../../lib/access';
import { isWhatsAppConfigured, sendWhatsApp } from '../../lib/whatsapp';
import { isEmailConfigured, sendEmail } from '../../lib/email';
import { assertCanAddStudent } from '../../lib/plan';
import { auditLog } from '../audit/service';
import {
  otpRequestSchema, otpVerifySchema, magicLinkRequestSchema, magicLinkVerifySchema,
  profileUpdateSchema, consentsSchema, refreshSchema,
} from './schema';

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 3;
const MAGIC_LINK_TTL = '15m';

// Single-instance stores. Phase 0 of the roadmap moves these to Redis.
const otpStore = new Map<string, { code: string; expiresAt: number; attempts: number }>();
const usedMagicLinks = new Map<string, number>();

type User = typeof users.$inferSelect;

export function toTokenPayload(user: User): TokenPayload {
  return {
    sub: user.id,
    role: user.role,
    facultyId: user.tenantId,
    displayNameAr: user.displayNameAr,
    ...(user.email ? { email: user.email } : {}),
    ...(user.whatsappE164 ? { whatsappE164: user.whatsappE164 } : {}),
  };
}

function publicUser(user: User) {
  return {
    id: user.id,
    role: user.role,
    tenantId: user.tenantId,
    displayNameAr: user.displayNameAr,
    displayNameEn: user.displayNameEn,
    email: user.email,
    whatsappE164: user.whatsappE164,
  };
}

function normalizeWhatsApp(raw: string) {
  return raw.replace(/[\s-]+/g, '');
}

async function findActiveSectionByCode(db: Database, code: string) {
  const [section] = await db.select().from(sections)
    .where(and(eq(sections.joinCode, code.toUpperCase()), eq(sections.active, true)))
    .limit(1);
  return section ?? null;
}

/** Enrolls a student in a section, re-activating a dropped enrollment. */
export async function enrollStudent(db: Database, sectionId: string, studentId: string) {
  await db.insert(sectionEnrollments)
    .values({ sectionId, studentId })
    .onConflictDoUpdate({
      target: [sectionEnrollments.sectionId, sectionEnrollments.studentId],
      set: { droppedAt: null },
    });
}

class ServiceUnavailableError extends ItqanError {
  constructor(message: string) {
    super(message, 'SERVICE_UNAVAILABLE', 503);
  }
}

export async function authRoutes(app: FastifyInstance) {
  const db = getDb();

  // POST /v1/auth/otp/request — send a login code over WhatsApp.
  // Existing users (students, guardians) need only their number; new students
  // also pass the join code their teacher gave them (invite-only).
  app.post('/otp/request', {
    schema: { body: otpRequestSchema },
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const body = request.body as z.infer<typeof otpRequestSchema>;
    const whatsapp = normalizeWhatsApp(body.whatsapp);

    const [user] = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.whatsappE164, whatsapp), eq(users.active, true))).limit(1);

    if (!user) {
      const section = body.joinCode ? await findActiveSectionByCode(db, body.joinCode) : null;
      if (!section) {
        throw new ItqanError(
          'No account uses this number. Ask your teacher for your halaqa join code.',
          'ACCOUNT_NOT_FOUND', 404,
        );
      }
    }

    if (config.NODE_ENV === 'production' && !isWhatsAppConfigured()) {
      throw new ServiceUnavailableError('WhatsApp sending is not configured');
    }

    const code = randomInt(1000, 10000).toString();
    otpStore.set(whatsapp, { code, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 });

    const result = await sendWhatsApp({ to: whatsapp, template: 'otp', params: [code] });
    if (result.status === 'failed') {
      request.log.error({ error: result.error }, 'WhatsApp OTP send failed');
      throw new ServiceUnavailableError('Could not send the code over WhatsApp. Try again shortly.');
    }
    if (result.status === 'skipped') {
      request.log.warn(`[DEV] WhatsApp not configured. OTP for ${whatsapp}: ${code}`);
    }

    await auditLog({
      actorId: user?.id ?? 'anonymous', actorRole: 'system', action: 'otp.requested',
      targetType: 'user', targetId: whatsapp, metadata: { delivery: result.status },
    });

    return reply.send({ message: 'OTP sent', expiresIn: OTP_TTL_MS / 1000 });
  });

  // POST /v1/auth/otp/verify — check the code and sign in.
  // A first-time student with a valid join code gets an account and is enrolled.
  app.post('/otp/verify', {
    schema: { body: otpVerifySchema },
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const body = request.body as z.infer<typeof otpVerifySchema>;
    const whatsapp = normalizeWhatsApp(body.whatsapp);

    const record = otpStore.get(whatsapp);
    if (!record || record.expiresAt < Date.now()) {
      otpStore.delete(whatsapp);
      throw new ValidationError('The code has expired. Request a new one.');
    }
    if (record.code !== body.code) {
      record.attempts += 1;
      if (record.attempts >= MAX_OTP_ATTEMPTS) otpStore.delete(whatsapp);
      throw new ValidationError('Incorrect code');
    }
    otpStore.delete(whatsapp);

    let [user] = await db.select().from(users)
      .where(and(eq(users.whatsappE164, whatsapp), eq(users.active, true))).limit(1);
    let isNewUser = false;

    const section = body.joinCode ? await findActiveSectionByCode(db, body.joinCode) : null;
    if (body.joinCode && !section) throw new ValidationError('Invalid join code');

    if (!user) {
      if (!section) throw new UnauthorizedError('No account uses this number');
      // Checked before the account exists, so a refused join leaves nothing behind.
      await assertCanAddStudent(db, section.tenantId);
      [user] = await db.insert(users).values({
        tenantId: section.tenantId,
        role: 'student',
        displayNameAr: body.displayNameAr ?? 'طالبة جديدة',
        whatsappE164: whatsapp,
      }).returning();
      isNewUser = true;
    }

    if (section) {
      if (user.role !== 'student' || section.tenantId !== user.tenantId) {
        throw new ValidationError('This join code is for another institution or role');
      }
      if (!isNewUser) await assertCanAddStudent(db, section.tenantId, user.id);
      await enrollStudent(db, section.id, user.id);
    }

    const tokens = issueSessionTokens(toTokenPayload(user));
    await auditLog({
      actorId: user.id, actorRole: user.role, action: isNewUser ? 'signup' : 'login',
      targetType: 'session', targetId: user.id,
      metadata: section ? { sectionId: section.id } : undefined,
    });

    return reply.send({ ...tokens, user: publicUser(user), isNewUser });
  });

  // POST /v1/auth/magic-link — email a sign-in link to staff.
  app.post('/magic-link', {
    schema: { body: magicLinkRequestSchema },
    config: { rateLimit: { max: 3, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { email } = request.body as z.infer<typeof magicLinkRequestSchema>;
    const normalized = email.trim().toLowerCase();
    const generic = { message: 'If the email exists, a magic link has been sent' };

    if (config.NODE_ENV === 'production' && !isEmailConfigured()) {
      throw new ServiceUnavailableError('Email sending is not configured');
    }

    const [staff] = await db.select().from(users)
      .where(and(sql`lower(${users.email}) = ${normalized}`, eq(users.active, true))).limit(1);
    if (!staff || !STAFF_ROLES.includes(staff.role)) return reply.send(generic);

    const token = generateToken(
      { sub: staff.id, role: staff.role, purpose: 'magic-link', jti: randomUUID() },
      MAGIC_LINK_TTL,
    );
    const link = `${config.FRONTEND_URL}/auth/login/faculty?token=${encodeURIComponent(token)}`;

    const result = await sendEmail({
      to: normalized,
      subject: 'رابط الدخول إلى إتقان',
      text: `السلام عليكم ${staff.displayNameAr}،\n\nاستخدمي هذا الرابط للدخول إلى إتقان خلال ١٥ دقيقة:\n${link}\n\nإن لم تطلبي الدخول فتجاهلي هذه الرسالة.`,
    });
    if (result.status === 'skipped') request.log.warn(`[DEV] Email not configured. Magic link for ${normalized}: ${link}`);
    if (result.status === 'failed') request.log.error({ error: result.error }, 'Magic link email failed');

    await auditLog({
      actorId: 'system', actorRole: 'system', action: 'magic_link.sent',
      targetType: 'user', targetId: staff.id, metadata: { delivery: result.status },
    });
    return reply.send(generic);
  });

  // POST /v1/auth/magic-link/verify — exchange a one-time link token for a session.
  app.post('/magic-link/verify', {
    schema: { body: magicLinkVerifySchema },
  }, async (request, reply) => {
    const { token } = request.body as z.infer<typeof magicLinkVerifySchema>;

    let payload: TokenPayload;
    try {
      payload = verifyToken(token);
    } catch {
      throw new UnauthorizedError('Invalid or expired magic link');
    }
    if (payload.purpose !== 'magic-link' || usedMagicLinks.has(token)) {
      throw new UnauthorizedError('Invalid or expired magic link');
    }

    const [staff] = await db.select().from(users)
      .where(and(eq(users.id, payload.sub), eq(users.active, true))).limit(1);
    if (!staff) throw new UnauthorizedError('Invalid or expired magic link');

    // Remember used links until they would have expired anyway.
    const now = Date.now();
    for (const [t, exp] of usedMagicLinks) if (exp < now) usedMagicLinks.delete(t);
    usedMagicLinks.set(token, now + 15 * 60 * 1000);

    await auditLog({
      actorId: staff.id, actorRole: staff.role, action: 'login',
      targetType: 'session', targetId: staff.id,
    });
    return reply.send({ ...issueSessionTokens(toTokenPayload(staff)), user: publicUser(staff) });
  });

  // POST /v1/auth/refresh — new access token from a refresh token.
  app.post('/refresh', {
    schema: { body: refreshSchema },
  }, async (request, reply) => {
    const { refreshToken } = request.body as z.infer<typeof refreshSchema>;

    let payload: TokenPayload;
    try {
      payload = verifyToken(refreshToken);
    } catch {
      throw new UnauthorizedError('Invalid refresh token');
    }
    if (payload.purpose !== 'refresh') throw new UnauthorizedError('Invalid refresh token');

    const [user] = await db.select().from(users)
      .where(and(eq(users.id, payload.sub), eq(users.active, true))).limit(1);
    if (!user) throw new UnauthorizedError('Account is no longer active');

    return reply.send({ ...issueSessionTokens(toTokenPayload(user)), user: publicUser(user) });
  });

  // GET /v1/auth/me — current user with tenant and sections.
  app.get('/me', {
    preHandler: [app.authenticate],
  }, async (request) => {
    const [row] = await db.select({ user: users, tenant: tenants })
      .from(users).innerJoin(tenants, eq(users.tenantId, tenants.id))
      .where(eq(users.id, request.user.sub)).limit(1);
    if (!row) throw new UnauthorizedError('Account not found');

    const enrolled = row.user.role === 'student'
      ? await db.select({ id: sections.id, nameAr: sections.nameAr })
        .from(sectionEnrollments)
        .innerJoin(sections, eq(sectionEnrollments.sectionId, sections.id))
        .where(and(eq(sectionEnrollments.studentId, row.user.id), isNull(sectionEnrollments.droppedAt)))
      : [];

    const granted = await db.select({ purpose: consents.purpose }).from(consents)
      .where(and(eq(consents.userId, row.user.id), isNull(consents.withdrawnAt)));

    return {
      user: publicUser(row.user),
      tenant: { id: row.tenant.id, nameAr: row.tenant.nameAr, slug: row.tenant.slug },
      sections: enrolled,
      consents: granted.map((c) => c.purpose),
    };
  });

  // PATCH /v1/auth/me — update the display name.
  app.patch('/me', {
    schema: { body: profileUpdateSchema },
    preHandler: [app.authenticate],
  }, async (request) => {
    const body = request.body as z.infer<typeof profileUpdateSchema>;
    const [user] = await db.update(users)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(users.id, request.user.sub))
      .returning();
    return { user: publicUser(user) };
  });

  // PUT /v1/auth/me/consents — record which purposes the user agrees to.
  app.put('/me/consents', {
    schema: { body: consentsSchema },
    preHandler: [app.authenticate],
  }, async (request) => {
    const { granted } = request.body as z.infer<typeof consentsSchema>;
    const userId = request.user.sub;
    const now = new Date();
    const all = consentsSchema.shape.granted.element.options;

    for (const purpose of all) {
      const on = granted.includes(purpose);
      await db.insert(consents)
        .values({ userId, purpose, grantedAt: on ? now : null, withdrawnAt: on ? null : now })
        .onConflictDoUpdate({
          target: [consents.userId, consents.purpose],
          set: on ? { grantedAt: now, withdrawnAt: null } : { withdrawnAt: now },
        });
    }

    await auditLog({
      actorId: userId, actorRole: request.user.role, action: 'consents.updated',
      targetType: 'user', targetId: userId, metadata: { granted },
    });
    return { consents: granted };
  });

  // POST /v1/auth/logout — the client drops its tokens; recorded for the audit trail.
  app.post('/logout', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    await auditLog({
      actorId: request.user.sub, actorRole: request.user.role, action: 'logout',
      targetType: 'session', targetId: request.user.sub,
    });
    return reply.send({ message: 'Logged out successfully' });
  });
}
