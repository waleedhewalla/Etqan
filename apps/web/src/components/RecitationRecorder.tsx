'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@itqan/ui';
import { Mic, RotateCcw, Square } from 'lucide-react';
import { toArabicDigits } from '@/lib/quran';

export const MIN_RECORDING_MS = 3_000;
export const MAX_RECORDING_MS = 5 * 60_000;

export interface Recording {
  blob: Blob;
  durationMs: number;
}

/** The first recording format this browser supports (Safari records MP4, the rest WebM). */
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
    .find((t) => MediaRecorder.isTypeSupported(t));
}

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${toArabicDigits(Math.floor(s / 60))}:${toArabicDigits(String(s % 60).padStart(2, '0'))}`;
};

type Phase = 'idle' | 'recording' | 'done';

/**
 * Records from the microphone, shows a level meter, and lets her listen back before
 * anything is sent. Nothing leaves the device until the parent uploads `onChange`'s recording.
 */
export function RecitationRecorder({ onChange, disabled }: {
  onChange: (recording: Recording | null) => void;
  disabled?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const raf = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval>>();
  const audioCtx = useRef<AudioContext | null>(null);

  const release = () => {
    cancelAnimationFrame(raf.current);
    clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void audioCtx.current?.close().catch(() => undefined);
    audioCtx.current = null;
    setLevel(0);
  };

  useEffect(() => () => {
    if (recorder.current?.state === 'recording') recorder.current.stop();
    release();
  }, []);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const supported = typeof window !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && Boolean(pickMimeType());

  async function start() {
    setError(null);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      stream.current = media;

      const mimeType = pickMimeType();
      const rec = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      recorder.current = rec;
      chunks.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      rec.onstop = () => {
        const durationMs = Date.now() - startedAt.current;
        const blob = new Blob(chunks.current, { type: rec.mimeType || mimeType || 'audio/webm' });
        release();
        if (durationMs < MIN_RECORDING_MS) {
          setError('التسجيل قصير جداً. سجّلي ثلاث ثوانٍ على الأقل.');
          setPhase('idle');
          onChange(null);
          return;
        }
        setPreviewUrl(URL.createObjectURL(blob));
        setElapsed(durationMs);
        setPhase('done');
        onChange({ blob, durationMs });
      };

      // Level meter
      const ctx = new AudioContext();
      audioCtx.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(media).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(1, peak / 80));
        raf.current = requestAnimationFrame(tick);
      };
      tick();

      startedAt.current = Date.now();
      setElapsed(0);
      timer.current = setInterval(() => {
        const ms = Date.now() - startedAt.current;
        setElapsed(ms);
        if (ms >= MAX_RECORDING_MS) stop();
      }, 250);
      rec.start();
      setPhase('recording');
    } catch (err) {
      release();
      const name = (err as DOMException)?.name;
      setError(name === 'NotAllowedError' || name === 'SecurityError'
        ? 'لم يُسمح باستخدام الميكروفون. فعّلي الإذن من إعدادات المتصفح ثم حاولي مرة أخرى.'
        : name === 'NotFoundError'
          ? 'لم نجد ميكروفوناً في هذا الجهاز.'
          : 'تعذّر بدء التسجيل.');
    }
  }

  function stop() {
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }

  function reset() {
    setPreviewUrl(null);
    setPhase('idle');
    setElapsed(0);
    setError(null);
    onChange(null);
  }

  if (!supported) {
    return (
      <p role="alert" className="text-sm rounded-lg px-3 py-2 bg-amber-50 text-amber-900">
        متصفحك لا يدعم التسجيل الصوتي، أو أن الصفحة غير مؤمّنة (HTTPS). جرّبي Chrome أو Safari حديثاً.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        {phase === 'idle' && (
          <Button type="button" onClick={start} disabled={disabled}>
            <Mic className="w-4 h-4 ml-1" /> ابدئي التسجيل
          </Button>
        )}
        {phase === 'recording' && (
          <Button type="button" variant="outline" onClick={stop}>
            <Square className="w-4 h-4 ml-1 text-red-600" /> إنهاء التسجيل
          </Button>
        )}
        {phase === 'done' && (
          <Button type="button" variant="outline" onClick={reset} disabled={disabled}>
            <RotateCcw className="w-4 h-4 ml-1" /> إعادة التسجيل
          </Button>
        )}
        {phase !== 'idle' && (
          <span className="tabular-nums text-sm text-text-secondary" aria-live="off">
            {clock(elapsed)} / {clock(MAX_RECORDING_MS)}
          </span>
        )}
      </div>

      {phase === 'recording' && (
        <div className="h-2 rounded-full bg-divider overflow-hidden" role="meter" aria-label="مستوى الصوت" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
          <div className="h-full bg-brand-primary transition-[width] duration-75" style={{ width: `${Math.max(4, level * 100)}%` }} />
        </div>
      )}

      {phase === 'done' && previewUrl && (
        <audio controls src={previewUrl} className="w-full" data-testid="recording-preview">
          متصفحك لا يدعم تشغيل الصوت.
        </audio>
      )}

      {error && <p role="alert" className="text-sm rounded-lg px-3 py-2 bg-red-50 text-red-800">{error}</p>}
    </div>
  );
}
