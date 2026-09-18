import { z } from 'zod';

/**
 * Auth schemas
 */

// WhatsApp OTP
export const otpRequestSchema = z.object({
  body: z.object({
    whatsapp: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Invalid phone number format (E.164)'),
  }),
});

export const otpVerifySchema = z.object({
  body: z.object({
    whatsapp: z.string().regex(/^\+[1-9]\d{6,14}$/),
    code: z.string().regex(/^\d{4}$/, 'OTP must be 4 digits'),
  }),
});

// Magic Link
export const magicLinkRequestSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
  }),
});

export const magicLinkVerifySchema = z.object({
  body: z.object({
    token: z.string().min(1),
  }),
});

// Section join
export const sectionJoinSchema = z.object({
  body: z.object({
    code: z.string().min(3).max(20).regex(/^[A-Z0-9-]+$/),
    whatsapp: z.string().regex(/^\+[1-9]\d{6,14}$/),
  }),
});

// Profile update
export const profileUpdateSchema = z.object({
  body: z.object({
    displayNameAr: z.string().min(1).max(100).optional(),
    displayNameEn: z.string().max(100).optional().nullable(),
    avatarUrl: z.string().url().optional().nullable(),
    notificationChannel: z.enum(['whatsapp', 'inapp']).optional(),
  }),
});

// Preferences
export const preferencesSchema = z.object({
  body: z.object({
    preferredReciter: z.string().optional(),
    practiceTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
    notificationChannel: z.enum(['whatsapp', 'inapp']).optional(),
    quietHoursEnabled: z.boolean().optional(),
    quietHoursStart: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
    quietHoursEnd: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
    arabicNumerals: z.boolean().optional(),
    fontSize: z.number().min(14).max(48).optional(),
    dyslexiaMode: z.boolean().optional(),
  }),
});

export type OtpRequestInput = z.infer<typeof otpRequestSchema>['body'];
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>['body'];
export type MagicLinkRequestInput = z.infer<typeof magicLinkRequestSchema>['body'];
export type MagicLinkVerifyInput = z.infer<typeof magicLinkVerifySchema>['body'];
export type SectionJoinInput = z.infer<typeof sectionJoinSchema>['body'];
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>['body'];
export type PreferencesInput = z.infer<typeof preferencesSchema>['body'];