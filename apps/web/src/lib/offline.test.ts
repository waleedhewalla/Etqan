import { beforeEach, describe, expect, it } from 'vitest';
import { BATCH_SIZE, isNetworkError, MemoryBackend, OfflineStore } from './offline';
import type { QueueResponse } from './api';

const queue = { date: '2026-10-30', totalItems: 1 } as unknown as QueueResponse;
const review = (userId = 'u1', cardId = 'card-1', reviewedAt?: string) =>
  ({ userId, cardId, rating: 'good' as const, timeTakenMs: 900, reviewedAt });

describe('OfflineStore', () => {
  let store: OfflineStore;
  beforeEach(() => { store = new OfflineStore(new MemoryBackend()); });

  it('keeps today\'s queue per user', async () => {
    await store.saveSnapshot('u1', queue);
    expect((await store.loadSnapshot('u1'))?.queue).toEqual(queue);
    expect(await store.loadSnapshot('u2')).toBeUndefined();
  });

  it('returns cached verses only when every one is there', async () => {
    const a = (ref: string) => ({ ref, sura: 1, ayah: 1, suraNameAr: 's', textUthmani: 't', wordCount: 1 });
    await store.saveAyat([a('1:1'), a('1:2')]);
    expect((await store.loadAyat(['1:1', '1:2']))?.map((x) => x.ref)).toEqual(['1:1', '1:2']);
    expect(await store.loadAyat(['1:1', '1:3'])).toBeNull();
  });

  it('lists a user\'s waiting reviews oldest first', async () => {
    await store.addPending(review('u1', 'b', '2026-10-30T10:00:00Z'));
    await store.addPending(review('u1', 'a', '2026-10-30T08:00:00Z'));
    await store.addPending(review('u2', 'x'));
    expect((await store.listPending('u1')).map((p) => p.cardId)).toEqual(['a', 'b']);
    expect(await store.pendingCount('u2')).toBe(1);
  });

  it('gives every waiting review its own id', async () => {
    const a = await store.addPending(review());
    const b = await store.addPending(review());
    expect(a.clientId).not.toBe(b.clientId);
  });

  it('sends waiting reviews and forgets those the server answered', async () => {
    await store.addPending(review('u1', 'a'));
    await store.addPending(review('u1', 'b'));
    const sent: string[][] = [];
    const out = await store.flush('u1', async (rs) => {
      sent.push(rs.map((r) => r.cardId));
      return { results: rs.map((r) => ({ clientId: r.clientId, status: r.cardId === 'a' ? 'applied' : 'stale' })), applied: 1 };
    });
    expect(out).toEqual({ applied: 1, dropped: 2, remaining: 0, offline: false });
    expect(sent).toEqual([['a', 'b']]);
    expect(await store.pendingCount('u1')).toBe(0);
  });

  it('keeps reviews when the connection fails, and sends them next time', async () => {
    await store.addPending(review('u1', 'a'));
    const down = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK', request: {} });
    const out = await store.flush('u1', async () => { throw down; });
    expect(out).toMatchObject({ offline: true, remaining: 1, applied: 0 });
    expect(await store.pendingCount('u1')).toBe(1);

    await store.flush('u1', async (rs) => ({ results: rs.map((r) => ({ clientId: r.clientId, status: 'applied' })), applied: rs.length }));
    expect(await store.pendingCount('u1')).toBe(0);
  });

  it('does not swallow a real server error, and keeps the reviews', async () => {
    await store.addPending(review('u1', 'a'));
    const boom = Object.assign(new Error('500'), { response: { status: 500 } });
    await expect(store.flush('u1', async () => { throw boom; })).rejects.toBe(boom);
    expect(await store.pendingCount('u1')).toBe(1);
  });

  it('sends in batches the server accepts, and stops at the first connection failure', async () => {
    for (let i = 0; i < BATCH_SIZE + 5; i++) await store.addPending(review('u1', `c${i}`, new Date(2026, 9, 30, 8, 0, i).toISOString()));
    const sizes: number[] = [];
    let calls = 0;
    const out = await store.flush('u1', async (rs) => {
      sizes.push(rs.length);
      if (++calls === 2) throw Object.assign(new Error('x'), { code: 'ERR_NETWORK', request: {} });
      return { results: rs.map((r) => ({ clientId: r.clientId, status: 'applied' })), applied: rs.length };
    });
    expect(sizes).toEqual([BATCH_SIZE, 5]);
    expect(out).toMatchObject({ offline: true, applied: BATCH_SIZE, remaining: 5 });
    expect(await store.pendingCount('u1')).toBe(5);
  });

  it('takes a reviewed card out of the saved queue', async () => {
    const item = (id: string) => ({ card: { id }, ayahRef: '1:1' });
    const full = { date: 'd', totalItems: 3, queue: { manzil: { count: 2, items: [item('a'), item('b')] }, sabqi: { count: 0, items: [] }, sabaq: { count: 1, items: [item('c')], locked: false } } } as unknown as QueueResponse;
    await store.saveSnapshot('u1', full);
    await store.markDone('u1', 'b');
    const q = (await store.loadSnapshot('u1'))!.queue;
    expect(q.queue.manzil.items.map((i) => i.card.id)).toEqual(['a']);
    expect(q.queue.manzil.count).toBe(1);
    expect(q.totalItems).toBe(2);
    await store.markDone('u1', 'nope');
    expect((await store.loadSnapshot('u1'))!.queue.totalItems).toBe(2);
    await store.markDone('nobody', 'a'); // no snapshot: nothing to do
  });

  it('forgets the saved queue on sign-out but keeps reviews still waiting', async () => {
    await store.saveSnapshot('u1', queue);
    await store.addPending(review());
    await store.forgetUser('u1');
    expect(await store.loadSnapshot('u1')).toBeUndefined();
    expect(await store.pendingCount('u1')).toBe(1);
  });
});

describe('isNetworkError', () => {
  it('tells a missing connection from a server answer', () => {
    expect(isNetworkError({ request: {}, code: 'ERR_NETWORK' })).toBe(true);
    expect(isNetworkError({ code: 'ECONNABORTED' })).toBe(true);
    expect(isNetworkError({ response: { status: 500 }, request: {} })).toBe(false);
    expect(isNetworkError(new Error('x'))).toBe(false);
    expect(isNetworkError(null)).toBe(false);
  });
});
