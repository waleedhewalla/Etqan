import { and, count, eq, inArray } from 'drizzle-orm';
import { AYAH_COUNTS } from '@itqan/quran';
import type { Database } from '../db';
import { badgeDefinitions, notifications, reviewLogs, streaks, studentBadges, studentCards, tasmiSubmissions } from '../db/schema';

type Category = typeof badgeDefinitions.$inferInsert['category'];
type Tier = typeof badgeDefinitions.$inferInsert['tier'];
export type ConditionType = 'streak_days' | 'reviews_total' | 'mastered_cards' | 'tasmi_approved' | 'surah_mastered';

export interface BadgeDef {
  id: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  icon: string;
  category: Category;
  tier: Tier;
  conditionType: ConditionType;
  /** Target: days, reviews, cards or recitations. For `surah_mastered`, the share of ayat (always all). */
  conditionValue: number;
  conditionSurahNumber?: number;
}

const SURAHS: [number, string, string, Tier][] = [
  [1, 'الفاتحة', 'Al-Fatiha', 'bronze'], [112, 'الإخلاص', 'Al-Ikhlas', 'bronze'],
  [113, 'الفلق', 'Al-Falaq', 'bronze'], [114, 'الناس', 'An-Nas', 'bronze'],
  [36, 'يس', 'Ya-Sin', 'gold'], [2, 'البقرة', 'Al-Baqarah', 'diamond'],
];

const ladder = (
  prefix: string, category: Category, type: ConditionType, icon: string,
  rungs: [number, Tier, string, string][], describe: (n: number) => string,
): BadgeDef[] => rungs.map(([n, tier, ar, en]) => ({
  id: `${prefix}-${n}`, nameAr: ar, nameEn: en, descriptionAr: describe(n), icon, category, tier, conditionType: type, conditionValue: n,
}));

/** Every badge a student can earn. Definitions are copied into `badge_definitions` so earned badges can reference them. */
export const BADGE_CATALOG: BadgeDef[] = [
  ...ladder('streak', 'streak', 'streak_days', '🔥', [
    [3, 'bronze', 'سلسلة ٣ أيام', '3-day streak'], [7, 'silver', 'سلسلة ٧ أيام', '7-day streak'],
    [30, 'gold', 'سلسلة ٣٠ يوماً', '30-day streak'], [100, 'diamond', 'سلسلة ١٠٠ يوم', '100-day streak'],
  ], (n) => `راجعتِ ${n} يوماً متتالياً`),
  ...ladder('reviews', 'consistency', 'reviews_total', '✨', [
    [10, 'bronze', 'أول ١٠ مراجعات', 'First 10 reviews'], [100, 'silver', '١٠٠ مراجعة', '100 reviews'],
    [500, 'gold', '٥٠٠ مراجعة', '500 reviews'], [1000, 'diamond', '١٠٠٠ مراجعة', '1000 reviews'],
  ], (n) => `أنجزتِ ${n} مراجعة`),
  ...ladder('mastered', 'milestone', 'mastered_cards', '🌟', [
    [10, 'bronze', 'أتقنتِ ١٠ آيات', '10 ayat mastered'], [50, 'silver', 'أتقنتِ ٥٠ آية', '50 ayat mastered'],
    [200, 'gold', 'أتقنتِ ٢٠٠ آية', '200 ayat mastered'],
  ], (n) => `بلغت ${n} آية حالة «متقنة»`),
  ...ladder('tasmi', 'tajweed_excellence', 'tasmi_approved', '🎙️', [
    [1, 'bronze', 'أول تسميع مقبول', 'First approved recitation'], [10, 'silver', '١٠ تسميعات مقبولة', '10 approved recitations'],
    [50, 'gold', '٥٠ تسميعاً مقبولاً', '50 approved recitations'],
  ], (n) => `قبلت معلمتكِ ${n} تسميعاً`),
  ...SURAHS.map(([n, ar, en, tier]): BadgeDef => ({
    id: `surah-${n}`, nameAr: `إتقان سورة ${ar}`, nameEn: `Mastered ${en}`, descriptionAr: `أتقنتِ كل آيات سورة ${ar}`,
    icon: '📜', category: 'surah_mastery', tier, conditionType: 'surah_mastered', conditionValue: AYAH_COUNTS[n - 1], conditionSurahNumber: n,
  })),
];

export interface Metrics {
  longestStreak: number;
  reviews: number;
  masteredCards: number;
  approvedTasmi: number;
  /** Mastered ayat per sura number. */
  masteredBySura: Record<number, number>;
}

