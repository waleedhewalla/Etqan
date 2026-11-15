/**
 * Whether the database has every migration the code expects. A database that is behind (the code was updated and
 * `db:migrate` was not run) makes whole screens fail with a vague error; this lets the server say so plainly.
 */
import { readFile } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import type { Database } from '../db';

export interface MigrationStatus {
  /** Migrations the code has that the database lacks; null when it could not be worked out (a database set up another way). */
  pending: number | null;
}

/** Counts the migration files against the ones the database recorded as applied. */
export async function readMigrationStatus(db: Database, folder = './drizzle'): Promise<MigrationStatus> {
  try {
    const journal = JSON.parse(await readFile(`${folder}/meta/_journal.json`, 'utf8')) as { entries: unknown[] };
    const rows = await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`) as unknown as { n: number }[];
    return { pending: Math.max(0, journal.entries.length - Number(rows[0]?.n ?? 0)) };
  } catch {
    return { pending: null };
  }
}

let cached: { at: number; status: MigrationStatus } | null = null;
const TTL_MS = 15_000;

/** The same, remembered for a few seconds so a health check that is polled often costs nothing. */
export async function migrationStatus(db: Database, now = Date.now()): Promise<MigrationStatus> {
  if (cached && now - cached.at < TTL_MS) return cached.status;
  const status = await readMigrationStatus(db);
  cached = { at: now, status };
  return status;
}

/** For tests. */
export const forgetMigrationStatus = () => { cached = null; };
