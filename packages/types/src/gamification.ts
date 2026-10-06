/**
 * Gamification: badges, achievements, and rewards
 */

export type BadgeCategory =
  | 'streak'
  | 'surah_mastery'
  | 'juz_completion'
  | 'tajweed_excellence'
  | 'peer_muraja'
  | 'consistency'
  | 'milestone';

export interface BadgeDefinition {
  id: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  icon: string;
  category: BadgeCategory;
  condition: BadgeCondition;
  tier: 'bronze' | 'silver' | 'gold' | 'diamond';
}

export interface BadgeCondition {
  type: 'streak_days' | 'surah_complete' | 'juz_complete' | 'tajweed_zero_errors' | 'peer_sessions' | 'total_reviews' | 'mastery_percent';
  value: number;
  surahNumber?: number;
  juzNumber?: number;
}

export interface StudentBadge {
  id: string;
  studentId: string;
  badgeId: string;
  earnedAt: Date;
  evidence: string;
}
