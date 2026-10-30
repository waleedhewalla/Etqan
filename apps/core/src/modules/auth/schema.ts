import { z } from 'zod';

const whatsapp = z.string().regex(/^\+[1-9]\d{6,14}$/, 'Invalid phone number format (E.164)');
const joinCode = z.string().trim().min(3).max(20).regex(/^[A-Za-z0-9-]+$/);

export const otpRequestSchema = z.object({
  whatsapp,
  joinCode: joinCode.optional(),
});

export const otpVerifySchema = z.object({
  whatsapp,
  code: z.string().regex(/^\d{4}$/, 'OTP must be 4 digits'),
  joinCode: joinCode.optional(),
  displayNameAr: z.string().trim().min(2).max(100).optional(),
});

export const magicLinkRequestSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const magicLinkVerifySchema = z.object({
  token: z.string().min(1),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const profileUpdateSchema = z.object({
  displayNameAr: z.string().trim().min(2).max(100).optional(),
  displayNameEn: z.string().trim().max(100).nullable().optional(),
});

export const consentsSchema = z.object({
  granted: z.array(z.enum([
    'voice_recording', 'analytics', 'mahram_access', 'whatsapp_notifications',
    'peer_comparison', 'data_export', 'ai_processing',
  ])),
});
