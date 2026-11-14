import './env';
import Fastify from 'fastify';
import { fastifyCors } from '@fastify/cors';
import { fastifyHelmet } from '@fastify/helmet';
import { fastifyRateLimit } from '@fastify/rate-limit';
import { fastifyCookie } from '@fastify/cookie';
import { fastifyMultipart } from '@fastify/multipart';
import { fastifySwagger } from '@fastify/swagger';
import { fastifySwaggerUi } from '@fastify/swagger-ui';
import fastifySensible from '@fastify/sensible';
import type { ZodTypeAny } from 'zod';

import { config } from './config';
import { sql } from 'drizzle-orm';
import { getDb, closeDb } from './db';
import { jwtPlugin } from './lib/jwt';
import { authRoutes } from './modules/auth/routes';
import { sectionRoutes } from './modules/section/routes';
import { syllabusRoutes } from './modules/syllabus/routes';
import { sessionRoutes } from './modules/session/routes';
import { schedulerRoutes } from './modules/scheduler/routes';
import { mutashabihatRoutes } from './modules/mutashabihat/routes';
import { voiceProxyRoutes } from './modules/voice-proxy/routes';
import { badgeRoutes } from './modules/badges/routes';
import { adminRoutes } from './modules/admin/routes';
import { adminModulesRoutes } from './modules/admin/modules-routes';
import { moduleForPath, requireModule } from './lib/modules';
import { adminUsersRoutes } from './modules/admin/users-routes';
import { programRoutes } from './modules/program/routes';
import { adminSetupRoutes } from './modules/admin/setup-routes';
import { lessonRoutes } from './modules/lessons/routes';
import { liveRoutes } from './modules/live/routes';
import { sweepPendingChecks } from './lib/asr/runner';
import { purgeExpiredAudio } from './lib/retention';
import { sendDueReminders } from './lib/live-reminders';
import { assessmentRoutes } from './modules/assessment/routes';
import { reportingRoutes } from './modules/reporting/routes';
import { notificationRoutes } from './modules/notification/routes';
import { auditRoutes } from './modules/audit/routes';
import { healthRoutes } from './modules/health/routes';
import { quranRoutes } from './modules/quran/routes';
import { errorHandler } from './lib/errors';
import { auditPlugin } from './modules/audit/plugin';

async function buildApp() {
  const app = Fastify({
    trustProxy: config.TRUST_PROXY,
    logger: {
      level: config.LOG_LEVEL,
    },
    ajv: {
      customOptions: { coerceTypes: 'array' },
    },
  });

  // Route schemas are Zod objects, so validate with Zod instead of Ajv.
  app.setValidatorCompiler(({ schema }) => (data) => {
    const result = (schema as ZodTypeAny).safeParse(data);
    return result.success ? { value: result.data } : { error: result.error };
  });

  // Security headers
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
  });

  // CORS
  await app.register(fastifyCors, {
    origin: config.CORS_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Rate limiting
  await app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
    allowList: ['127.0.0.1', '::1'],
  });

  // Cookies (for refresh tokens)
  await app.register(fastifyCookie);
  await app.register(fastifySensible);

  // JWT authentication
  await app.register(jwtPlugin);

  // Multipart for file uploads
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB
      files: 1,
    },
  });

  // Swagger/OpenAPI
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Itqan API',
        version: '1.0.0',
        description: 'Backend API for the Itqan Quran memorization platform',
      },
      servers: [
        { url: `${config.API_URL}/v1`, description: 'Development' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  });

  if (config.ENABLE_DOCS) {
    await app.register(fastifySwaggerUi, {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: true,
      },
    });
  }

  // Audit plugin
  await app.register(auditPlugin);

  // Health check
  await app.register(healthRoutes, { prefix: '/v1' });

  // A module an institution has switched off refuses its own routes. Added to every route as it is registered, after
  // the route's own preHandlers, so the signed-in user is known by then.
  app.addHook('onRoute', (route) => {
    const module = moduleForPath(route.url);
    if (!module) return;
    const guard = requireModule(module) as unknown as NonNullable<typeof route.preHandler>;
    const existing = route.preHandler ? (Array.isArray(route.preHandler) ? route.preHandler : [route.preHandler]) : [];
    route.preHandler = [...existing, guard] as typeof route.preHandler;
  });

  // API routes
  await app.register(authRoutes, { prefix: '/v1/auth' });
  await app.register(sectionRoutes, { prefix: '/v1' });
  await app.register(syllabusRoutes, { prefix: '/v1' });
  await app.register(sessionRoutes, { prefix: '/v1' });
  await app.register(schedulerRoutes, { prefix: '/v1' });
  await app.register(mutashabihatRoutes, { prefix: '/v1' });
  await app.register(voiceProxyRoutes, { prefix: '/v1' });
  await app.register(badgeRoutes, { prefix: '/v1' });
  await app.register(adminRoutes, { prefix: '/v1' });
  await app.register(adminSetupRoutes, { prefix: '/v1' });
  await app.register(adminUsersRoutes, { prefix: '/v1' });
  await app.register(adminModulesRoutes, { prefix: '/v1' });
  await app.register(programRoutes, { prefix: '/v1' });
  await app.register(lessonRoutes, { prefix: '/v1' });
  await app.register(liveRoutes, { prefix: '/v1' });
  await app.register(assessmentRoutes, { prefix: '/v1' });
  await app.register(reportingRoutes, { prefix: '/v1' });
  await app.register(notificationRoutes, { prefix: '/v1' });
  await app.register(auditRoutes, { prefix: '/v1' });
  await app.register(quranRoutes, { prefix: '/v1' });

  // Global error handler
  app.setErrorHandler(errorHandler as any);

  // 404 handler
  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: `Route ${req.method} ${req.url} not found`,
    });
  });

  return app;
}

async function start() {
  const app = await buildApp();

  // Initialize DB connection pool
  const db = getDb();
  app.log.info('Database connection pool initialized');

  // On a developer's machine, say plainly when the database is not there instead of failing on the first request.
  if (config.NODE_ENV === 'development') {
    try {
      await db.execute(sql`select 1 from users limit 1`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const missingTables = /relation .* does not exist/.test(reason);
      console.error([
        '',
        missingTables ? 'The database is running but has no tables yet.' : `Cannot use the database: ${reason || 'connection refused'}`,
        missingTables
          ? 'Run:  pnpm db:migrate   then   pnpm --filter @itqan/core db:seed'
          : 'Start it with:  docker compose up -d   (Docker Desktop must be running), then  pnpm db:migrate',
        'The address comes from DATABASE_URL in the .env file at the project root.',
        '',
      ].join('\n'));
      process.exit(1);
    }
  }

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    app.log.info(`Server listening on port ${config.PORT}`);

    // Pick up recitation checks that were queued before a restart, then keep looking.
    const sweep = () => sweepPendingChecks(getDb()).catch((e) => app.log.error(e, 'ASR sweep failed'));
    void sweep();
    setInterval(sweep, 60_000).unref();

    // Remind students of scheduled live lessons (see lib/live-reminders.ts).
    const remind = () => sendDueReminders(getDb()).catch((e) => app.log.error(e, 'live reminders failed'));
    void remind();
    setInterval(remind, 60_000).unref();

    // Delete recordings that have outlived their purpose (see lib/retention.ts).
    const purge = () => purgeExpiredAudio(getDb()).catch((e) => app.log.error(e, 'audio retention failed'));
    void purge();
    setInterval(purge, 60 * 60_000).unref();
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down gracefully`);
    await app.close();
    await closeDb();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Tests import buildApp without starting a listener.
if (!process.env.VITEST) start();

export { buildApp };