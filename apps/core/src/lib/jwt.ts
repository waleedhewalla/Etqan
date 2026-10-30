import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface TokenPayload {
  sub: string;
  role: string;
  facultyId?: string;
  displayNameAr?: string;
  email?: string;
  whatsappE164?: string;
  purpose?: string;
}

export function generateToken(payload: TokenPayload, expiresIn: string = config.JWT_EXPIRY): string {
  return jwt.sign(payload as object, config.JWT_SECRET, { expiresIn: expiresIn as any });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, config.JWT_SECRET) as TokenPayload;
}

const PUBLIC_PATHS = [
  '/v1/health',
  '/v1/auth/otp/request',
  '/v1/auth/otp/verify',
  '/v1/auth/magic-link',
  '/v1/auth/magic-link/verify',
  '/docs',
];

async function jwtPluginImpl(app: FastifyInstance) {
  app.decorate('generateToken', generateToken);
  app.decorate('verifyToken', verifyToken);

  app.decorate('authenticate', async function (request: any, reply: any) {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({
        type: 'https://itqan.link/errors/unauthorized',
        title: 'Unauthorized',
        status: 401,
        detail: 'Authentication required',
      });
    }

    try {
      request.user = verifyToken(authHeader.slice(7));
    } catch {
      return reply.code(401).send({
        type: 'https://itqan.link/errors/unauthorized',
        title: 'Unauthorized',
        status: 401,
        detail: 'Invalid or expired token',
      });
    }
  });

}

// Wrapped with fastify-plugin so `authenticate` and the token helpers are
// visible to routes registered on the root instance.
export const jwtPlugin = fp(jwtPluginImpl, { name: 'itqan-jwt' });

/**
 * App-wide auth hook. Not registered yet: it was previously encapsulated inside
 * jwtPlugin and never ran. Registering it would also block cookie-only routes
 * such as /v1/auth/refresh in production unless they are added to PUBLIC_PATHS.
 */
export async function globalAuthHook(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    if (PUBLIC_PATHS.some(p => request.url.startsWith(p))) return;
    if (request.url.startsWith('/docs')) return;

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      if (request.method === 'GET' && !request.url.includes('/auth/')) return;
      if (process.env.NODE_ENV !== 'production') return;

      return reply.code(401).send({
        type: 'https://itqan.link/errors/unauthorized',
        title: 'Unauthorized',
        status: 401,
        detail: 'Authentication required',
      });
    }

    try {
      request.user = verifyToken(authHeader.slice(7));
    } catch {
      return reply.code(401).send({
        type: 'https://itqan.link/errors/unauthorized',
        title: 'Unauthorized',
        status: 401,
        detail: 'Invalid or expired token',
      });
    }
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    generateToken: (payload: TokenPayload, expiresIn?: string) => string;
    verifyToken: (token: string) => TokenPayload;
    authenticate: (request: any, reply: any) => Promise<void>;
  }
  interface FastifyRequest {
    // Set by app.authenticate; only read it in routes behind that preHandler.
    user: TokenPayload;
  }
}
