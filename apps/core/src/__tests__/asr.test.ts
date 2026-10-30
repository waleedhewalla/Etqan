import { createServer, type IncomingMessage, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evaluate } from '../lib/asr/evaluate';
import { DemoAsrProvider } from '../lib/asr/demo';
import { OpenAICompatibleProvider, parseTranscript } from '../lib/asr/openai';
import { summarizeBench, type BenchRow } from '../lib/asr/bench';

// Placeholder words, not Quran text.
const ayat = [
  { ref: '9:1', textUthmani: 'كَلِمَةٌ أُولَى هُنَا' },
  { ref: '9:2', textUthmani: 'كَلِمَةٌ ثَانِيَةٌ هُنَاكَ الآنَ' },
];
const spoken = 'كلمة اولى هنا كلمة ثانية هناك الان';

describe('evaluate', () => {
  it('marks a clean recitation ready for the teacher to approve', () => {
    const r = evaluate(ayat, { text: spoken, confidence: 0.95 });
    expect(r).toMatchObject({ status: 'done', accuracy: 100, flags: [], readyForApproval: true });
  });

  it('flags a skipped word at the right ayah and position', () => {
    const r = evaluate(ayat, { text: 'كلمة اولى هنا كلمة هناك الان', confidence: 0.95 });
    expect(r.status).toBe('done');
    expect(r.flags).toEqual([{ id: 'f1', ayahRef: '9:2', position: 1, type: 'missing', expected: 'ثَانِيَةٌ' }]);
    expect(r.accuracy).toBeCloseTo(85.7, 1);
    expect(r.readyForApproval).toBe(false);
  });

  it('flags a wrong word with what was heard, and an added word after the one before it', () => {
    const r = evaluate(ayat, { text: 'كلمة اولى هنا كلمة ثانية بعيد هناك الان زيادة', confidence: 0.95 });
    expect(r.flags.map((f) => [f.type, f.ayahRef, f.position])).toEqual([
      ['added', '9:2', 1],
      ['added', '9:2', 3],
    ]);
    const wrong = evaluate(ayat, { text: 'كلمة اولى هنا كلمة بعيدة هناك الان', confidence: 0.95 });
    expect(wrong.flags).toEqual([{ id: 'f1', ayahRef: '9:2', position: 1, type: 'wrong', expected: 'ثَانِيَةٌ', heard: 'بعيدة' }]);
  });

  it('does not judge a recording it could barely hear', () => {
    for (const text of ['', 'كلمة']) {
      const r = evaluate(ayat, { text, confidence: 0.9 });
      expect(r).toMatchObject({ status: 'unclear', flags: [], readyForApproval: false });
    }
    expect(evaluate(ayat, { text: spoken, confidence: 0.3 }).status).toBe('unclear');
  });

  it('never says ready when the service gave no score and a word is off', () => {
    expect(evaluate(ayat, { text: 'كلمة اولى هنا كلمة هناك الان' }).readyForApproval).toBe(false);
    expect(evaluate(ayat, { text: spoken }).readyForApproval).toBe(true); // default confidence 0.8
  });

  it('handles an empty expected range', () => {
    expect(evaluate([], { text: spoken }).status).toBe('unclear');
  });
});

describe('DemoAsrProvider', () => {
  it('skips one word and swaps another so the screens have something to show', async () => {
    const t = await new DemoAsrProvider().transcribe({ expectedText: 'ا ب ج د ه و ز', audio: Buffer.alloc(0), contentType: '', filename: '' });
    expect(t.text.split(' ')).toEqual(['ا', 'ب', 'د', 'كلمة', 'و', 'ز']);
  });
});

