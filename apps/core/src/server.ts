import 'dotenv/config';
import Fastify from 'fastify';
import { fastifyCors } from '@fastify/cors';
import { fastifyHelmet } from '@fastify/helmet';
import { fastifyRateLimit } from '@fastify/rate-limit';
import { fastifyCookie } from '@fastify/cookie';
import { fastifyMultipart } from '@fastify/multipart';
import { fastifySwagger } from '@fastify/swagger';
import { fastifySwaggerUi } from '@fastify/swagger-ui';

import { config } from './config';
import { jwtPlugin } from './lib/jwt';
import { authRoutes } from './modules/auth/routes';
import { sectionRoutes } from './modules/section/routes';
import { syllabusRoutes } from './modules/syllabus/routes';
import { sessionRoutes } from './modules/session/routes';
import { schedulerRoutes } from './modules/scheduler/routes';
import { mutashabihatRoutes } from './modules/mutashabihat/routes';
import { voiceProxyRoutes } from './modules/voice-proxy/routes';
import { assessmentRoutes } from './modules/assessment/routes';
import { reportingRoutes } from './modules/reporting/routes';
import { notificationRoutes } from './modules/notification/routes';
import { auditRoutes } from './modules/audit/routes';
import { healthRoutes } from './modules/health/routes';
import { errorHandler } from './lib/errors';
import { auditPlugin } from './modules/audit/plugin';

async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
    },
    ajv: {
      customOptions: { coerceTypes: 'array' },
    },
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

  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  // Audit plugin
  await app.register(auditPlugin);

  // Health check
  await app.register(healthRoutes, { prefix: '/v1' });

  // API routes
  await app.register(authRoutes, { prefix: '/v1/auth' });
  await app.register(sectionRoutes, { prefix: '/v1' });
  await app.register(syllabusRoutes, { prefix: '/v1' });
  await app.register(sessionRoutes, { prefix: '/v1' });
  await app.register(schedulerRoutes, { prefix: '/v1' });
  await app.register(mutashabihatRoutes, { prefix: '/v1' });
  await app.register(voiceProxyRoutes, { prefix: '/v1' });
  await app.register(assessmentRoutes, { prefix: '/v1' });
  await app.register(reportingRoutes, { prefix: '/v1' });
  await app.register(notificationRoutes, { prefix: '/v1' });
  await app.register(auditRoutes, { prefix: '/v1' });

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

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    app.log.info(`Server listening on port ${config.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  process.on('SIGTERM', async () => {
    app.log.info('SIGTERM received, shutting down gracefully');
    await app.close();
    process.exit(0);
  });
}

start();

export { buildApp };