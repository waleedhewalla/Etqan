/**
 * Where a recitation stands, for the student and the teacher. Derived from what is stored
 * (verdict, replies, attempts) rather than kept in its own column, so it cannot disagree with the data.
 */

/** A student may record the same verses this many times; the verdict on the last attempt is final. */
export const MAX_ATTEMPTS = 3;

export type TasmiStatus =
  | 'submitted'           // received, nobody has opened it
  | 'under_review'        // a teacher has opened it
  | 'feedback_given'      // the teacher replied but has not graded yet
  | 'revision_requested'  // «يُعاد»: the student should record again
  | 'revised'             // «يُعاد», and she has recorded again
  | 'referred'            // sent to the sheikha
  | 'final_graded';       // accepted, or the last allowed attempt was graded

export interface StatusFacts {
  verdict: 'approved' | 'redo' | 'flagged' | null;
  attempt: number;
  /** A later attempt replaces this one. */
  hasLaterAttempt: boolean;
  reviewStartedAt: Date | null;
  /** The teacher left a written or recorded reply. */
  hasReply: boolean;
}

export function tasmiStatus(f: StatusFacts, maxAttempts = MAX_ATTEMPTS): TasmiStatus {
  if (f.verdict === 'approved') return 'final_graded';
  if (f.verdict === 'flagged') return 'referred';
  if (f.verdict === 'redo') {
    if (f.hasLaterAttempt) return 'revised';
    return f.attempt >= maxAttempts ? 'final_graded' : 'revision_requested';
  }
  if (f.hasReply) return 'feedback_given';
  return f.reviewStartedAt ? 'under_review' : 'submitted';
}

/** Whether the student may record these verses again in place of this attempt. */
export function canRevise(f: StatusFacts, maxAttempts = MAX_ATTEMPTS): boolean {
  return tasmiStatus(f, maxAttempts) === 'revision_requested';
}
