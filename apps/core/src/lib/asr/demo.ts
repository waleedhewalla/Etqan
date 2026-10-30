import { splitWords } from '@itqan/quran';
import type { AsrProvider } from './types';

/**
 * For trying the screens without a service: "hears" the expected text but skips its
 * third word and swaps its fifth. It cannot hear anything, so it is refused in production.
 */
export class DemoAsrProvider implements AsrProvider {
  readonly name = 'demo';

  async transcribe({ expectedText }: { expectedText: string }) {
    const words = splitWords(expectedText);
    if (words.length >= 6) {
      words[4] = 'كلمة';
      words.splice(2, 1);
    }
    return { text: words.join(' '), confidence: 0.9 };
  }
}
