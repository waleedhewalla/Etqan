import { normalizeArabic } from './arabic';

export type AlignOp =
  /** The reciter said the expected word. */
  | { type: 'ok'; expectedIndex: number; heardIndex: number }
  /** She said a different word where this one was expected. */
  | { type: 'wrong'; expectedIndex: number; heardIndex: number }
  /** The expected word was not said. */
  | { type: 'missing'; expectedIndex: number }
  /** A word was said that is not in the text (a repeat, a restart, or extra speech). */
  | { type: 'added'; heardIndex: number };

/**
 * What two words must share to count as the same word. Besides normalizing, alefs are dropped:
 * the Uthmani text writes many long "aa" sounds with a small dagger alef (ٱلۡعَٰلَمِينَ) where ordinary
 * spelling, which is what a transcription service writes, uses a full alef (العالمين). A missing or
 * extra alef is a spelling convention, not a different word. (This makes words that differ only in
 * their alefs look equal, which is rare in the Quran and an acceptable price.)
 */
function matchKey(word: string) {
  const normalized = normalizeArabic(word);
  return normalized.replace(/\u{0627}/gu, '') || normalized;
}

/**
 * Lines up what was heard against the expected words and says, word by word, what
 * happened. Words are compared in their normalized form, so vowel marks and spelling
 * variants never count as mistakes. Uses the fewest-changes alignment, so a repeated
 * word or one skipped word does not shift every word after it.
 */
export function alignWords(expected: string[], heard: string[]): AlignOp[] {
  const a = expected.map(matchKey);
  const b = heard.map(matchKey);
  const n = a.length;
  const m = b.length;

  // cost[i][j] = fewest changes to turn a[i..] into b[j..]
  const cost: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) cost[i][m] = n - i;
  for (let j = m - 1; j >= 0; j--) cost[n][j] = m - j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const diagonal = cost[i + 1][j + 1] + (a[i] === b[j] ? 0 : 1);
      cost[i][j] = Math.min(diagonal, cost[i + 1][j] + 1, cost[i][j + 1] + 1);
    }
  }

  const ops: AlignOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m) {
      const same = a[i] === b[j];
      if (cost[i][j] === cost[i + 1][j + 1] + (same ? 0 : 1)) {
        ops.push({ type: same ? 'ok' : 'wrong', expectedIndex: i, heardIndex: j });
        i++; j++;
        continue;
      }
    }
    if (i < n && cost[i][j] === cost[i + 1][j] + 1) {
      ops.push({ type: 'missing', expectedIndex: i });
      i++;
    } else {
      ops.push({ type: 'added', heardIndex: j });
      j++;
    }
  }
  return ops;
}

export interface AlignSummary {
  ok: number;
  wrong: number;
  missing: number;
  added: number;
  /** Share of expected words said correctly, 0–100. */
  accuracy: number;
}

export function summarizeAlignment(ops: AlignOp[], expectedCount: number): AlignSummary {
  const count = (t: AlignOp['type']) => ops.filter((o) => o.type === t).length;
  const ok = count('ok');
  return {
    ok,
    wrong: count('wrong'),
    missing: count('missing'),
    added: count('added'),
    accuracy: expectedCount === 0 ? 0 : Math.round((ok / expectedCount) * 1000) / 10,
  };
}
