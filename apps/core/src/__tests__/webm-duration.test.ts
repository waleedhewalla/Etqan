/** Writing a recording's length into the header a browser leaves without one. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withDuration, writeWebmDuration } from '../lib/webm-duration';

/** The first bytes of a recording made by Chrome: EBML header, a segment of unknown size, Info, then the tracks. */
const HEAD = Buffer.from(
  '1a45dfa39f4286810142f7810142f2810442f381084282847765626d42878104428581021853806701ffffffffffffff'
  + '1549a966992ad7b1830f42404d808643' + '68726f6d6557418643' + '68726f6d65' + '1654ae6b83010203', 'hex',
);

describe('the length of a recorded lesson', () => {
  it('is written into the Info block, which grows by exactly that', () => {
    const out = withDuration(HEAD, 90_500)!;
    expect(out.replaces).toBe(48 + 5 + 25); // up to the end of Info
    const whole = Buffer.concat([out.head, HEAD.subarray(out.replaces)]);
    expect(whole.length).toBe(HEAD.length + 11);
    expect(whole[52]).toBe(0x80 | 36); // Info is 25 + 11 bytes now
    const at = whole.indexOf(Buffer.from('448988', 'hex'));
    expect(whole.readDoubleBE(at + 3)).toBe(90_500); // milliseconds, at the file's scale of 1 ms per tick
    expect(whole.subarray(at + 11).equals(Buffer.from('1654ae6b83010203', 'hex'))).toBe(true); // the tracks follow untouched
    expect(whole.subarray(0, 52).equals(HEAD.subarray(0, 52))).toBe(true);
  });

  it('leaves alone a file that already has one, or that is not laid out this way', () => {
    const out = withDuration(HEAD, 1000)!;
    expect(withDuration(Buffer.concat([out.head, HEAD.subarray(out.replaces)]), 1000)).toBeNull();
    expect(withDuration(Buffer.from('<html>hello</html>'), 1000)).toBeNull();
    expect(withDuration(HEAD.subarray(0, 60), 1000)).toBeNull(); // cut short
    const sized = Buffer.from(HEAD); sized.writeUInt8(0x01, 47); sized.fill(0, 41, 47); // a segment that states its size
    expect(withDuration(sized, 1000)).toBeNull();
  });

  it('rewrites the file on disk and keeps everything after the header', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'itqan-webm-'));
    try {
      const path = join(dir, 'lesson.webm');
      const body = Buffer.alloc(20_000, 7);
      await writeFile(path, Buffer.concat([HEAD, body]));
      expect(await writeWebmDuration(path, 60_000)).toBe(true);
      const after = await readFile(path);
      expect(after.length).toBe(HEAD.length + body.length + 11);
      expect(after.subarray(after.length - body.length).equals(body)).toBe(true);
      expect(await writeWebmDuration(path, 60_000)).toBe(false); // already written
      expect(await writeWebmDuration(path, 0)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
