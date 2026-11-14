import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { users } from '../db/schema';
import { config } from '../config';

/**
 * Whether an account is still active, and what role it has now. A session token lasts weeks, so both are checked on each
 * request, not only when the token is issued: a stopped account is refused, and a role that was changed applies at once.
 * The answer is kept briefly so this is not a query per request; changing an account in this process forgets it at once.
 */
const KEPT_FOR_MS = config.NODE_ENV === 'test' ? 0 : 15_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface AccountState { active: boolean; role: string }
const known = new Map<string, { state: AccountState | null; at: number }>();

/** The account's state, or null when there is no such account (a token for no account at all is left to the routes). */
export async function accountState(userId: string): Promise<AccountState | null> {
  if (!UUID.test(userId)) return null;
  const hit = known.get(userId);
  if (hit && Date.now() - hit.at < KEPT_FOR_MS) return hit.state;
  const [row] = await getDb().select({ active: users.active, role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  const state = row ? { active: row.active, role: row.role as string } : null;
  known.set(userId, { state, at: Date.now() });
  if (known.size > 5000) known.clear();
  return state;
}

/** True only for an account that exists and is stopped. */
export async function isStopped(userId: string): Promise<boolean> {
  const state = await accountState(userId);
  return Boolean(state && !state.active);
}

export const forgetStopped = (userId: string) => { known.delete(userId); };
