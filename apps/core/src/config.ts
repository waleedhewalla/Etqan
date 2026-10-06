import { z } from 'zod';

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

  // JWT
  JWT_SECRET: z.string().min(32).default('dev-secret-change-me-in-production-32chars'),
  JWT_EXPIRY: z.string().default('30d'),
  JWT_REFRESH_EXPIRY: z.string().default('90d'),
  
  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:9010'),
  
  // API
  API_URL: z.string().url().default('http://localhost:4000'),
  
  // Tarteel
  TARTEEL_API_KEY: z.string().optional(),
  TARTEEL_API_URL: z.string().url().default('https://api.tarteel.ai'),
  
  // WhatsApp
  WHATSAPP_API_URL: z.string().url().optional(),
  WHATSAPP_API_KEY: z.string().optional(),
  WHATSAPP_TEMPLATE_NAMESPACE: z.string().optional(),
  
  // Feature flags
  ENABLE_ASR: z.coerce.boolean().default(false),
  ENABLE_LIVE_HALAQA: z.coerce.boolean().default(false),
  ENABLE_MUTASHABIHAT: z.coerce.boolean().default(true),
  ENABLE_FAMILY_PORTAL: z.coerce.boolean().default(false),
});

export const config = envSchema.parse(process.env);

export type Config = z.infer<typeof envSchema>;