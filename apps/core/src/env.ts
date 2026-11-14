/**
 * Loads `.env` for local development. Import this first, for its side effect.
 *
 * The file documented in TESTING.md lives at the repository root, but pnpm runs the API from `apps/core`,
 * so the working directory alone is not enough: both places are read (the nearer one wins). Variables already
 * set in the environment are never overwritten, and in a container there is no file, so nothing happens.
 */
import path from 'node:path';
import dotenv from 'dotenv';

for (const file of ['.env', '../../.env']) {
  dotenv.config({ path: path.resolve(process.cwd(), file) });
}

/** The database `docker compose up` starts, for a machine with no `.env` at all. Never used in production. */
export const DEV_DATABASE_URL = 'postgresql://itqan:itqan_dev_password@localhost:5432/itqan';

/** The database to connect to, or undefined when none is configured (production must say explicitly). */
export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL || (process.env.NODE_ENV === 'production' ? undefined : DEV_DATABASE_URL);
}
