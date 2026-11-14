/**
 * A live lesson's recording. The teacher's browser records her own voice and screen and sends the
 * recording in pieces while the lesson runs; the pieces are appended to a file on this server and
 * moved into storage when the lesson ends. Students' voices are never part of it.
 */
import { appendFile, mkdir, stat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { and, eq, isNotNull, lt } from 'drizzle-orm';
import type { Database } from '../db';
import { liveSessions, sections } from '../db/schema';
import { config } from '../config';
import { auditLog } from '../modules/audit/service';
import { getStorage } from './storage';
import { writeWebmDuration } from './webm-duration';

type Session = typeof liveSessions.$inferSelect;
const DAY = 86_400_000;

/** One piece is about ten seconds; anything near this size is not a piece of a lesson. */
export const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
export const maxRecordingBytes = () => config.LIVE_RECORDING_MAX_MB * 1024 * 1024;

const KINDS = { webm: 'video/webm', mp4: 'video/mp4' } as const;
type Kind = keyof typeof KINDS;

/** Tells a recording's container from how it starts, or null when it is neither WebM nor MP4. */
export function sniffVideo(head: Buffer): Kind | null {
  if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3) return 'webm';
  if (head.length >= 8 && head.toString('latin1', 4, 8) === 'ftyp') return 'mp4';
  return null;
}

/** The type to serve a stored recording as: the storage only knows `.webm` as audio. */
export const recordingContentType = (key: string) => (key.endsWith('.mp4') ? KINDS.mp4 : KINDS.webm);

const partsDir = () => resolve(config.AUDIO_DIR, '.recording');
/** Where a recording grows while its lesson runs; the kind is part of the name so it survives a restart. */
const partPath = (sessionId: string, kind: Kind) => join(partsDir(), `${sessionId}.${kind}`);

export async function appendChunk(sessionId: string, kind: Kind, chunk: Buffer) {
  await mkdir(partsDir(), { recursive: true });
  await appendFile(partPath(sessionId, kind), chunk, { mode: 0o600 });
}

async function findPart(sessionId: string): Promise<{ path: string; kind: Kind; bytes: number } | null> {
  for (const kind of Object.keys(KINDS) as Kind[]) {
    const path = partPath(sessionId, kind);
    const info = await stat(path).catch(() => null);
    if (info) return { path, kind, bytes: info.size };
  }
  return null;
}

/** The kind a running recording was started as, so later pieces go to the same file. */
export const partKind = async (sessionId: string) => (await findPart(sessionId))?.kind ?? null;

/**
 * Closes a running recording: what was received moves into storage and the lesson is marked as
 * having a recording, or as failed when nothing usable arrived. Safe to call twice.
 */
export async function finalizeRecording(db: Database, session: Session, durationMs?: number | null): Promise<Session> {
  if (session.recordingStatus !== 'recording') return session;
  const part = await findPart(session.id);
  let patch: Partial<Session>;
  if (!part || part.bytes === 0) {
    if (part) await unlink(part.path).catch(() => undefined);
    patch = { recordingStatus: 'failed', recordingBytes: null };
  } else {
    const key = `sessions/${session.sectionId}/${session.id}.${part.kind}`;
    try {
      // A browser's recording does not say how long it is; with the length written in, the player shows a timeline.
      let bytes = part.bytes;
      if (part.kind === 'webm' && durationMs && await writeWebmDuration(part.path, durationMs)) bytes = (await stat(part.path)).size;
      await getStorage().putFile(key, part.path, KINDS[part.kind]);
      patch = {
        recordingStatus: 'ready', recordingKey: key, recordingBytes: bytes,
        recordingDurationMs: durationMs ?? null, recordingReadyAt: new Date(),
      };
    } catch (err) {
      console.error('[LIVE] could not store the recording of', session.id, err instanceof Error ? err.message : err);
      return session; // the pieces stay on disk; ending the lesson or the nightly job tries again
    }
  }
  // Only one caller wins when the teacher's browser and the end of the lesson both close it.
  const [updated] = await db.update(liveSessions).set(patch)
    .where(and(eq(liveSessions.id, session.id), eq(liveSessions.recordingStatus, 'recording'))).returning();
  return updated ?? session;
}

/** Removes a stored recording; the lesson, its attendance and its questions stay. */
export async function deleteRecording(db: Database, session: Session): Promise<Session> {
  if (session.recordingKey) await getStorage().delete(session.recordingKey);
  const [updated] = await db.update(liveSessions)
    .set({ recordingStatus: 'deleted', recordingKey: null, recordingBytes: null })
    .where(eq(liveSessions.id, session.id)).returning();
  return updated;
}

/**
 * Nightly: deletes recordings older than LIVE_RECORDING_RETENTION_DAYS, and closes recordings whose
 * lesson was left open for more than a day. Returns how many recordings were deleted.
 */
export async function purgeExpiredRecordings(db: Database, now = new Date()) {
  const abandoned = await db.select().from(liveSessions)
    .where(and(eq(liveSessions.recordingStatus, 'recording'), lt(liveSessions.startedAt, new Date(now.getTime() - DAY)))).limit(50);
  for (const session of abandoned) await finalizeRecording(db, session);

  const expired = await db.select({ session: liveSessions, tenantId: sections.tenantId }).from(liveSessions)
    .innerJoin(sections, eq(liveSessions.sectionId, sections.id))
    .where(and(
      isNotNull(liveSessions.recordingKey),
      lt(liveSessions.recordingReadyAt, new Date(now.getTime() - config.LIVE_RECORDING_RETENTION_DAYS * DAY)),
    )).limit(100);
  let deleted = 0;
  for (const { session, tenantId } of expired) {
    try {
      await deleteRecording(db, session);
    } catch (err) {
      console.error('[RETENTION] could not delete the recording of', session.id, err instanceof Error ? err.message : err);
      continue;
    }
    await auditLog({
      actorRole: 'system', tenantId: tenantId ?? undefined, action: 'session.recording.expired',
      targetType: 'section', targetId: session.sectionId, metadata: { sessionId: session.id },
    });
    deleted++;
  }
  return deleted;
}
