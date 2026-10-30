export interface TranscribeInput {
  audio: Buffer;
  contentType: string;
  filename: string;
}

export interface Transcript {
  /** What was heard, as plain text. */
  text: string;
  /** 0–1, when the service reports how sure it is. */
  confidence?: number;
}

/**
 * Turns a recording into text. A real service must NOT be given the expected text:
 * that makes it "hear" words that were not said, hiding exactly the mistakes we want
 * to find. (`expectedText` is passed only so the demo provider can fake a result.)
 * Comparing against the Quran text is done afterwards, in `evaluate`.
 */
export interface AsrProvider {
  readonly name: string;
  transcribe(input: TranscribeInput & { expectedText: string }): Promise<Transcript>;
}

/** One word the checker wants the teacher to look at. */
export interface FlaggedWord {
  id: string;
  ayahRef: string;
  /** 0-based position of the word in the ayah. For `added`, the word it follows. */
  position: number;
  type: 'missing' | 'wrong' | 'added';
  expected?: string;
  heard?: string;
  /** The student says the flag is wrong. */
  disputed?: boolean;
  /** The teacher's decision, once she has looked. */
  decision?: 'confirmed' | 'dismissed';
}
