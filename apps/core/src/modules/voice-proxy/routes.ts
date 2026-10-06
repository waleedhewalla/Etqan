import { FastifyInstance } from 'fastify';

export async function voiceProxyRoutes(app: FastifyInstance) {
  // POST /v1/voice/check — Proxy to Tarteel ASR for voice recitation check
  app.post('/voice/check', {
    preHandler: [app.authenticate],
  }, async (request) => {
    // Tarteel API integration placeholder — requires API key and multipart audio
    const tarteelApiKey = process.env.TARTEEL_API_KEY;
    if (!tarteelApiKey) {
      return request.server.httpErrors.serviceUnavailable('Voice check service not configured');
    }

    const data = await request.file();
    if (!data) {
      return request.server.httpErrors.badRequest('Audio file required');
    }

    const { expectedRef, mode } = request.query as { expectedRef: string; mode?: string };

    // Placeholder response — actual Tarteel integration TBD
    return {
      status: 'not_configured',
      message: 'Tarteel ASR integration pending API key setup',
      expectedRef,
      mode: mode ?? 'hifz',
    };
  });

  // GET /v1/voice/status — Check voice service availability
  app.get('/voice/status', async () => {
    return {
      available: !!process.env.TARTEEL_API_KEY,
      provider: 'tarteel',
    };
  });
}
