import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken } from './jwt';
import { RangeNotSatisfiableError, getStorage } from './storage';

/** How long a link to a stored recording stays valid. */
export const AUDIO_LINK_TTL = '5m';

/** True when `token` is a link token of this `purpose` for this recording. */
export function validLinkToken(token: string | undefined, purpose: string, id: string): boolean {
  try {
    const payload = token ? verifyToken(token) : null;
    return payload?.purpose === purpose && payload.sub === id;
  } catch {
    return false; // invalid or expired
  }
}

/** Streams a stored audio object, honouring Range so the player can seek. */
export async function streamAudio(request: FastifyRequest, reply: FastifyReply, key: string, bytes: number | null) {
  let object;
  try {
    object = await getStorage().get(key, request.headers.range);
  } catch (err) {
    if (err instanceof RangeNotSatisfiableError) {
      return reply.code(416).header('Content-Range', `bytes */${bytes ?? 0}`).send();
    }
    throw err;
  }
  if (!object) return request.server.httpErrors.notFound('Recording not found');

  reply
    .code(object.contentRange ? 206 : 200)
    .header('Content-Type', object.contentType)
    .header('Content-Length', object.contentLength)
    .header('Accept-Ranges', 'bytes')
    .header('Cache-Control', 'private, no-store')
    .header('X-Content-Type-Options', 'nosniff')
    .header('Cross-Origin-Resource-Policy', 'cross-origin');
  if (object.contentRange) reply.header('Content-Range', object.contentRange);
  return reply.send(object.body);
}

