import { and, isNotNull, isNull, lt, or } from 'drizzle-orm';
import type { Database } from '../db';
import { tasmiSubmissions, users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { auditLog } from '../modules/audit/service';
import { config } from '../config';
import { getStorage } from './storage';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Deletes recordings that have outlived their purpose: those reviewed more than
 * AUDIO_RETENTION_HOURS ago, and those nobody reviewed within AUDIO_UNREVIEWED_MAX_DAYS.
 * The score, notes and flags stay; only the audio goes. A recording whose file could not be
 * removed keeps its row, so the next run tries again. Returns how many were deleted.
 */
export async function purgeExpiredAudio(db: Database, now = new Date()) {
  const reviewedBefore = new Date(now.getTime() - config.AUDIO_RETENTION_HOURS * HOUR);
  const unreviewedBefore = new Date(now.getTime() - config.AUDIO_UNREVIEWED_MAX_DAYS * DAY);

  const expired = await db.select({
    id: tasmiSubmissions.id, key: tasmiSubmissions.audioKey, tenantId: users.tenantId, reviewed: tasmiSubmissions.reviewedAt,
  })
    .from(tasmiSubmissions)
    .innerJoin(users, eq(users.id, tasmiSubmissions.studentId))
    .where(and(
      isNotNull(tasmiSubmissions.audioKey),
      isNull(tasmiSubmissions.audioDeletedAt),
      or(
        lt(tasmiSubmissions.reviewedAt, reviewedBefore),
        and(isNull(tasmiSubmissions.reviewedAt), lt(tasmiSubmissions.submittedAt, unreviewedBefore)),
      ),
    ))
    .limit(200);

  let deleted = 0;
  for (const row of expired) {
    try {
      await getStorage().delete(row.key!);
    } catch (err) {
      console.error('[RETENTION] could not delete', row.id, err instanceof Error ? err.message : err);
      continue;
    }
    await db.update(tasmiSubmissions)
      .set({ audioKey: null, audioDeletedAt: now })
      .where(eq(tasmiSubmissions.id, row.id));
    await auditLog({
      actorRole: 'system', tenantId: row.tenantId ?? undefined, action: 'tasmi.audio.expire',
      targetType: 'tasmi_submission', targetId: row.id, metadata: { reason: row.reviewed ? 'reviewed' : 'unreviewed' },
    });
    deleted++;
  }
  return deleted + await purgeExpiredReplies(db, now);
}

/**
 * Deletes teachers' voice replies older than AUDIO_UNREVIEWED_MAX_DAYS: long enough for the student to
 * listen, and no longer. The text reply and the scores stay.
 */
async function purgeExpiredReplies(db: Database, now: Date) {
  const before = new Date(now.getTime() - config.AUDIO_UNREVIEWED_MAX_DAYS * DAY);
  const expired = await db.select({ id: tasmiSubmissions.id, key: tasmiSubmissions.replyAudioKey })
    .from(tasmiSubmissions)
    .where(and(isNotNull(tasmiSubmissions.replyAudioKey), lt(tasmiSubmissions.replyAt, before)))
    .limit(200);

  let deleted = 0;
  for (const row of expired) {
    try {
      await getStorage().delete(row.key!);
    } catch (err) {
      console.error('[RETENTION] could not delete reply', row.id, err instanceof Error ? err.message : err);
      continue;
    }
    await db.update(tasmiSubmissions)
      .set({ replyAudioKey: null, replyAudioContentType: null, replyAudioBytes: null, replyDurationMs: null })
      .where(eq(tasmiSubmissions.id, row.id));
    deleted++;
  }
  return deleted;
}
