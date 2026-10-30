import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Database } from '../db';
import { consents } from '../db/schema';

type Purpose = typeof consents.$inferSelect['purpose'];

/** True when the user has granted `purpose` and has not withdrawn it. */
export async function hasConsent(db: Database, userId: string, purpose: Purpose): Promise<boolean> {
  const [row] = await db.select({ id: consents.id }).from(consents)
    .where(and(
      eq(consents.userId, userId),
      eq(consents.purpose, purpose),
      isNotNull(consents.grantedAt),
      isNull(consents.withdrawnAt),
    )).limit(1);
  return Boolean(row);
}
