/**
 * Recognises the audio formats browsers record in by looking at the file's first
 * bytes, so the declared content type is never trusted. Returns null for anything else.
 */
export interface AudioKind {
  mime: string;
  ext: string;
}

export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export function sniffAudio(buf: Buffer): AudioKind | null {
  if (buf.length < 12) return null;
  const ascii = (from: number, to: number) => buf.toString('latin1', from, to);

  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { mime: 'audio/webm', ext: 'webm' };
  if (ascii(0, 4) === 'OggS') return { mime: 'audio/ogg', ext: 'ogg' };
  if (ascii(4, 8) === 'ftyp') return { mime: 'audio/mp4', ext: 'm4a' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return { mime: 'audio/wav', ext: 'wav' };
  if (ascii(0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return { mime: 'audio/mpeg', ext: 'mp3' };
  return null;
}
