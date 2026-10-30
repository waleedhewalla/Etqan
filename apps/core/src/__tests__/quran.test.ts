/**
 * Quran text: loader validation, loading into the database, and the /ayat routes.
 *
 * The tests use placeholder text and only touch rows they create, so they work
 * whether or not the real text has been loaded into the database.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { count, inArray } from 'drizzle-orm';
import { buildApp } from '../server';
import { closeDb, getDb, type Database } from '../db';
import { quranAyat } from '../db/schema';
import { parseQuranJson, seedQuran } from '../db/quran-seed';
import { generateToken } from '../lib/jwt';

/** A two-sura dataset (2 + 1 ayat) with placeholder text. */
const tiny = () => [
  { id: 1, name: 'سورة أولى', verses: [{ id: 1, text: 'كَلِمَةٌ أُولَى' }, { id: 2, text: 'كَلِمَةٌ ثَانِيَةٌ هُنَا' }] },
  { id: 2, name: 'سورة ثانية', verses: [{ id: 1, text: 'كَلِمَةٌ أَخِيرَةٌ' }] },
];

describe('parseQuranJson', () => {
  it('turns the dataset into rows with normalized text and word counts', () => {
    const rows = parseQuranJson(tiny(), [2, 1]);
    expect(rows.map((r) => r.ref)).toEqual(['1:1', '1:2', '2:1']);
    expect(rows[1]).toMatchObject({
      sura: 1, ayah: 2, suraNameAr: 'سورة أولى', textNormalized: 'كلمه ثانيه هنا', wordCount: 3,
    });
  });

  it('rejects data that is not the complete text', () => {
    expect(() => parseQuranJson({}, [2, 1])).toThrow(/Expected 2 suras/);
    expect(() => parseQuranJson(tiny().slice(0, 1), [2, 1])).toThrow(/Expected 2 suras/);

    const short = tiny();
    short[0].verses.pop();
    expect(() => parseQuranJson(short, [2, 1])).toThrow(/Sura 1 should have 2 ayat/);

    const misnumbered = tiny();
    misnumbered[0].verses[1].id = 5;
    expect(() => parseQuranJson(misnumbered, [2, 1])).toThrow(/Ayah 1:2 has id 5/);

    const blank = tiny();
    blank[1].verses[0].text = '   ';
    expect(() => parseQuranJson(blank, [2, 1])).toThrow(/Ayah 2:1 has no text/);

    const marksOnly = tiny();
    marksOnly[1].verses[0].text = '\u{064E}\u{0651}';
    expect(() => parseQuranJson(marksOnly, [2, 1])).toThrow(/no letters/);
  });

  it('checks against the real Hafs counts by default', () => {
    expect(() => parseQuranJson(tiny())).toThrow(/Expected 114 suras/);
  });
});

