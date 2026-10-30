/**
 * Does a real transcription service hear Quran recitation well enough? Runs your own sample
 * recordings through the configured provider and scores them against the Quran text.
 *
 *   ENABLE_ASR=true ASR_PROVIDER=openai-compatible ASR_API_URL=https://api.openai.com/v1 \
 *   ASR_API_KEY=... pnpm --filter @itqan/core asr:bench ./samples
 *
 * ./samples holds the audio files and a manifest.json:
 *   [{ "file": "fatiha.webm", "startRef": "1:1", "endRef": "1:7", "notes": "clean" }, ...]
 *
 * Recite CLEANLY for the first pass: then low accuracy means the service or the matching rules, not
 * the reciter. Files are only read and sent to the provider; nothing is stored. The Quran text must
 * be loaded (db:seed-quran). The key is read from the environment and never printed.
 */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { asc } from 'drizzle-orm';
import { compareRefs, countAyat, parseRef, splitWords } from '@itqan/quran';
import { closeDb, getDb } from '../db';
import { quranAyat } from '../db/schema';
import { getAsrProvider } from '../lib/asr';
import { summarizeBench, type BenchRow } from '../lib/asr/bench';
import { evaluate } from '../lib/asr/evaluate';
import { ayatInRange } from '../lib/quran-range';

const MIME: Record<string, string> = {
  '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
};

interface ManifestEntry { file: string; startRef: string; endRef: string; notes?: string }

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error('Usage: asr:bench <folder with manifest.json and audio files>');
  const provider = getAsrProvider();
  if (!provider) throw new Error('No provider: set ENABLE_ASR=true and ASR_PROVIDER (and ASR_API_URL / ASR_API_KEY).');

  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as ManifestEntry[];
  if (!Array.isArray(manifest) || manifest.length === 0) throw new Error('manifest.json must be a non-empty list');

  const db = getDb();
  const rows: BenchRow[] = [];
  console.log(`Provider: ${provider.name}\n`);

  for (const entry of manifest) {
    const start = parseRef(entry.startRef);
    const end = parseRef(entry.endRef);
    if (!start || !end || compareRefs(start, end) > 0) throw new Error(`${entry.file}: invalid range ${entry.startRef}–${entry.endRef}`);
    const ayat = await db.select({ ref: quranAyat.ref, textUthmani: quranAyat.textUthmani })
      .from(quranAyat).where(ayatInRange(start, end)).orderBy(asc(quranAyat.sura), asc(quranAyat.ayah));
    if (ayat.length !== countAyat(start, end)) throw new Error(`${entry.file}: the Quran text for ${entry.startRef}–${entry.endRef} is not loaded`);

    const audio = await readFile(join(dir, entry.file));
    const began = Date.now();
    const transcript = await provider.transcribe({
      audio, contentType: MIME[extname(entry.file).toLowerCase()] ?? 'application/octet-stream',
      filename: basename(entry.file), expectedText: ayat.map((a) => a.textUthmani).join(' '),
    });
    const evaluation = evaluate(ayat, transcript);
    const row: BenchRow = {
      file: entry.file, expectedWords: ayat.reduce((a, v) => a + splitWords(v.textUthmani).length, 0),
      heardWords: splitWords(transcript.text).length, seconds: (Date.now() - began) / 1000, evaluation,
    };
    rows.push(row);

    console.log(`${entry.file}  ${entry.startRef}–${entry.endRef}${entry.notes ? `  (${entry.notes})` : ''}`);
    console.log(`  ${evaluation.status}  accuracy ${evaluation.accuracy}%  confidence ${evaluation.confidence.toFixed(2)}  heard ${row.heardWords}/${row.expectedWords} words  ${row.seconds.toFixed(1)}s`);
    console.log(`  heard: ${transcript.text}`);
    for (const f of evaluation.flags) {
      console.log(`  flag ${f.type.padEnd(7)} ${f.ayahRef} word ${f.position + 1}${f.expected ? `  expected «${f.expected}»` : ''}${f.heard ? `  heard «${f.heard}»` : ''}`);
    }
    console.log('');
  }

  const s = summarizeBench(rows);
  console.log('Summary');
  console.log(`  files ${s.files}, judged ${s.judged}, could not hear ${s.unclear}, with no flags ${s.clean}`);
  console.log(`  accuracy: mean ${s.meanAccuracy ?? 'n/a'}%, lowest ${s.minAccuracy ?? 'n/a'}%`);
  console.log(`  mean confidence ${s.meanConfidence ?? 'n/a'}; heard/expected words ${s.wordRatio ?? 'n/a'}`);
  console.log('\nOn clean recitations aim for mean accuracy of 90%+ and no "could not hear". If flags appear on words that were recited correctly, look at the "heard" line: that is the service, not the student.');
}

main().then(() => closeDb()).catch(async (err) => {
  console.error('asr:bench failed:', err instanceof Error ? err.message : err);
  await closeDb();
  process.exit(1);
});
