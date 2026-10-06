import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { otpRequestSchema, otpVerifySchema, magicLinkRequestSchema, magicLinkVerifySchema, sectionJoinSchema } from './schema';
import { ValidationError, UnauthorizedError } from '../../lib/errors';
import { generateToken, verifyToken, TokenPayload } from '../../lib/jwt';
import { auditLog } from '../audit/service';

const otpStore = new Map<string, { code: string; expiresAt: number; attempts: number }>();
const magicLinkStore = new Map<string, { email: string; expiresAt: number }>();

export async function authRoutes(app: FastifyInstance) {
  // Request OTP
  app.post('/otp/request', {
    schema: otpRequestSchema,
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { whatsapp } = request.body as { whatsapp: string };
    const normalized = whatsapp.replace(/\s+/g, '');

    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000;

    otpStore.set(normalized, { code, expiresAt, attempts: 0 });

    // TODO: Send via WhatsApp Business API
    console.log(`[DEV] OTP for ${normalized}: ${code}`);

    await auditLog({
      actorId: 'system',
      actorRole: 'system',
      action: 'otp.requested',
      targetType: 'user',
      targetId: normalized,
      metadata: { channel: 'whatsapp' },
    });

    return reply.code(200).send({ message: 'OTP sent', expiresIn: 600 });
  });

  // Verify OTP
  app.post('/otp/verify', {
    schema: otpVerifySchema,
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const { whatsapp, code } = request.body as { whatsapp: string; code: string };
    const normalized = whatsapp.replace(/\s+/g, '');

    const record = otpStore.get(normalized);

    if (!record) {
      throw new ValidationError('OTP expired or not requested');
    }

    if (record.expiresAt < Date.now()) {
      otpStore.delete(normalized);
      throw new ValidationError('OTP expired');
    }

    if (record.attempts >= 3) {
      otpStore.delete(normalized);
      throw new ValidationError('Too many failed attempts');
    }

    if (record.code !== code) {
      record.attempts++;
      otpStore.set(normalized, record);
      throw new ValidationError('Invalid OTP');
    }

    otpStore.delete(normalized);

    // In real app: lookup user by whatsapp in DB
    const userId = `user-${normalized.replace(/\D/g, '').slice(-8)}`;
    const tokenPayload: TokenPayload = {
      sub: userId,
      role: 'student',
      facultyId: 'faculty-1',
      displayNameAr: 'طالبة',
      whatsappE164: normalized,
    };

    const token = generateToken(tokenPayload);

    reply.setCookie('refreshToken', generateToken(tokenPayload, '90d'), {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 90 * 24 * 60 * 60,
      path: '/',
    });

    await auditLog({
      actorId: userId,
      actorRole: 'student',
      action: 'login',
      targetType: 'session',
      targetId: userId,
    });

    return reply.send({ token, user: { id: userId, ...tokenPayload } });
  });

  // Magic link request
  app.post('/magic-link', {
    schema: magicLinkRequestSchema,
    config: { rateLimit: { max: 3, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { email } = request.body as { email: string };
    const normalized = email.toLowerCase();

    // In real app: lookup in DB
    const staffId = 'staff-1';
    const tokenPayload: TokenPayload = {
      sub: staffId,
      role: 'lecturer',
      facultyId: 'faculty-1',
      displayNameAr: 'أ. فاطمة',
      email: normalized,
      purpose: 'magic-link',
    };

    const token = generateToken(tokenPayload, '15m');
    const link = `${process.env.FRONTEND_URL || 'http://localhost:9050'}/auth/login/faculty?token=${token}`;

    magicLinkStore.set(token, { email: normalized, expiresAt: Date.now() + 15 * 60 * 1000 });

    // TODO: Send email with link
    console.log(`[DEV] Magic link for ${normalized}: ${link}`);

    await auditLog({
      actorId: 'system',
      actorRole: 'system',
      action: 'magic_link.sent',
      targetType: 'user',
      targetId: staffId,
      metadata: { email: normalized },
    });

    return reply.send({ message: 'If the email exists, a magic link has been sent' });
  });

  // Magic link verify
  app.post('/magic-link/verify', {
    schema: magicLinkVerifySchema,
  }, async (request, reply) => {
    const { token } = request.body as { token: string };
    const record = magicLinkStore.get(token);

    if (!record || record.expiresAt < Date.now()) {
      throw new UnauthorizedError('Invalid or expired magic link');
    }

    magicLinkStore.delete(token);

    const payload = verifyToken(token);
    if (payload.purpose !== 'magic-link') {
      throw new UnauthorizedError('Invalid token purpose');
    }

    const accessPayload: TokenPayload = {
      sub: payload.sub,
      role: payload.role,
      facultyId: payload.facultyId,
      displayNameAr: payload.displayNameAr,
      email: payload.email,
    };

    const accessToken = generateToken(accessPayload);

    reply.setCookie('refreshToken', generateToken(accessPayload, '90d'), {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 90 * 24 * 60 * 60,
      path: '/',
    });

    await auditLog({
      actorId: payload.sub,
      actorRole: payload.role,
      action: 'login',
      targetType: 'session',
      targetId: payload.sub,
    });

    return reply.send({ token: accessToken, user: { id: payload.sub, ...accessPayload } });
  });

  // Join section
  app.post('/sections/join', {
    schema: sectionJoinSchema,
  }, async (request, reply) => {
    const { code, whatsapp } = request.body as { code: string; whatsapp: string };
    const normalized = whatsapp.replace(/\s+/g, '');

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Authentication required');
    }

    const payload = verifyToken(authHeader.slice(7));

    // In real app: validate section code, add student to section
    const section = {
      id: 'section-1',
      name: 'شعبة ٢٠٢٦-أ',
      code: 'AZH-2026-001',
    };

    await auditLog({
      actorId: payload.sub,
      actorRole: 'student',
      action: 'section.join',
      targetType: 'section',
      targetId: section.id,
      metadata: { code },
    });

    return reply.send({ section, message: 'Successfully joined section' });
  });

  // Get current user
  app.get('/users/me', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    return reply.send({ user: request.user });
  });

  // Refresh token
  app.post('/auth/refresh', async (request, reply) => {
    const refreshToken = (request as any).cookies?.refreshToken;
    if (!refreshToken) {
      throw new UnauthorizedError('No refresh token');
    }

    const payload = verifyToken(refreshToken);
    const accessPayload: TokenPayload = {
      sub: payload.sub,
      role: payload.role,
      facultyId: payload.facultyId,
      displayNameAr: payload.displayNameAr,
      email: payload.email,
      whatsappE164: payload.whatsappE164,
    };

    const accessToken = generateToken(accessPayload);
    return reply.send({ token: accessToken });
  });

  // Logout
  app.post('/auth/logout', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    reply.clearCookie('refreshToken', { path: '/' });

    await auditLog({
      actorId: request.user!.sub,
      actorRole: request.user!.role,
      action: 'logout',
      targetType: 'session',
      targetId: request.user!.sub,
    });

    return reply.send({ message: 'Logged out successfully' });
  });
}
