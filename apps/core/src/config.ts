import { z } from 'zod';

// Treat empty variables (e.g. `WHATSAPP_API_KEY=` in .env) as unset.
// Environment values are strings: "false" must mean false (z.coerce.boolean() would make it true).
const flag = (fallback: boolean) =>
  z.preprocess((v) => (v === undefined || v === '' ? fallback : v === true || v === 'true' || v === '1'), z.boolean());

const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  
  // Database
  DATABASE_URL: z.string().default('postgresql://itqan:itqan_dev_password@localhost:5432/itqan'),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // MinIO
  MINIO_ENDPOINT: z.string().default('localhost:9000'),
  MINIO_ACCESS_KEY: z.string().default('minioadmin'),
  MINIO_SECRET_KEY: z.string().default('minioadmin'),
  MINIO_BUCKET: z.string().default('itqan-audio'),
  MINIO_USE_SSL: z.preprocess((v) => v === 'true' || v === '1', z.boolean()).default(false),
  MINIO_REGION: z.string().default('us-east-1'),
  // 'memory' keeps recordings in process memory (tests, quick local runs); anything else uses MinIO/S3.
  STORAGE_DRIVER: z.enum(['s3', 'memory']).default('s3'),

  // JWT
  JWT_SECRET: z.string().min(32).default('dev-secret-change-me-in-production-32chars'),
  JWT_EXPIRY: z.string().default('30d'),
  JWT_REFRESH_EXPIRY: z.string().default('90d'),
  
  // Behind a reverse proxy (Caddy, nginx, a load balancer) every request arrives from the proxy's address, so
  // without this the per-IP rate limits (for example 5 login codes an hour) would be shared by every user.
  // Set true ONLY when the API is reachable through the proxy alone: a client could otherwise forge X-Forwarded-For.
  TRUST_PROXY: flag(false),
  // The interactive API documentation at /docs. Off in production unless asked for.
  ENABLE_DOCS: z.preprocess((v) => (v === undefined || v === '' ? process.env.NODE_ENV !== 'production' : v === true || v === 'true' || v === '1'), z.boolean()),

  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:9050'),
  
  // API
  API_URL: z.string().url().default('http://localhost:4000'),
  
  // Quran text loader (`pnpm db:seed-quran`): a local JSON file wins over the URL.
  QURAN_TEXT_PATH: optional(z.string()),
  QURAN_TEXT_URL: z.string().url().default('https://cdn.jsdelivr.net/npm/quran-json@3.1.2/dist/quran.json'),

  // What an institution's plan limits do. 'warn' only reports them (the admin console shows "full" or "expired");
  // 'block' also stops an institution that is full or expired from adding students and halaqat. Students already
  // learning are never locked out. Whether AI checking is included in the plan is checked in both modes.
  PLAN_ENFORCEMENT: z.enum(['warn', 'block']).default('warn'),

  // How long a recording is kept. The privacy page promises deletion within 24 hours of the teacher's
  // review; one nobody reviews is removed after AUDIO_UNREVIEWED_MAX_DAYS so it cannot stay forever.
  AUDIO_RETENTION_HOURS: z.coerce.number().positive().default(24),
  AUDIO_UNREVIEWED_MAX_DAYS: z.coerce.number().positive().default(30),

  // Recitation checking. 'none' = teacher-only review. 'demo' drops and swaps a few words so the
  // screens can be tried without a service (refused in production). 'openai-compatible' sends the audio
  // to any service that implements POST {ASR_API_URL}/audio/transcriptions.
  ASR_PROVIDER: z.enum(['none', 'demo', 'openai-compatible']).default('none'),
  ASR_API_URL: optional(z.string().url()),
  ASR_API_KEY: optional(z.string()),
  ASR_MODEL: z.string().default('whisper-1'),
  
  // WhatsApp
  WHATSAPP_API_URL: optional(z.string().url()),
  WHATSAPP_API_KEY: optional(z.string()),
  WHATSAPP_TEMPLATE_NAMESPACE: optional(z.string()),
  WHATSAPP_TEMPLATE_OTP: z.string().default('itqan_otp'),
  WHATSAPP_TEMPLATE_ABSENCE: z.string().default('itqan_absence_alert'),
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().default('ar'),

  // Email (SendGrid) for staff magic links
  SENDGRID_API_KEY: optional(z.string()),
  FROM_EMAIL: z.string().email().default('noreply@itqan.link'),
  FROM_NAME: z.string().default('إتقان'),

  // Day boundaries for streaks, attendance and weekly reports
  DEFAULT_TIMEZONE: z.string().default('Africa/Cairo'),

  // Web app (used in magic links)
  FRONTEND_URL: z.string().url().default('http://localhost:9050'),
  
  // Feature flags
  ENABLE_ASR: flag(false),
  ENABLE_LIVE_HALAQA: flag(false),
  ENABLE_MUTASHABIHAT: flag(true),
  ENABLE_FAMILY_PORTAL: flag(false),
});

export type Config = z.infer<typeof envSchema>;

const DEV_JWT_SECRET = 'dev-secret-change-me-in-production-32chars';

/**
 * Settings that are fine on a laptop and dangerous in production. Returns what is wrong; the server refuses to
 * start when the list is not empty. (Each default below is public: a deployment that forgot to set one would
 * otherwise run happily with a secret everyone can read.)
 */
export function productionProblems(c: Pick<Config, 'NODE_ENV' | 'JWT_SECRET' | 'MINIO_ACCESS_KEY' | 'MINIO_SECRET_KEY' | 'STORAGE_DRIVER' | 'DATABASE_URL'>): string[] {
  if (c.NODE_ENV !== 'production') return [];
  const problems: string[] = [];
  if (c.JWT_SECRET === DEV_JWT_SECRET) problems.push('JWT_SECRET is the public development default: anyone could forge login tokens. Set a long random value.');
  if (c.STORAGE_DRIVER === 'memory') problems.push('STORAGE_DRIVER=memory loses every recording when the API restarts. Use s3.');
  if (c.STORAGE_DRIVER === 's3' && (c.MINIO_ACCESS_KEY === 'minioadmin' || c.MINIO_SECRET_KEY === 'minioadmin')) {
    problems.push('MINIO_ACCESS_KEY / MINIO_SECRET_KEY are the public MinIO defaults. Set your own.');
  }
  if (c.DATABASE_URL.includes('itqan_dev_password')) problems.push('DATABASE_URL uses the development database password.');
  return problems;
}

export const config = envSchema.parse(process.env);

const problems = productionProblems(config);
if (problems.length > 0) {
  throw new Error(`Refusing to start in production:\n - ${problems.join('\n - ')}`);
}