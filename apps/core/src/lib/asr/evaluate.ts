import { alignWords, splitWords, summarizeAlignment } from '@itqan/quran';
import type { FlaggedWord, Transcript } from './types';

export interface ExpectedAyah {
  ref: string;
  textUthmani: string;
}

export interface Evaluation {
  /** `unclear` = too little was heard to judge; nothing is flagged and she is asked to re-record. */
  status: 'done' | 'unclear';
  /** Share of expected words said correctly, 0–100. */
  accuracy: number;
  /** 0–1 */
  confidence: number;
  flags: FlaggedWord[];
  readyForApproval: boolean;
}

/** Below this share of the expected words, the recording is treated as unusable. */
const MIN_COVERAGE = 0.3;
/** Without a score from the service we assume a middling one, so nothing is "ready" on silence alone. */
const DEFAULT_CONFIDENCE = 0.8;
const MIN_CONFIDENCE = 0.5;
const READY_ACCURACY = 98;
const READY_CONFIDENCE = 0.8;

/**
 * Compares what was heard with the Quran text, word by word. Pure: no database, no audio.
 * The result is only a first look for the teacher, never a grade.
 */
export function evaluate(ayat: ExpectedAyah[], transcript: Transcript): Evaluation {
  const expected = ayat.flatMap((a) =>
    splitWords(a.textUthmani).map((word, position) => ({ ayahRef: a.ref, position, word })));
  const heard = splitWords(transcript.text);
  const confidence = transcript.confidence ?? DEFAULT_CONFIDENCE;

  const ops = alignWords(expected.map((e) => e.word), heard);
  const summary = summarizeAlignment(ops, expected.length);
  const coverage = expected.length === 0 ? 0 : (summary.ok + summary.wrong) / expected.length;

  if (expected.length === 0 || coverage < MIN_COVERAGE || confidence < MIN_CONFIDENCE) {
    return { status: 'unclear', accuracy: summary.accuracy, confidence, flags: [], readyForApproval: false };
  }

  const flags: FlaggedWord[] = [];
  let lastExpected = 0;
  for (const op of ops) {
    if (op.type === 'ok') { lastExpected = op.expectedIndex; continue; }
    if (op.type === 'added') {
      const anchor = expected[lastExpected];
      flags.push({ id: `f${flags.length + 1}`, ayahRef: anchor.ayahRef, position: anchor.position, type: 'added', heard: heard[op.heardIndex] });
      continue;
    }
    lastExpected = op.expectedIndex;
    const e = expected[op.expectedIndex];
    flags.push({
      id: `f${flags.length + 1}`, ayahRef: e.ayahRef, position: e.position, type: op.type, expected: e.word,
      ...(op.type === 'wrong' ? { heard: heard[op.heardIndex] } : {}),
    });
  }

  return {
    status: 'done',
    accuracy: summary.accuracy,
    confidence,
    flags,
    readyForApproval: flags.length === 0 && summary.accuracy >= READY_ACCURACY && confidence >= READY_CONFIDENCE,
  };
}
