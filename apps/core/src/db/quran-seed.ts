/**
 * Loads the Quran text (Hafs, Uthmani script) into `quran_ayat`.
 *
 *   pnpm --filter @itqan/core db:seed-quran            # fetches QURAN_TEXT_URL
 *   QURAN_TEXT_PATH=./quran.json pnpm ... db:seed-quran  # or reads a local file
 *   pnpm ... db:seed-quran --force                       # reload even if complete
 *
 * The expected format is the `quran.json` of the quran-json package: a list of
 * 114 suras, each `{ id, name, verses: [{ id, text }] }`. The text itself is not
 * stored in this repository; see the credits page for its source and licence.
 */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { count } from 'drizzle-orm';
import { AYAH_COUNTS, normalizeArabic, splitWords } from '@itqan/quran';
import { config } from '../config';
import { closeDb, getDb, type Database } from './index';
import { quranAyat } from './schema';

export type AyahRow = typeof quranAyat.$inferInsert;

/**
 * Validates the file against the known sura lengths and turns it into rows.
 * Throws a descriptive error for anything that does not look like the complete text.
 */
export function parseQuranJson(data: unknown, expectedCounts: readonly number[] = AYAH_COUNTS): AyahRow[] {
  if (!Array.isArray(data) || data.length !== expectedCounts.length) {
    throw new Error(`Expected ${expectedCounts.length} suras, got ${Array.isArray(data) ? data.length : typeof data}`);
  }

  const rows: AyahRow[] = [];
  data.forEach((sura: unknown, i) => {
    const s = sura as { id?: unknown; name?: unknown; verses?: unknown };
    const suraNo = i + 1;
    if (s?.id !== suraNo) throw new Error(`Sura at position ${suraNo} has id ${String(s?.id)}`);
    if (typeof s.name !== 'string' || !s.name.trim()) throw new Error(`Sura ${suraNo} has no name`);
    if (!Array.isArray(s.verses) || s.verses.length !== expectedCounts[i]) {
      throw new Error(`Sura ${suraNo} should have ${expectedCounts[i]} ayat, got ${Array.isArray(s.verses) ? s.verses.length : 'none'}`);
    }

    s.verses.forEach((verse: unknown, j) => {
      const v = verse as { id?: unknown; text?: unknown };
      const ayahNo = j + 1;
      if (v?.id !== ayahNo) throw new Error(`Ayah ${suraNo}:${ayahNo} has id ${String(v?.id)}`);
      if (typeof v.text !== 'string' || !v.text.trim()) throw new Error(`Ayah ${suraNo}:${ayahNo} has no text`);

      const text = v.text.trim();
      const textNormalized = normalizeArabic(text);
      if (!textNormalized) throw new Error(`Ayah ${suraNo}:${ayahNo} has no letters after normalizing`);
      rows.push({
        ref: `${suraNo}:${ayahNo}`,
        sura: suraNo,
        ayah: ayahNo,
        suraNameAr: s.name as string,
        textUthmani: text,
        textNormalized,
        wordCount: splitWords(text).length,
      });
    });
  });
  return rows;
}

/** Reads the dataset from QURAN_TEXT_PATH, or downloads it from QURAN_TEXT_URL. */
export async function loadQuranSource(): Promise<unknown> {
  if (config.QURAN_TEXT_PATH) {
    return JSON.parse(await readFile(config.QURAN_TEXT_PATH, 'utf8'));
  }
  const res = await fetch(config.QURAN_TEXT_URL, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Could not download ${config.QURAN_TEXT_URL}: HTTP ${res.status}`);
  return res.json();
}

/** Replaces the table contents in one transaction. Skips when it already holds every ayah. */
export async function seedQuran(db: Database, rows: AyahRow[], options: { force?: boolean } = {}) {
  const [existing] = await db.select({ n: count() }).from(quranAyat);
  if (!options.force && existing?.n === rows.length) return { inserted: 0, skipped: true };

  await db.transaction(async (tx) => {
    await tx.delete(quranAyat);
    for (let i = 0; i < rows.length; i += 500) {
      await tx.insert(quranAyat).values(rows.slice(i, i + 500));
    }
  });
  return { inserted: rows.length, skipped: false };
}

if (/quran-seed\.(ts|mjs)$/.test(process.argv[1] ?? '')) {
  (async () => {
    const rows = parseQuranJson(await loadQuranSource());
    const result = await seedQuran(getDb(), rows, { force: process.argv.includes('--force') });
    console.log(result.skipped
      ? `quran_ayat already holds ${rows.length} ayat — nothing to do (use --force to reload).`
      : `Loaded ${result.inserted} ayat.`);
    await closeDb();
  })().catch(async (err) => {
    console.error('Quran load failed:', err instanceof Error ? err.message : err);
    await closeDb();
    process.exit(1);
  });
}
