import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import S3rver from 's3rver';
import { sniffAudio } from '../lib/audio';
import {
  FileStorage, MemoryStorage, RangeNotSatisfiableError, createS3Storage, resolveByteRange, type AudioStorage,
} from '../lib/storage';

const pad = (head: Buffer) => Buffer.concat([head, Buffer.alloc(16)]);

describe('sniffAudio', () => {
  it('recognises the formats browsers record in', () => {
    expect(sniffAudio(pad(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])))?.ext).toBe('webm');
    expect(sniffAudio(pad(Buffer.from('OggS')))?.ext).toBe('ogg');
    expect(sniffAudio(pad(Buffer.from('\0\0\0\x20ftypM4A ', 'latin1')))?.mime).toBe('audio/mp4');
    expect(sniffAudio(pad(Buffer.from('RIFF\0\0\0\0WAVE', 'latin1')))?.ext).toBe('wav');
    expect(sniffAudio(pad(Buffer.from('ID3')))?.ext).toBe('mp3');
    expect(sniffAudio(pad(Buffer.from([0xff, 0xfb, 0x90])))?.ext).toBe('mp3');
  });

  it('rejects everything else, whatever the filename says', () => {
    expect(sniffAudio(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(sniffAudio(Buffer.from('%PDF-1.7 not audio at all'))).toBeNull();
    expect(sniffAudio(Buffer.alloc(4))).toBeNull(); // too short
  });
});

describe('resolveByteRange', () => {
  it('handles open, closed and suffix ranges', () => {
    expect(resolveByteRange(undefined, 100)).toBeNull();
    expect(resolveByteRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(resolveByteRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(resolveByteRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(resolveByteRange('bytes=50-500', 100)).toEqual({ start: 50, end: 99 });
    expect(resolveByteRange('garbage', 100)).toBeNull();
  });

  it('refuses ranges outside the object', () => {
    expect(() => resolveByteRange('bytes=100-', 100)).toThrow(RangeNotSatisfiableError);
    expect(() => resolveByteRange('bytes=9-2', 100)).toThrow(RangeNotSatisfiableError);
    expect(() => resolveByteRange('bytes=-0', 100)).toThrow(RangeNotSatisfiableError);
  });
});

async function read(stream: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
  return Buffer.concat(chunks);
}

/** The behaviour every storage driver must have. */
function contract(make: () => AudioStorage) {
  const data = Buffer.from('0123456789abcdefghij');

  it('stores, reads back, and deletes', async () => {
    const s = make();
    expect(await s.get('a/none.webm')).toBeNull();
    await s.put('a/one.webm', data, 'audio/webm');

    const whole = await s.get('a/one.webm');
    expect(whole?.contentType).toBe('audio/webm');
    expect(whole?.contentLength).toBe(20);
    expect(whole?.contentRange).toBeUndefined();
    expect((await read(whole!.body)).toString()).toBe(data.toString());

    await s.delete('a/one.webm');
    expect(await s.get('a/one.webm')).toBeNull();
    await s.delete('a/one.webm'); // deleting twice is fine
  });

  it('serves byte ranges', async () => {
    const s = make();
    await s.put('a/range.webm', data, 'audio/webm');

    const part = await s.get('a/range.webm', 'bytes=5-9');
    expect(part?.contentRange).toBe('bytes 5-9/20');
    expect(part?.contentLength).toBe(5);
    expect((await read(part!.body)).toString()).toBe('56789');

    const open = await s.get('a/range.webm', 'bytes=16-');
    expect((await read(open!.body)).toString()).toBe('ghij');

    await expect(s.get('a/range.webm', 'bytes=50-')).rejects.toBeInstanceOf(RangeNotSatisfiableError);
  });
}

describe('MemoryStorage', () => {
  contract(() => new MemoryStorage());

  // The local S3 server used below mishandles suffix ranges, so this is checked here only.
  it('serves suffix ranges', async () => {
    const s = new MemoryStorage();
    await s.put('k', Buffer.from('0123456789abcdefghij'), 'audio/webm');
    expect((await read((await s.get('k', 'bytes=-4'))!.body)).toString()).toBe('ghij');
  });
});

describe('S3Storage (against a local S3 server)', () => {
  let server: S3rver;
  let dir: string;
  let storage: AudioStorage;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 's3rver-'));
    server = new S3rver({ port: 0, address: '127.0.0.1', silent: true, directory: dir, configureBuckets: [] });
    const { port } = await server.run() as unknown as { port: number };
    storage = createS3Storage({
      endpoint: `http://127.0.0.1:${port}`, accessKeyId: 'S3RVER', secretAccessKey: 'S3RVER', bucket: 'itqan-audio-test',
    });
  });

  afterAll(async () => {
    await server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  contract(() => storage);
});

describe('FileStorage', () => {
  let dir: string;
  let storage: FileStorage;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'itqan-audio-'));
    storage = new FileStorage(dir);
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  contract(() => storage);

  it('serves suffix ranges, like memory (the S3 emulator cannot)', async () => {
    await storage.put('r/suffix.webm', Buffer.from('0123456789abcdefghij'), 'audio/webm');
    expect((await read((await storage.get('r/suffix.webm', 'bytes=-4'))!.body)).toString()).toBe('ghij');
  });

  it('reports the content type from the file extension', async () => {
    await storage.put('t/a.m4a', Buffer.from('x'), 'audio/mp4');
    await storage.put('t/b.ogg', Buffer.from('x'), 'audio/ogg');
    expect((await storage.get('t/a.m4a'))!.contentType).toBe('audio/mp4');
    expect((await storage.get('t/b.ogg'))!.contentType).toBe('audio/ogg');
  });

  it('keeps recordings across a restart (a new instance on the same directory)', async () => {
    await storage.put('keep/me.webm', Buffer.from('still here'), 'audio/webm');
    const after = new FileStorage(dir);
    expect((await read((await after.get('keep/me.webm'))!.body)).toString()).toBe('still here');
  });

  it('writes private files and leaves no half-written ones behind', async () => {
    await storage.put('mode/x.webm', Buffer.from('private'), 'audio/webm');
    expect((await stat(join(dir, 'mode/x.webm'))).mode & 0o077).toBe(0); // no group or world access
    expect((await readdir(join(dir, 'mode'))).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    await storage.put('mode/x.webm', Buffer.from('replaced'), 'audio/webm');
    expect((await readFile(join(dir, 'mode/x.webm'))).toString()).toBe('replaced');
  });

  it('refuses a key that would leave its directory, for every operation', async () => {
    for (const key of ['../escape.webm', 'a/../../escape.webm', '/etc/passwd', '..']) {
      await expect(storage.put(key, Buffer.from('x'), 'audio/webm'), key).rejects.toThrow(/Invalid storage key/);
      await expect(storage.get(key), key).rejects.toThrow(/Invalid storage key/);
      await expect(storage.delete(key), key).rejects.toThrow(/Invalid storage key/);
    }
    await expect(stat(join(dir, '..', 'escape.webm'))).rejects.toThrow();
  });
});
