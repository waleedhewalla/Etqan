import { addDays, daysBetween } from './dates';

export interface StreakState {
  currentStreak: number;
  longestStreak: number;
  freezesRemaining: number;
  lastActiveDate: string | null;
}

export interface StreakUpdate {
  state: StreakState;
  /** Days covered by a freeze so the streak survives a single missed day. */
  frozenDates: string[];
}

/**
 * Applies one day of activity to a streak.
 * Same day: no change. Next day: +1. One missed day with a freeze left: the
 * freeze covers it and the streak continues. Anything longer: restart at 1.
 */
export function recordActivity(prev: StreakState, today: string): StreakUpdate {
  if (prev.lastActiveDate === today) return { state: prev, frozenDates: [] };

  const gap = prev.lastActiveDate ? daysBetween(prev.lastActiveDate, today) : Infinity;
  let current = 1;
  let freezes = prev.freezesRemaining;
  const frozenDates: string[] = [];

  if (gap === 1) {
    current = prev.currentStreak + 1;
  } else if (gap === 2 && freezes > 0 && prev.currentStreak > 0) {
    freezes -= 1;
    frozenDates.push(addDays(today, -1));
    current = prev.currentStreak + 1;
  } else if (gap < 1) {
    // Clock moved backwards; keep the streak as it was.
    return { state: prev, frozenDates: [] };
  }

  return {
    state: {
      currentStreak: current,
      longestStreak: Math.max(prev.longestStreak, current),
      freezesRemaining: freezes,
      lastActiveDate: today,
    },
    frozenDates,
  };
}
