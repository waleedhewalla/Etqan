import type { AyahText, QueueResponse, Rating } from './api';

/** A review done while the device had no connection, waiting to be sent. */
export interface PendingReview {
  clientId: string;
  userId: string;
  cardId: string;
  rating: Rating;
  timeTakenMs: number;
  /** ISO time the review happened. */
  reviewedAt: string;
}

export interface Snapshot {
  savedAt: string;
  queue: QueueResponse;
}

/** Where offline data lives. IndexedDB in the browser; a plain map in tests. */
export interface OfflineBackend {
  get<T>(store: 'kv' | 'pending', key: string): Promise<T | undefined>;
  put(store: 'kv' | 'pending', key: string, value: unknown): Promise<void>;
  delete(store: 'kv' | 'pending', key: string): Promise<void>;
  all<T>(store: 'kv' | 'pending'): Promise<T[]>;
}

export class MemoryBackend implements OfflineBackend {
  private data = { kv: new Map<string, unknown>(), pending: new Map<string, unknown>() };
  async get<T>(store: 'kv' | 'pending', key: string) { return this.data[store].get(key) as T | undefined; }
  async put(store: 'kv' | 'pending', key: string, value: unknown) { this.data[store].set(key, value); }
  async delete(store: 'kv' | 'pending', key: string) { this.data[store].delete(key); }
  async all<T>(store: 'kv' | 'pending') { return [...this.data[store].values()] as T[]; }
}

const DB_NAME = 'itqan-offline';

export class IndexedDbBackend implements OfflineBackend {
  private opened: Promise<IDBDatabase> | null = null;

  private db() {
    this.opened ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('kv');
        req.result.createObjectStore('pending');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { this.opened = null; reject(req.error); };
    });
    return this.opened;
  }

  private async run<T>(store: 'kv' | 'pending', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await this.db();
    return new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(store, mode).objectStore(store));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  }

  get<T>(store: 'kv' | 'pending', key: string) { return this.run<T | undefined>(store, 'readonly', (s) => s.get(key)); }
  async put(store: 'kv' | 'pending', key: string, value: unknown) { await this.run(store, 'readwrite', (s) => s.put(value, key)); }
  async delete(store: 'kv' | 'pending', key: string) { await this.run(store, 'readwrite', (s) => s.delete(key)); }
  all<T>(store: 'kv' | 'pending') { return this.run<T[]>(store, 'readonly', (s) => s.getAll()); }
}

/** True for a request that never got an answer (no connection), as opposed to the server saying no. */
export function isNetworkError(err: unknown) {
  const e = err as { response?: unknown; request?: unknown; code?: string } | null;
  return Boolean(e && !e.response && (e.request || e.code === 'ERR_NETWORK' || e.code === 'ECONNABORTED'));
}

export const REVIEW_MAX_AGE_MS = 14 * 86_400_000;
/** The server accepts this many reviews per request. */
export const BATCH_SIZE = 200;

export interface BatchResult { clientId: string; status: string }

export class OfflineStore {
  constructor(private backend: OfflineBackend) {}

  // ── Today's queue, kept so a session can start without a connection ──
  async saveSnapshot(userId: string, queue: QueueResponse) {
    await this.backend.put('kv', `queue:${userId}`, { savedAt: new Date().toISOString(), queue } satisfies Snapshot);
  }

  async loadSnapshot(userId: string) {
    return this.backend.get<Snapshot>('kv', `queue:${userId}`);
  }

  /** Takes a card out of today's saved queue once it has been reviewed, so a restart offline does not show it again. */
  async markDone(userId: string, cardId: string) {
    const snap = await this.loadSnapshot(userId);
    if (!snap) return;
    const q = snap.queue.queue;
    let removed = 0;
    for (const part of [q.manzil, q.sabqi, q.sabaq]) {
      const before = part.items.length;
      part.items = part.items.filter((i) => i.card.id !== cardId);
      part.count -= before - part.items.length;
      removed += before - part.items.length;
    }
    snap.queue.totalItems -= removed;
    await this.backend.put('kv', `queue:${userId}`, snap);
  }

  /** Drops what was saved for this user on this device (sign-out). Reviews still waiting are kept for the next sign-in. */
  async forgetUser(userId: string) {
    await this.backend.delete('kv', `queue:${userId}`);
  }

  // ── Verse text, so "show the verse" works offline ──
  async saveAyat(ayat: AyahText[]) {
    await Promise.all(ayat.map((a) => this.backend.put('kv', `ayah:${a.ref}`, a)));
  }

  /** The cached verses for these references, or null when any is missing. */
  async loadAyat(refs: string[]) {
    const found = await Promise.all(refs.map((r) => this.backend.get<AyahText>('kv', `ayah:${r}`)));
    return found.every(Boolean) ? (found as AyahText[]) : null;
  }

  // ── Reviews waiting to be sent ──
  async addPending(review: Omit<PendingReview, 'clientId' | 'reviewedAt'> & { reviewedAt?: string }) {
    const full: PendingReview = {
      ...review,
      clientId: `c-${crypto.randomUUID()}`,
      reviewedAt: review.reviewedAt ?? new Date().toISOString(),
    };
    await this.backend.put('pending', full.clientId, full);
    return full;
  }

  async listPending(userId: string) {
    const all = await this.backend.all<PendingReview>('pending');
    return all.filter((p) => p.userId === userId).sort((a, b) => Date.parse(a.reviewedAt) - Date.parse(b.reviewedAt));
  }

  async pendingCount(userId: string) {
    return (await this.listPending(userId)).length;
  }

  /**
   * Sends the waiting reviews, oldest first, in batches. Every answer the server gives is final (applied,
   * already counted, or refused), so those reviews are dropped. If the connection fails, the rest stay for next time.
   */
  async flush(
    userId: string,
    send: (reviews: Pick<PendingReview, 'clientId' | 'cardId' | 'rating' | 'timeTakenMs' | 'reviewedAt'>[]) => Promise<{ results: BatchResult[]; applied: number }>,
  ) {
    const pending = await this.listPending(userId);
    let applied = 0;
    let dropped = 0;
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      let answer;
      try {
        answer = await send(batch.map(({ clientId, cardId, rating, timeTakenMs, reviewedAt }) => ({ clientId, cardId, rating, timeTakenMs, reviewedAt })));
      } catch (err) {
        if (isNetworkError(err)) return { applied, dropped, remaining: pending.length - i, offline: true };
        throw err;
      }
      applied += answer.applied;
      for (const r of answer.results) { await this.backend.delete('pending', r.clientId); dropped++; }
    }
    return { applied, dropped, remaining: 0, offline: false };
  }
}

let store: OfflineStore | null = null;

/** The device's store (IndexedDB), or null where it is unavailable (server render, private mode). */
export function getOfflineStore(): OfflineStore | null {
  if (typeof indexedDB === 'undefined') return null;
  store ??= new OfflineStore(new IndexedDbBackend());
  return store;
}