/** How far along a student is toward a badge. */
export function progressFor(def: BadgeDef, m: Metrics): { current: number; target: number } {
  const current =
    def.conditionType === 'streak_days' ? m.longestStreak
      : def.conditionType === 'reviews_total' ? m.reviews
        : def.conditionType === 'mastered_cards' ? m.masteredCards
          : def.conditionType === 'tasmi_approved' ? m.approvedTasmi
            : m.masteredBySura[def.conditionSurahNumber ?? 0] ?? 0;
  return { current: Math.min(current, def.conditionValue), target: def.conditionValue };
}

export const isEarned = (def: BadgeDef, m: Metrics) => {
  const p = progressFor(def, m);
  return p.current >= p.target;
};

export async function loadMetrics(db: Database, studentId: string): Promise<Metrics> {
  const [streak] = await db.select({ longest: streaks.longestStreak }).from(streaks).where(eq(streaks.studentId, studentId)).limit(1);
  const [reviews] = await db.select({ n: count() }).from(reviewLogs)
    .innerJoin(studentCards, eq(studentCards.id, reviewLogs.cardId)).where(eq(studentCards.studentId, studentId));
  const [approved] = await db.select({ n: count() }).from(tasmiSubmissions)
    .where(and(eq(tasmiSubmissions.studentId, studentId), eq(tasmiSubmissions.reviewVerdict, 'approved')));
  const mastered = await db.select({ ref: studentCards.ayahRef }).from(studentCards)
    .where(and(eq(studentCards.studentId, studentId), eq(studentCards.state, 'mastered')));

  const masteredBySura: Record<number, number> = {};
  for (const { ref } of mastered) {
    const sura = Number(ref.split(':')[0]);
    masteredBySura[sura] = (masteredBySura[sura] ?? 0) + 1;
  }
  return {
    longestStreak: streak?.longest ?? 0, reviews: reviews?.n ?? 0, masteredCards: mastered.length,
    approvedTasmi: approved?.n ?? 0, masteredBySura,
  };
}

let ensured: Promise<void> | null = null;

/** Copies the catalog into `badge_definitions` (once per process; safe to repeat). */
export function ensureBadgeDefinitions(db: Database) {
  ensured ??= (async () => {
    await db.insert(badgeDefinitions).values(BADGE_CATALOG.map((b) => ({
      id: b.id, nameAr: b.nameAr, nameEn: b.nameEn, descriptionAr: b.descriptionAr, icon: b.icon, category: b.category, tier: b.tier,
      conditionType: b.conditionType, conditionValue: b.conditionValue, conditionSurahNumber: b.conditionSurahNumber ?? null,
    }))).onConflictDoNothing();
  })().catch((err) => { ensured = null; throw err; });
  return ensured;
}

export interface EarnedBadge { id: string; nameAr: string; icon: string; tier: Tier }

/**
 * Awards every badge the student now qualifies for and has not got yet, and leaves an in-app
 * notification for each. Never throws: a badge problem must not break the rating or review that triggered it.
 */
export async function awardBadges(db: Database, studentId: string): Promise<EarnedBadge[]> {
  try {
    await ensureBadgeDefinitions(db);
    const metrics = await loadMetrics(db, studentId);
    const qualifying = BADGE_CATALOG.filter((b) => isEarned(b, metrics));
    if (qualifying.length === 0) return [];

    const have = new Set((await db.select({ id: studentBadges.badgeId }).from(studentBadges)
      .where(and(eq(studentBadges.studentId, studentId), inArray(studentBadges.badgeId, qualifying.map((b) => b.id))))).map((r) => r.id));
    const fresh = qualifying.filter((b) => !have.has(b.id));
    if (fresh.length === 0) return [];

    const inserted = await db.insert(studentBadges)
      .values(fresh.map((b) => ({ studentId, badgeId: b.id, evidence: progressFor(b, metrics) })))
      .onConflictDoNothing().returning({ id: studentBadges.badgeId });
    const earned = fresh.filter((b) => inserted.some((r) => r.id === b.id));

    if (earned.length) {
      await db.insert(notifications).values(earned.map((b) => ({
        userId: studentId, titleAr: 'وسام جديد', bodyAr: `${b.icon} ${b.nameAr}: ${b.descriptionAr}`, data: { badgeId: b.id },
      })));
    }
    return earned.map((b) => ({ id: b.id, nameAr: b.nameAr, icon: b.icon, tier: b.tier }));
  } catch (err) {
    console.error('[BADGES] could not award badges', err instanceof Error ? err.message : err);
    return [];
  }
}
