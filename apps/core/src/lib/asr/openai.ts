import { UpstreamError } from '../errors';
import type { AsrProvider, TranscribeInput, Transcript } from './types';

/**
 * Any service that implements OpenAI's `POST /audio/transcriptions` (OpenAI itself, or a
 * self-hosted Whisper server). The expected text is never sent, see AsrProvider.
 */
export class OpenAICompatibleProvider implements AsrProvider {
  readonly name = 'openai-compatible';

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    private readonly model: string,
    private readonly timeoutMs = 90_000,
  ) {}

  async transcribe(input: TranscribeInput) {
    // verbose_json adds per-segment log-probabilities, which give a rough confidence. Some servers
    // only know plain json, so a 400/422 is retried once without it.
    const verbose = await this.request(input, 'verbose_json');
    if (verbose.ok) return parseTranscript(await verbose.json().catch(() => null));
    if (verbose.status !== 400 && verbose.status !== 422) throw new UpstreamError('asr', `HTTP ${verbose.status}`);

    const plain = await this.request(input, 'json');
    if (!plain.ok) throw new UpstreamError('asr', `HTTP ${plain.status}`);
    return parseTranscript(await plain.json().catch(() => null));
  }

  private async request({ audio, contentType, filename }: TranscribeInput, format: 'json' | 'verbose_json') {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type: contentType }), filename);
    form.append('model', this.model);
    form.append('language', 'ar');
    form.append('response_format', format);
    try {
      return await fetch(`${this.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
        method: 'POST',
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new UpstreamError('asr', err instanceof Error ? err.message : 'request failed');
    }
  }
}

/**
 * Reads the text, and a 0–1 confidence from the segments' average log-probability when present
 * (e^mean). Whisper's scale is not calibrated for Quranic recitation: the bench reports it so you
 * can see what it looks like on your own samples before trusting the "could not hear" cut-off.
 */
export function parseTranscript(body: unknown): Transcript {
  const b = body as { text?: unknown; segments?: { avg_logprob?: unknown }[] } | null;
  if (typeof b?.text !== 'string') throw new UpstreamError('asr', 'unexpected response');

  const logprobs = (b.segments ?? []).map((s) => s.avg_logprob).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (logprobs.length === 0) return { text: b.text };
  const mean = logprobs.reduce((a, v) => a + v, 0) / logprobs.length;
  return { text: b.text, confidence: Math.min(1, Math.max(0, Math.exp(mean))) };
}
