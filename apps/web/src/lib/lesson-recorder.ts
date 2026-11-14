/**
 * Records a live lesson in the teacher's browser: her microphone, and whatever is on the stage
 * (her shared screen or camera, or a title card when she shares nothing). Students' voices are
 * not part of it. The recording leaves the browser in pieces while the lesson runs, so a lesson
 * of any length never has to fit in memory and a crash loses seconds, not the lesson.
 */

import { createPieceSender } from './piece-sender';

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 5;
const PIECE_MS = 10_000;
const TYPES = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];

const pickType = () => (typeof MediaRecorder === 'undefined' ? undefined : TYPES.find((t) => MediaRecorder.isTypeSupported(t)));

/** True when this browser can record a lesson. */
export function canRecordLesson(): boolean {
  return typeof window !== 'undefined' && Boolean(pickType())
    && typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype
    && Boolean(window.AudioContext);
}

/**
 * Calls `fn` several times a second. A page timer slows to once a second when the teacher is looking
 * at another window (which is exactly when she shares the mushaf), so the ticks come from a worker.
 */
function ticker(fn: () => void): () => void {
  try {
    const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${1000 / FPS});`], { type: 'text/javascript' }));
    const worker = new Worker(url);
    worker.onmessage = fn;
    return () => { worker.terminate(); URL.revokeObjectURL(url); };
  } catch {
    const id = window.setInterval(fn, 1000 / FPS);
    return () => window.clearInterval(id);
  }
}

export interface LessonRecorder {
  /** Stops, waits for the last piece to be sent, and resolves with how long was recorded. */
  stop(): Promise<{ durationMs: number; sent: number }>;
}

export function startLessonRecorder(options: {
  title: string;
  /** The video on stage right now, if any. */
  stage: () => HTMLVideoElement | null;
  /** The teacher's microphone as it is right now (it can be replaced when she changes device). */
  microphone: () => MediaStreamTrack | null;
  /** Sends one piece; rejects when it could not be sent. */
  send: (seq: number, piece: Blob) => Promise<unknown>;
  /** The recording stopped by itself: pieces could not be sent, or the browser gave up. */
  onFailure: (reason: 'upload' | 'recorder') => void;
}): LessonRecorder {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const paint = canvas.getContext('2d')!;
  let dot = false;

  const draw = () => {
    paint.fillStyle = '#0b0f0e';
    paint.fillRect(0, 0, WIDTH, HEIGHT);
    const video = options.stage();
    if (video && video.videoWidth > 0 && video.srcObject) {
      const scale = Math.min(WIDTH / video.videoWidth, HEIGHT / video.videoHeight);
      const w = video.videoWidth * scale;
      const h = video.videoHeight * scale;
      paint.drawImage(video, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
    } else {
      paint.fillStyle = '#ffffff';
      paint.textAlign = 'center';
      paint.direction = 'rtl';
      paint.font = '600 48px system-ui, sans-serif';
      paint.fillText(options.title, WIDTH / 2, HEIGHT / 2, WIDTH - 160);
    }
    // One pixel that changes on every tick, so the recorder keeps receiving frames while the picture is still.
    dot = !dot;
    paint.fillStyle = dot ? '#0b0f0e' : '#0c100f';
    paint.fillRect(0, 0, 2, 2);
  };

  const audio = new AudioContext();
  void audio.resume().catch(() => undefined);
  const mix = audio.createMediaStreamDestination();
  let heard: MediaStreamTrack | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  const followMicrophone = () => {
    const track = options.microphone();
    if (track === heard) return;
    source?.disconnect();
    source = track ? audio.createMediaStreamSource(new MediaStream([track])) : null;
    source?.connect(mix);
    heard = track;
  };

  draw();
  followMicrophone();
  const stopTicking = ticker(() => { draw(); followMicrophone(); });

  const picture = canvas.captureStream(FPS);
  const stream = new MediaStream([...picture.getVideoTracks(), ...mix.stream.getAudioTracks()]);
  const recorder = new MediaRecorder(stream, { mimeType: pickType(), videoBitsPerSecond: 400_000, audioBitsPerSecond: 48_000 });

  const startedAt = Date.now();
  let failed = false;
  let stopped: Promise<void> | null = null;
  // Pieces are sent one after another; a dropped connection is waited out for a few minutes before the recording gives up.
  const sender = createPieceSender({
    send: options.send,
    onFailure: () => {
      failed = true;
      if (recorder.state !== 'inactive') recorder.stop();
      options.onFailure('upload');
    },
  });
  const enqueue = (piece: Blob) => sender.enqueue(piece);

  const release = () => {
    stopTicking();
    stream.getTracks().forEach((t) => t.stop());
    source?.disconnect();
    void audio.close().catch(() => undefined);
  };
  const ended = new Promise<void>((resolve) => { recorder.onstop = () => { release(); resolve(); }; });
  recorder.ondataavailable = (e) => { if (e.data.size > 0) enqueue(e.data); };
  recorder.onerror = () => { if (!failed) { failed = true; options.onFailure('recorder'); } };
  recorder.start(PIECE_MS);

  return {
    stop() {
      stopped ??= (async () => {
        if (recorder.state !== 'inactive') recorder.stop();
        await ended;
        await sender.flush();
      })();
      return stopped.then(() => ({ durationMs: Date.now() - startedAt, sent: sender.sent() }));
    },
  };
}
