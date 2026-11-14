/**
 * A WebM file recorded in a browser does not say how long it is, so a player shows no timeline for
 * it. This writes the length into the file's header. It only handles the layout browsers produce
 * (a segment of unknown size whose first part is the Info block); anything else is left untouched.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

const EBML = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const VOID = 0xec;
const TIMECODE_SCALE = 0x2ad7b1;
const DURATION = 0x4489;
/** Enough to hold everything before the first cluster. */
const HEAD_BYTES = 4096;

type Element = { id: number; size: number | null; sizeAt: number; sizeLength: number; dataAt: number };

/** Reads an element's id and size at `at`, or null when the buffer ends first. `size` is null when unknown. */
function readElement(buf: Buffer, at: number): Element | null {
  if (at >= buf.length) return null;
  const idLength = Math.clz32(buf[at]) - 23;
  if (idLength < 1 || idLength > 4 || at + idLength >= buf.length) return null;
  const id = buf.readUIntBE(at, idLength);
  const sizeAt = at + idLength;
  const sizeLength = Math.clz32(buf[sizeAt]) - 23;
  if (sizeLength < 1 || sizeLength > 8 || sizeAt + sizeLength > buf.length) return null;
  let size = buf[sizeAt] & (0xff >> sizeLength);
  let unknown = size === (0xff >> sizeLength);
  for (let i = 1; i < sizeLength; i++) {
    unknown &&= buf[sizeAt + i] === 0xff;
    size = size * 256 + buf[sizeAt + i];
  }
  return { id, size: unknown ? null : size, sizeAt, sizeLength, dataAt: sizeAt + sizeLength };
}

/**
 * The start of the file with the length written in, and how many of the original bytes it replaces;
 * or null when the header is not one this can safely change.
 */
export function withDuration(head: Buffer, durationMs: number): { head: Buffer; replaces: number } | null {
  const ebml = readElement(head, 0);
  if (!ebml || ebml.id !== EBML || ebml.size === null) return null;
  const segment = readElement(head, ebml.dataAt + ebml.size);
  // A segment of known size would need its own size changed too; browsers do not write one.
  if (!segment || segment.id !== SEGMENT || segment.size !== null) return null;

  let at = segment.dataAt;
  let info = readElement(head, at);
  while (info && info.id === VOID && info.size !== null) {
    at = info.dataAt + info.size;
    info = readElement(head, at);
  }
  // Anything else before Info (an index of positions, say) would point at the wrong places afterwards.
  if (!info || info.id !== INFO || info.size === null || info.dataAt + info.size > head.length) return null;

  let scale = 1_000_000; // nanoseconds per tick, unless the file says otherwise
  for (let child = readElement(head, info.dataAt); child && child.dataAt <= info.dataAt + info.size;) {
    if (child.size === null) return null;
    if (child.id === DURATION) return null; // already has one
    if (child.id === TIMECODE_SCALE && child.size >= 1 && child.size <= 6) scale = head.readUIntBE(child.dataAt, child.size);
    const next = child.dataAt + child.size;
    if (next >= info.dataAt + info.size) break;
    child = readElement(head, next);
  }
  if (scale <= 0) return null;

  const duration = Buffer.alloc(11);
  duration.writeUInt16BE(DURATION, 0);
  duration[2] = 0x88; // eight bytes follow
  duration.writeDoubleBE((durationMs * 1_000_000) / scale, 3);

  // The Info block grows by the new element; its size must still fit in the bytes it was written in.
  const newSize = info.size + duration.length;
  if (newSize >= 2 ** (7 * info.sizeLength) - 1) return null;
  const size = Buffer.alloc(info.sizeLength);
  size.writeUIntBE(newSize, 0, info.sizeLength);
  size[0] |= 0x80 >> (info.sizeLength - 1);

  const infoEnd = info.dataAt + info.size;
  return {
    head: Buffer.concat([head.subarray(0, info.sizeAt), size, head.subarray(info.dataAt, infoEnd), duration]),
    replaces: infoEnd,
  };
}

/** Writes the length into the WebM file at `path`. Returns false, changing nothing, when it cannot. */
export async function writeWebmDuration(path: string, durationMs: number): Promise<boolean> {
  if (!(durationMs > 0)) return false;
  const file = await open(path, 'r');
  let patched;
  try {
    const head = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await file.read(head, 0, HEAD_BYTES, 0);
    patched = withDuration(head.subarray(0, bytesRead), durationMs);
  } finally {
    await file.close();
  }
  if (!patched) return false;

  const temp = `${path}.dur`;
  try {
    const out = createWriteStream(temp, { mode: 0o600 });
    out.write(patched.head);
    await pipeline(createReadStream(path, { start: patched.replaces }), out);
    await rename(temp, path);
    return true;
  } catch (err) {
    await unlink(temp).catch(() => undefined);
    console.error('[LIVE] could not write the length into a recording', err instanceof Error ? err.message : err);
    return false;
  }
}
