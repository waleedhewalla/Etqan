import { UpstreamError } from '../errors';
import type { AsrProvider, TranscribeInput } from './types';

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

  async transcribe({ audio, contentType, filename }: TranscribeInput) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type: contentType }), filename);
    form.append('model', this.model);
    form.append('language', 'ar');
    form.append('response_format', 'json');

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
        method: 'POST',
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new UpstreamError('asr', err instanceof Error ? err.message : 'request failed');
    }
    if (!res.ok) throw new UpstreamError('asr', `HTTP ${res.status}`);

    const body = await res.json().catch(() => null) as { text?: unknown } | null;
    if (typeof body?.text !== 'string') throw new UpstreamError('asr', 'unexpected response');
    return { text: body.text };
  }
}
