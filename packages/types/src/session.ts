/**
 * Session and practice types
 */

export type SessionMode = 'read' | 'first-letter' | 'blanks' | 'hidden' | 'type-it' | 'verse-between' | 'order-scramble';
export type SessionStatus = 'active' | 'paused' | 'completed' | 'abandoned';
export type ItemStatus = 'pending' | 'current' | 'completed' | 'skipped';

export interface Session {
  id: string;
  studentId: string;
  startedAt: Date;
  completedAt: Date | null;
  status: SessionStatus;
  durationSeconds: number | null;
  itemsReviewed: number;
  itemsNew: number;
  itemsMutashabihat: number;
  masteryGained: number;
  errorsCaught: number;
  mode: SessionMode | null;
}

export interface SessionItem {
  id: string;
  sessionId: string;
  ayahRef: Ref;
  transitionId: string | null;
  mode: SessionMode;
  status: ItemStatus;
  selfRating: Rating | null;
  voiceCheckResult: VoiceCheckResult | null;
  timeSpentMs: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  order: number;
}

export interface VoiceCheckResult {
  matched: boolean;
  confidence: number;
  errors: WordError[];
  engine: 'tarteel' | 'whisper';
  audioUrl: string | null;
  processingTimeMs: number;
}

export interface WordError {
  wordIndex: number;
  expected: string;
  got: string;
  type: 'missing' | 'wrong' | 'added' | 'hesitation';
  severity: 'khafiyy' | 'jaliyy';
  tajweedRule: string | null;
}

export interface SessionSummary {
  sessionId: string;
  itemsMastered: number;
  itemsReviewed: number;
  newItemsLearned: number;
  mutashabihatHandled: number;
  errors: WordError[];
  streakBefore: number;
  streakAfter: number;
  freezesRemaining: number;
  nextSessionEta: Date | null;
  recommendedRecovery: RecoveryPlan | null;
}

export interface RecoveryPlan {
  missedSessions: number;
  catchUpMinutes: number;
  adjustedQueue: QueueItem[];
  message: string;
}

export interface StreakState {
  studentId: string;
  currentStreak: number;
  longestStreak: number;
  freezesRemaining: number;
  lastActiveDate: Date | null;
  freezeHistory: StreakFreeze[];
}

export interface StreakFreeze {
  date: Date;
  reason: 'manual' | 'auto' | 'excused';
  usedAt: Date;
}