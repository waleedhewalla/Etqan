import { createReadStream } from 'node:fs';
import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Readable as NodeReadable } from 'node:stream';
import {
  CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3';
import { config } from '../config';

/**
 * Private storage for student recordings. The API is the only reader: it checks
 * who may listen and streams the bytes itself, so the bucket is never exposed.
 */
export interface StoredObject {
  body: Readable;
  contentType: string;
  /** Bytes in `body` (the requested part when `contentRange` is set). */
  contentLength: number;
  /** e.g. "bytes 0-99/1234", present for partial responses. */
  contentRange?: string;
}

export class RangeNotSatisfiableError extends Error {
  constructor() {
    super('Range not satisfiable');
  }
}

export interface AudioStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** `range` is an HTTP Range header value such as "bytes=0-99". Returns null if the object does not exist. */
  get(key: string, range?: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

/** Resolves a single-range header against a size. null = no/ignored range, throws when it cannot be satisfied. */
export function resolveByteRange(header: string | undefined, size: number): { start: number; end: number } | null {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (m[1] === '' && m[2] === '')) return null;

  let start: number;
  let end: number;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix === 0) throw new RangeNotSatisfiableError();
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) throw new RangeNotSatisfiableError();
  return { start, end };
}

export class MemoryStorage implements AudioStorage {
  private objects = new Map<string, { data: Buffer; contentType: string }>();

  async put(key: string, body: Buffer, contentType: string) {
    this.objects.set(key, { data: Buffer.from(body), contentType });
  }

  async get(key: string, range?: string): Promise<StoredObject | null> {
    const obj = this.objects.get(key);
    if (!obj) return null;
    const r = resolveByteRange(range, obj.data.length);
    const part = r ? obj.data.subarray(r.start, r.end + 1) : obj.data;
    return {
      body: NodeReadable.from([part]),
      contentType: obj.contentType,
      contentLength: part.length,
      contentRange: r ? `bytes ${r.start}-${r.end}/${obj.data.length}` : undefined,
    };
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  has(key: string) {
    return this.objects.has(key);
  }

  get size() {
    return this.objects.size;
  }
}

const TYPE_BY_EXTENSION: Record<string, string> = {
  '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
};

/**
 * Recordings as plain files in one directory (a Docker volume in the compose stack). Needs no extra service,
 * which suits a single server; use S3 when the API must run on more than one machine.
 */
export class FileStorage implements AudioStorage {
  private readonly root: string;

  constructor(dir: string) {
    this.root = resolve(dir);
  }

  /** The file for a key. A key that would leave the directory is refused. */
  private path(key: string) {
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error('Invalid storage key');
    return full;
  }

  async put(key: string, body: Buffer, _contentType: string) {
    const file = this.path(key);
    await mkdir(dirname(file), { recursive: true });
    // Written beside the target and renamed into place, so a reader never sees half a recording.
    const temp = `${file}.${randomUUID()}.tmp`;
    await writeFile(temp, body, { mode: 0o600 });
    await rename(temp, file);
  }

  async get(key: string, range?: string): Promise<StoredObject | null> {
    const file = this.path(key);
    let size: number;
    try {
      size = (await stat(file)).size;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
    const r = resolveByteRange(range, size);
    return {
      body: createReadStream(file, r ? { start: r.start, end: r.end } : undefined),
      contentType: TYPE_BY_EXTENSION[extname(file).toLowerCase()] ?? 'application/octet-stream',
      contentLength: r ? r.end - r.start + 1 : size,
      contentRange: r ? `bytes ${r.start}-${r.end}/${size}` : undefined,
    };
  }

  async delete(key: string) {
    try {
      await unlink(this.path(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}

const httpStatus = (err: unknown) => (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;

export class S3Storage implements AudioStorage {
  private ready: Promise<void> | null = null;

  constructor(private client: S3Client, private bucket: string) {}

  /** Creates the bucket on first use if it is missing. */
  private ensureBucket() {
    this.ready ??= (async () => {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      } catch (err) {
        if (httpStatus(err) !== 404 && (err as Error).name !== 'NotFound' && (err as Error).name !== 'NoSuchBucket') throw err;
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      }
    })().catch((err) => {
      this.ready = null; // try again next time
      throw err;
    });
    return this.ready;
  }

  async put(key: string, body: Buffer, contentType: string) {
    await this.ensureBucket();
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async get(key: string, range?: string): Promise<StoredObject | null> {
    await this.ensureBucket();
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: range }));
      return {
        body: res.Body as Readable,
        contentType: res.ContentType ?? 'application/octet-stream',
        contentLength: res.ContentLength ?? 0,
        contentRange: res.ContentRange,
      };
    } catch (err) {
      if (httpStatus(err) === 404 || (err as Error).name === 'NoSuchKey') return null;
      if (httpStatus(err) === 416) throw new RangeNotSatisfiableError();
      throw err;
    }
  }

  async delete(key: string) {
    await this.ensureBucket();
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export function createS3Storage(options: {
  endpoint: string; accessKeyId: string; secretAccessKey: string; bucket: string; region?: string;
}) {
  return new S3Storage(new S3Client({
    endpoint: options.endpoint,
    region: options.region ?? 'us-east-1',
    credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    forcePathStyle: true, // MinIO addresses buckets by path, not subdomain
  }), options.bucket);
}

let storage: AudioStorage | null = null;

export function getStorage(): AudioStorage {
  storage ??= config.STORAGE_DRIVER === 'memory'
    ? new MemoryStorage()
    : config.STORAGE_DRIVER === 'file'
      ? new FileStorage(config.AUDIO_DIR)
      : createS3Storage({
        endpoint: `${config.MINIO_USE_SSL ? 'https' : 'http'}://${config.MINIO_ENDPOINT}`,
        accessKeyId: config.MINIO_ACCESS_KEY,
        secretAccessKey: config.MINIO_SECRET_KEY,
        bucket: config.MINIO_BUCKET,
        region: config.MINIO_REGION,
      });
  return storage;
}

/** Replaces the storage (tests use this). */
export function setStorage(next: AudioStorage | null) {
  storage = next;
}