describe.skipIf(!process.env.DATABASE_URL)('quran text in the database', () => {
  let app: FastifyInstance;
  let db: Database;
  let token: string;
  /** Placeholder rows this test inserted (and will remove). */
  let inserted: string[] = [];
  let hadRealText = false;

  const get = (url: string, auth = true) => app.inject({
    method: 'GET', url, headers: auth ? { authorization: `Bearer ${token}` } : {},
  });

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    db = getDb();
    token = generateToken({ sub: randomUUID(), role: 'student', facultyId: randomUUID() });

    const [{ n }] = await db.select({ n: count() }).from(quranAyat);
    hadRealText = n > 0;

    const placeholder = (sura: number, ayah: number) => ({
      ref: `${sura}:${ayah}`, sura, ayah, suraNameAr: 'سورة', textUthmani: `كَلِمَةٌ ${ayah}`,
      textNormalized: 'كلمه', wordCount: 2,
    });
    const rows = await db.insert(quranAyat)
      .values([placeholder(113, 4), placeholder(113, 5), placeholder(114, 1), placeholder(114, 2), placeholder(114, 3)])
      .onConflictDoNothing()
      .returning({ ref: quranAyat.ref });
    inserted = rows.map((r) => r.ref);
  });

  afterAll(async () => {
    if (inserted.length) await db.delete(quranAyat).where(inArray(quranAyat.ref, inserted));
    await app?.close();
    await closeDb();
  });

  it('loads the text in one transaction and skips when it is already complete', async () => {
    class Rollback extends Error {}
    await db.transaction(async (tx) => {
      const rows = parseQuranJson(tiny(), [2, 1]);
      const first = await seedQuran(tx as unknown as Database, rows);
      expect(first).toEqual({ inserted: 3, skipped: false });
      const [{ n }] = await tx.select({ n: count() }).from(quranAyat);
      expect(n).toBe(3);

      expect(await seedQuran(tx as unknown as Database, rows)).toEqual({ inserted: 0, skipped: true });
      expect(await seedQuran(tx as unknown as Database, rows, { force: true })).toEqual({ inserted: 3, skipped: false });
      throw new Rollback(); // leave the real table untouched
    }).catch((err) => {
      if (!(err instanceof Rollback)) throw err;
    });

    const [{ n }] = await db.select({ n: count() }).from(quranAyat);
    expect(n).toBeGreaterThanOrEqual(inserted.length);
  });

  describe('GET /v1/ayat', () => {
    it('requires a signed-in user', async () => {
      expect((await get('/v1/ayat?refs=114:1', false)).statusCode).toBe(401);
      expect((await get('/v1/ayat/range?start=114:1&end=114:2', false)).statusCode).toBe(401);
    });

    it('returns the requested verses in mushaf order', async () => {
      const res = await get('/v1/ayat?refs=114:2,113:5,114:2');
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json();
      expect(body.ayat.map((a: { ref: string }) => a.ref)).toEqual(['113:5', '114:2']);
      expect(body.complete).toBe(true);
      expect(body.ayat[0]).toMatchObject({ sura: 113, ayah: 5 });
      expect(body.ayat[0].textUthmani).toBeTruthy();
      expect(res.headers['cache-control']).toContain('private');
    });

    it('says when some verses are not loaded', async () => {
      if (hadRealText) return; // with the real text loaded every verse exists
      const body = (await get('/v1/ayat?refs=114:2,114:6')).json();
      expect(body.ayat.map((a: { ref: string }) => a.ref)).toEqual(['114:2']);
      expect(body.complete).toBe(false);
    });

    it('rejects references that do not exist or too many at once', async () => {
      for (const refs of ['2:287', '115:1', 'abc', '2:1,,x']) {
        expect((await get(`/v1/ayat?refs=${refs}`)).statusCode, refs).toBe(400);
      }
      const many = Array.from({ length: 61 }, (_, i) => `2:${(i % 200) + 1}`);
      expect((await get(`/v1/ayat?refs=${many.join(',')}`)).statusCode).toBe(400);
    });
  });

  describe('GET /v1/ayat/range', () => {
    it('returns a range inside one sura', async () => {
      const body = (await get('/v1/ayat/range?start=114:1&end=114:3')).json();
      expect(body.ayat.map((a: { ref: string }) => a.ref)).toEqual(['114:1', '114:2', '114:3']);
      expect(body.complete).toBe(true);
    });

    it('returns a range that crosses into the next sura', async () => {
      const body = (await get('/v1/ayat/range?start=113:5&end=114:2')).json();
      expect(body.ayat.map((a: { ref: string }) => a.ref)).toEqual(['113:5', '114:1', '114:2']);
      expect(body.complete).toBe(true);
    });

    it('rejects reversed, invalid and oversized ranges', async () => {
      expect((await get('/v1/ayat/range?start=114:3&end=114:1')).statusCode).toBe(400);
      expect((await get('/v1/ayat/range?start=2:300&end=2:301')).statusCode).toBe(400);
      expect((await get('/v1/ayat/range?start=1:1&end=3:200')).statusCode).toBe(400); // 493 ayat
      expect((await get('/v1/ayat/range?start=1:1')).statusCode).toBe(400);
    });
  });
});
