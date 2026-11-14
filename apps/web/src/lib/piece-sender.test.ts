import { describe, expect, it, vi } from 'vitest';
import { backoffMs, createPieceSender, isPermanent } from './piece-sender';

const piece = () => new Blob(['x']);
const status = (code: number) => Object.assign(new Error('http'), { response: { status: code } });
/** A clock the test moves by hand, and a sleep that moves it. */
const clock = () => {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => { t += ms; }, tick: (ms: number) => { t += ms; } };
};

describe('piece sender', () => {
  it('sends pieces in order, numbered from zero', async () => {
    const c = clock();
    const seen: number[] = [];
    const s = createPieceSender({ send: async (n) => { seen.push(n); }, onFailure: vi.fn(), ...c });
    s.enqueue(piece()); s.enqueue(piece()); s.enqueue(piece());
    await s.flush();
    expect(seen).toEqual([0, 1, 2]);
    expect(s.sent()).toBe(3);
  });

  it('keeps trying through a network outage and sends the same piece number once it is back', async () => {
    const c = clock();
    let up = false;
    const seen: number[] = [];
    const onFailure = vi.fn();
    const s = createPieceSender({
      send: async (n) => { if (!up) { c.tick(0); throw new Error('network'); } seen.push(n); },
      onFailure,
      sleep: async (ms) => { await c.sleep(ms); if (c.now() > 60_000) up = true; }, // the network comes back after a minute
      now: c.now,
    });
    s.enqueue(piece()); s.enqueue(piece());
    await s.flush();
    expect(seen).toEqual([0, 1]); // nothing skipped, nothing out of order
    expect(onFailure).not.toHaveBeenCalled();
    expect(c.now()).toBeGreaterThanOrEqual(60_000);
  });

  it('gives up when the network stays down for longer than the limit, and stops sending', async () => {
    const c = clock();
    const send = vi.fn(async () => { throw new Error('network'); });
    const onFailure = vi.fn();
    const s = createPieceSender({ send, onFailure, maxOutageMs: 5 * 60_000, sleep: c.sleep, now: c.now });
    s.enqueue(piece()); s.enqueue(piece());
    await s.flush();
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(s.failed()).toBe(true);
    const calls = send.mock.calls.length;
    s.enqueue(piece());
    await s.flush();
    expect(send.mock.calls.length).toBe(calls); // a failed recording sends nothing more
    expect(c.now()).toBeGreaterThan(5 * 60_000);
  });

  it('counts the outage from the last piece that got through, not from the first failure of each piece', async () => {
    const c = clock();
    let up = true;
    const onFailure = vi.fn();
    const s = createPieceSender({ send: async () => { if (!up) throw new Error('network'); }, onFailure, maxOutageMs: 60_000, sleep: c.sleep, now: c.now });
    s.enqueue(piece()); await s.flush();
    c.tick(10 * 60_000); // a long quiet time with nothing to send is not an outage
    s.enqueue(piece()); await s.flush();
    expect(onFailure).not.toHaveBeenCalled();
    expect(s.sent()).toBe(2);
    up = false;
    c.tick(1000);
    s.enqueue(piece()); await s.flush();
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('gives up at once when the server refuses a piece for good, but retries a timeout or a busy server', async () => {
    expect(isPermanent(status(413))).toBe(true);
    expect(isPermanent(status(409))).toBe(true);
    expect(isPermanent(status(408))).toBe(false);
    expect(isPermanent(status(429))).toBe(false);
    expect(isPermanent(status(503))).toBe(false);
    expect(isPermanent(new Error('network'))).toBe(false);

    const c = clock();
    const onFailure = vi.fn();
    const send = vi.fn(async () => { throw status(413); });
    const s = createPieceSender({ send, onFailure, sleep: c.sleep, now: c.now });
    s.enqueue(piece()); await s.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('gives up when too many pieces are waiting in memory', async () => {
    const c = clock();
    const onFailure = vi.fn();
    const s = createPieceSender({ send: async () => { throw new Error('network'); }, onFailure, maxPending: 3, maxOutageMs: 1e9, sleep: async () => { c.tick(1); }, now: c.now });
    for (let i = 0; i < 5; i++) s.enqueue(piece()); // none can be sent, so they pile up
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(s.failed()).toBe(true);
    await s.flush();
  });

  it('waits longer between tries, up to fifteen seconds', () => {
    expect([0, 1, 2, 9, 50].map(backoffMs)).toEqual([1500, 3000, 4500, 15_000, 15_000]);
  });
});
