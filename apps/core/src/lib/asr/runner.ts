import { and, asc, eq, inArray, lt } from 'drizzle-orm';
import { compareRefs, countAyat, parseRef } from '@itqan/quran';
import type { Database } from '../../db';
import { quranAyat, tasmiSubmissions, tenants } from '../../db/schema';
import { hasConsent } from '../consent';
import { ayatInRange } from '../quran-range';
import { getStorage } from '../storage';
import { getAsrProvider } from './index';
import { evaluate } from './evaluate';

/** Checking is on only when the deployment has a provider, the institution switched it on, and the student agreed. */
export async function isCheckEnabled(db: Database, tenantId: string | undefined, studentId: string) {
  if (!tenantId || !getAsrProvider()) return false;
  const [tenant] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (tenant?.settings?.aiChecking !== true) return false;
  return hasConsent(db, studentId, 'ai_processing');
}

const inflight = new Set<Promise<void>>();

/** Starts a check in the background. The submission must already be marked `pending`. */
export function scheduleAsrCheck(db: Database, submissionId: string) {
  const job: Promise<void> = runAsrCheck(db, submissionId)
    .catch((err) => console.error('[ASR] check crashed', submissionId, err instanceof Error ? err.message : err))
    .finally(() => { inflight.delete(job); });
  inflight.add(job);
}

/** Resolves when every check started so far has finished (tests, shutdown). */
export async function drainChecks() {
  while (inflight.size) await Promise.all([...inflight]);
}

const fail = (db: Database, id: string, status: 'failed' | 'skipped', message: string) =>
  db.update(tasmiSubmissions)
    .set({ aiStatus: status, aiError: message.slice(0, 300), aiCheckedAt: new Date() })
    .where(eq(tasmiSubmissions.id, id));

/** Checks one submission. Safe to call twice: only a `pending` row is claimed. */
export async function runAsrCheck(db: Database, submissionId: string) {
  const [row] = await db.update(tasmiSubmissions)
    .set({ aiStatus: 'processing', aiCheckedAt: new Date() })
    .where(and(eq(tasmiSubmissions.id, submissionId), eq(tasmiSubmissions.aiStatus, 'pending')))
    .returning();
  if (!row) return;

  const provider = getAsrProvider();
  if (!provider) return void await fail(db, row.id, 'skipped', 'recitation checking is switched off');
  if (!row.audioKey || row.audioDeletedAt) return void await fail(db, row.id, 'skipped', 'the recording was deleted');

  const start = parseRef(row.startRef);
  const end = parseRef(row.endRef);
  if (!start || !end || compareRefs(start, end) > 0) return void await fail(db, row.id, 'failed', 'invalid verse range');

  const ayat = await db.select({ ref: quranAyat.ref, textUthmani: quranAyat.textUthmani })
    .from(quranAyat).where(ayatInRange(start, end)).orderBy(asc(quranAyat.sura), asc(quranAyat.ayah));
  if (ayat.length !== countAyat(start, end)) {
    return void await fail(db, row.id, 'skipped', 'the Quran text is not loaded for this range');
  }

  try {
    const object = await getStorage().get(row.audioKey);
    if (!object) return void await fail(db, row.id, 'skipped', 'the recording is missing from storage');
    const chunks: Buffer[] = [];
    for await (const chunk of object.body) chunks.push(Buffer.from(chunk as Buffer));

    const transcript = await provider.transcribe({
      audio: Buffer.concat(chunks),
      contentType: object.contentType,
      filename: `recitation.${row.audioKey.split('.').pop() ?? 'webm'}`,
      expectedText: ayat.map((a) => a.textUthmani).join(' '),
    });
    const result = evaluate(ayat, transcript);

    await db.update(tasmiSubmissions).set({
      aiStatus: result.status,
      aiProvider: provider.name,
      aiCheckedAt: new Date(),
      aiError: null,
      aiHifzAccuracy: result.status === 'done' ? result.accuracy : null,
      aiConfidence: result.confidence,
      aiFlaggedErrors: result.flags,
      aiReadyForApproval: result.readyForApproval,
    }).where(eq(tasmiSubmissions.id, row.id));
  } catch (err) {
    await fail(db, row.id, 'failed', err instanceof Error ? err.message : 'check failed');
  }
}

const STUCK_AFTER_MS = 5 * 60_000;

/**
 * Picks up checks that were queued but never ran (the API restarted), and releases
 * ones stuck in `processing`. Called on start-up and every minute.
 */
export async function sweepPendingChecks(db: Database) {
  await db.update(tasmiSubmissions).set({ aiStatus: 'pending' })
    .where(and(eq(tasmiSubmissions.aiStatus, 'processing'), lt(tasmiSubmissions.aiCheckedAt, new Date(Date.now() - STUCK_AFTER_MS))));
  const pending = await db.select({ id: tasmiSubmissions.id }).from(tasmiSubmissions)
    .where(inArray(tasmiSubmissions.aiStatus, ['pending'])).limit(20);
  for (const { id } of pending) scheduleAsrCheck(db, id);
  return pending.length;
}
