import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { asc, inArray } from 'drizzle-orm';
import { compareRefs, countAyat, parseRef } from '@itqan/quran';
import { getDb } from '../../db';
import { quranAyat } from '../../db/schema';
import { ayatInRange } from '../../lib/quran-range';

const MAX_REFS = 60;
const MAX_RANGE = 300;

const refsQuerySchema = z.object({ refs: z.string().min(1).max(1000) });
const rangeQuerySchema = z.object({ start: z.string(), end: z.string() });

const columns = {
  ref: quranAyat.ref,
  sura: quranAyat.sura,
  ayah: quranAyat.ayah,
  suraNameAr: quranAyat.suraNameAr,
  textUthmani: quranAyat.textUthmani,
  wordCount: quranAyat.wordCount,
};

export async function quranRoutes(app: FastifyInstance) {
  const db = getDb();

  // GET /v1/ayat?refs=2:1,2:2 — verse text for specific references.
  // `complete` is false when some verses are not loaded yet (see db:seed-quran).
  app.get('/ayat', {
    schema: { querystring: refsQuerySchema },
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const { refs } = request.query as z.infer<typeof refsQuerySchema>;
    const wanted = [...new Set(refs.split(',').map((r) => r.trim()).filter(Boolean))];
    if (wanted.length === 0 || wanted.length > MAX_REFS) {
      return request.server.httpErrors.badRequest(`Send between 1 and ${MAX_REFS} references`);
    }
    const invalid = wanted.filter((r) => !parseRef(r));
    if (invalid.length) {
      return request.server.httpErrors.badRequest(`Invalid reference: ${invalid[0]}`);
    }

    const ayat = await db.select(columns).from(quranAyat)
      .where(inArray(quranAyat.ref, wanted))
      .orderBy(asc(quranAyat.sura), asc(quranAyat.ayah));

    reply.header('Cache-Control', 'private, max-age=3600');
    return { ayat, complete: ayat.length === wanted.length };
  });

  // GET /v1/ayat/range?start=2:1&end=2:5 — consecutive verses in mushaf order.
  app.get('/ayat/range', {
    schema: { querystring: rangeQuerySchema },
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const q = request.query as z.infer<typeof rangeQuerySchema>;
    const start = parseRef(q.start);
    const end = parseRef(q.end);
    if (!start || !end) return request.server.httpErrors.badRequest('Invalid reference');
    if (compareRefs(start, end) > 0) return request.server.httpErrors.badRequest('The range ends before it starts');

    const expected = countAyat(start, end);
    if (expected > MAX_RANGE) {
      return request.server.httpErrors.badRequest(`A range can cover at most ${MAX_RANGE} ayat`);
    }

    const ayat = await db.select(columns).from(quranAyat)
      .where(ayatInRange(start, end))
      .orderBy(asc(quranAyat.sura), asc(quranAyat.ayah));

    reply.header('Cache-Control', 'private, max-age=3600');
    return { ayat, complete: ayat.length === expected };
  });
}
