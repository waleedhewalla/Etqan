/**
 * Sends the pieces of a lesson recording one after another, in order. A piece that cannot be sent is tried again
 * for as long as the outage lasts (a wifi drop, a phone changing network), while later pieces wait their turn in
 * memory; the recording only gives up when the network has been gone for `maxOutageMs`, when too many pieces are
 * waiting, or when the server refuses a piece for good.
 */

export interface PieceSender {
  /** Adds the next piece to the queue. */
  enqueue(piece: Blob): void;
  /** Resolves when everything queued has been sent, or the recording gave up. */
  flush(): Promise<void>;
  /** How many pieces the server has accepted. */
  sent(): number;
  failed(): boolean;
}

export interface PieceSenderOptions {
  /** Sends piece number `seq`; rejects when it could not be sent (an axios-style error with `response.status` is understood). */
  send: (seq: number, piece: Blob) => Promise<unknown>;
  /** The recording gave up: the network stayed down, too many pieces piled up, or the server refused a piece. */
  onFailure: () => void;
  /** Gives up after this long without a single piece getting through. */
  maxOutageMs?: number;
  /** Gives up when this many pieces are waiting (each is about ten seconds of the lesson). */
  maxPending?: number;
  /** For tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Refused for good (too large, no longer recording): trying again cannot help. */
export const isPermanent = (err: unknown) => {
  const status = (err as { response?: { status?: number } })?.response?.status;
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;
};

export const backoffMs = (attempt: number) => Math.min(1500 * (attempt + 1), 15_000);

export function createPieceSender(options: PieceSenderOptions): PieceSender {
  const maxOutageMs = options.maxOutageMs ?? 5 * 60_000;
  const maxPending = options.maxPending ?? 60;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;

  let seq = 0;
  let pending = 0;
  let failed = false;
  let lastSuccess = now();
  let queue: Promise<void> = Promise.resolve();

  const giveUp = () => {
    if (failed) return;
    failed = true;
    options.onFailure();
  };

  return {
    enqueue(piece) {
      if (failed) return;
      pending += 1;
      if (pending > maxPending) { giveUp(); return; }
      queue = queue.then(async () => {
        try {
          if (failed) return;
          const n = seq;
          for (let attempt = 0; !failed; attempt++) {
            try {
              await options.send(n, piece);
              seq = n + 1;
              lastSuccess = now();
              return;
            } catch (err) {
              if (isPermanent(err) || now() - lastSuccess > maxOutageMs) { giveUp(); return; }
              await sleep(backoffMs(attempt));
            }
          }
        } finally {
          pending -= 1;
        }
      });
    },
    flush: () => queue,
    sent: () => seq,
    failed: () => failed,
  };
}
