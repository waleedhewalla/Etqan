import { createServer, type IncomingMessage, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evaluate } from '../lib/asr/evaluate';
import { DemoAsrProvider } from '../lib/asr/demo';
import { OpenAICompatibleProvider } from '../lib/asr/openai';

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
