import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { users } from '../db/schema';
import { config } from '../config';

/**
 * Whether an account has been stopped. A session token lasts weeks, so stopping an account has to be checked on
 * each request, not only when the token is issued. The answer is kept briefly so this is not a query per request;
 * stopping or restoring an account in this process forgets it at once.
 */
const KEPT_FOR_MS = config.NODE_ENV === 'test' ? 0 : 15_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const known = new Map<string, { stopped: boolean; at: number }>();

/** True only for an account that exists and is stopped: a token for no account at all is left to the routes. */
export async function isStopped(userId: string): Promise<boolean> {
  if (!UUID.test(userId)) return false;
  const hit = known.get(userId);
  if (hit && Date.now() - hit.at < KEPT_FOR_MS) return hit.stopped;
  const [row] = await getDb().select({ active: users.active }).from(users).where(eq(users.id, userId)).limit(1);
  const stopped = row ? !row.active : false;
  known.set(userId, { stopped, at: Date.now() });
  if (known.size > 5000) known.clear();
  return stopped;
}

export const forgetStopped = (userId: string) => { known.delete(userId); };
