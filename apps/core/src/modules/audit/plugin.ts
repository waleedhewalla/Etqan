import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

async function auditPluginImpl(app: FastifyInstance) {
  // TODO: add onRequest/onResponse hooks for audit logging
}

export const auditPlugin = fp(auditPluginImpl, {
  name: 'itqan-audit',
});
