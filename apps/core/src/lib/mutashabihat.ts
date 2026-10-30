import { alignWords, normalizeArabic, splitWords } from '@itqan/quran';

export interface ClusterAyah {
  ref: string;
  text: string;
}

export interface ClozeDrill {
  type: 'cloze';
  targetRef: string;
  /** The verse with the differing word replaced by a blank. */
  question: string;
  /** The words the verses in the cluster use at that spot, shuffled. */
  options: string[];
  correctAnswer: string;
}

export interface ChoiceDrill {
  type: 'timed-choice';
  targetRef: string;
  /** The whole verse; the student says which one of the look-alikes it is. */
  question: string;
  options: string[];
  correctAnswer: string;
}

export const BLANK = '＿＿＿＿';

export type Rng = () => number;

export function shuffle<T>(items: T[], rng: Rng = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The one word that `other` swaps for a word of `target`, as a position in `target`. Null unless that is the
 * ONLY difference: a skipped or extra word, or several swaps, cannot make a clear one-word question.
 */
export function singleSwap(target: string, other: string) {
  const a = splitWords(target);
  const b = splitWords(other);
  const changes = alignWords(a, b).filter((op) => op.type !== 'ok');
  const [only] = changes;
  if (changes.length !== 1 || only.type !== 'wrong') return null;
  return { index: only.expectedIndex, mine: a[only.expectedIndex], theirs: b[only.heardIndex] };
}

/**
 * "Fill the blank": hides the word that another verse of the cluster replaces, and offers what each of the
 * verses uses there. Null when no verse differs from the target by exactly one swapped word.
 */
export function buildCloze(target: ClusterAyah, others: ClusterAyah[], rng: Rng = Math.random): ClozeDrill | null {
  for (const other of others) {
    const first = singleSwap(target.text, other.text);
    if (!first) continue;

    const words = splitWords(target.text);
    const seen = new Set([normalizeArabic(first.mine)]);
    const options = [first.mine];
    for (const o of others) {
      const swap = singleSwap(target.text, o.text);
      if (swap && swap.index === first.index && !seen.has(normalizeArabic(swap.theirs))) {
        seen.add(normalizeArabic(swap.theirs));
        options.push(swap.theirs);
      }
    }
    words[first.index] = BLANK;
    return { type: 'cloze', targetRef: target.ref, question: words.join(' '), options: shuffle(options, rng), correctAnswer: first.mine };
  }
  return null;
}

/** The verses whose wording appears only once in the cluster: the only ones "which verse is this?" can ask about. */
export function distinctAyat(all: ClusterAyah[]): ClusterAyah[] {
  const count = new Map<string, number>();
  for (const a of all) count.set(normalizeArabic(a.text), (count.get(normalizeArabic(a.text)) ?? 0) + 1);
  return all.filter((a) => count.get(normalizeArabic(a.text)) === 1);
}

/**
 * "Which verse is this?": the whole verse, and the references of all the look-alikes. Null when another verse of
 * the cluster is worded identically (only its surroundings differ), because the text alone cannot tell them apart.
 */
export function buildChoice(target: ClusterAyah, all: ClusterAyah[], rng: Rng = Math.random): ChoiceDrill | null {
  if (!distinctAyat(all).some((a) => a.ref === target.ref)) return null;
  return { type: 'timed-choice', targetRef: target.ref, question: target.text, options: shuffle(all.map((a) => a.ref), rng), correctAnswer: target.ref };
}