describe('OpenAICompatibleProvider', () => {
  let server: Server;
  let baseUrl: string;
  let seen: { url?: string; auth?: string; body: string }[] = [];
  let reply: { status: number; body: unknown } = { status: 200, body: { text: 'نص مسموع' } };

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        seen.push({ url: req.url, auth: req.headers.authorization, body: Buffer.concat(chunks).toString('latin1') });
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/`;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  const input = { audio: Buffer.from('AUDIOBYTES'), contentType: 'audio/webm', filename: 'r.webm', expectedText: 'نص متوقع سري' };

  it('posts the audio to /audio/transcriptions with the key and returns the text', async () => {
    seen = [];
    const t = await new OpenAICompatibleProvider(baseUrl, 'sekret', 'whisper-x').transcribe(input);
    expect(t.text).toBe('نص مسموع');
    expect(seen[0].url).toBe('/v1/audio/transcriptions');
    expect(seen[0].auth).toBe('Bearer sekret');
    expect(seen[0].body).toContain('AUDIOBYTES');
    expect(seen[0].body).toContain('whisper-x');
  });

  it('never sends the expected text to the service', async () => {
    seen = [];
    await new OpenAICompatibleProvider(baseUrl, undefined, 'm').transcribe(input);
    expect(seen[0].body).not.toContain('سري');
    expect(seen[0].auth).toBeUndefined();
  });

  it('reports upstream failures and malformed answers as upstream errors', async () => {
    const p = new OpenAICompatibleProvider(baseUrl, undefined, 'm');
    reply = { status: 500, body: { error: 'boom' } };
    await expect(p.transcribe(input)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
    reply = { status: 200, body: { nope: 1 } };
    await expect(p.transcribe(input)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
    reply = { status: 200, body: 'not json' };
    await expect(p.transcribe(input)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
    await expect(new OpenAICompatibleProvider('http://127.0.0.1:1/v1', undefined, 'm', 2000).transcribe(input))
      .rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });
});

describe('parseTranscript', () => {
  it('derives a 0–1 confidence from the segments\' log-probabilities', () => {
    const t = parseTranscript({ text: 'نص', segments: [{ avg_logprob: -0.1 }, { avg_logprob: -0.3 }] });
    expect(t.confidence).toBeCloseTo(Math.exp(-0.2), 5);
    expect(parseTranscript({ text: 'نص', segments: [{ avg_logprob: 0.5 }] }).confidence).toBe(1);
  });

  it('gives no confidence when the service sends no segments', () => {
    expect(parseTranscript({ text: 'نص' })).toEqual({ text: 'نص' });
    expect(parseTranscript({ text: 'نص', segments: [{}] })).toEqual({ text: 'نص' });
  });

  it('rejects an answer without text', () => {
    expect(() => parseTranscript({})).toThrow();
    expect(() => parseTranscript(null)).toThrow();
  });
});

describe('OpenAICompatibleProvider formats', () => {
  let server: Server;
  let url: string;
  const formats: string[] = [];
  let rejectVerbose = false;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('latin1');
        const verbose = body.includes('verbose_json');
        formats.push(verbose ? 'verbose_json' : 'json');
        if (verbose && rejectVerbose) { res.writeHead(400); return res.end('{}'); }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(verbose ? { text: 'نص', segments: [{ avg_logprob: -0.2 }] } : { text: 'نص' }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  const input = { audio: Buffer.from('A'), contentType: 'audio/webm', filename: 'r.webm', expectedText: '' };

  it('asks for segment detail and returns the confidence', async () => {
    formats.length = 0;
    const t = await new OpenAICompatibleProvider(url, undefined, 'm').transcribe(input);
    expect(formats).toEqual(['verbose_json']);
    expect(t.confidence).toBeCloseTo(Math.exp(-0.2), 5);
  });

  it('falls back to plain json once when the server does not know verbose_json', async () => {
    formats.length = 0;
    rejectVerbose = true;
    const t = await new OpenAICompatibleProvider(url, undefined, 'm').transcribe(input);
    rejectVerbose = false;
    expect(formats).toEqual(['verbose_json', 'json']);
    expect(t).toEqual({ text: 'نص' });
  });
});

describe('summarizeBench', () => {
  const row = (file: string, accuracy: number, status: 'done' | 'unclear', flags: number, heard = 10): BenchRow => ({
    file, expectedWords: 10, heardWords: heard, seconds: 1,
    evaluation: { status, accuracy, confidence: 0.8, readyForApproval: false, flags: Array.from({ length: flags }, (_, i) => ({ id: `f${i}`, ayahRef: '1:1', position: i, type: 'missing' as const })) },
  });

  it('summarizes accuracy, unclear files and the heard/expected ratio', () => {
    const s = summarizeBench([row('a', 100, 'done', 0), row('b', 80, 'done', 2, 8), row('c', 0, 'unclear', 0, 1)]);
    expect(s).toMatchObject({ files: 3, judged: 2, unclear: 1, meanAccuracy: 90, minAccuracy: 80, clean: 1, meanConfidence: 0.8 });
    expect(s.wordRatio).toBeCloseTo(19 / 30, 3);
  });

  it('copes with no files', () => {
    expect(summarizeBench([])).toMatchObject({ files: 0, meanAccuracy: null, minAccuracy: null, wordRatio: null });
  });
});
