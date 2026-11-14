'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@itqan/ui';
import { Play } from 'lucide-react';
import { API_URL, api, queryKeys, type LiveSession } from '@/lib/api';
import { formatAyahRange, toArabicDigits } from '@/lib/quran';

const day = (iso: string) => new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));
/** «٤٧ دقيقة», or nothing when the length is unknown. */
export const lessonLength = (ms: number | null) => (!ms ? '' : ms < 60_000 ? 'أقل من دقيقة' : `${toArabicDigits(Math.round(ms / 60_000))} دقيقة`);

/**
 * Plays the recording of a live lesson. The link is asked for only when she presses play.
 * A recording made in a browser does not say how long it is, so the player is told once it loads.
 */
export function RecordingPlayer({ id }: { id: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function load() {
    setLoading(true);
    setFailed(false);
    try {
      const { data } = await api.getLiveRecordingLink(id);
      setSrc(`${API_URL}${data.url}`);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      {src ? (
        <video controls autoPlay playsInline src={src} className="w-full rounded-xl bg-black aspect-video" data-testid="recording-video"
          onError={() => { setSrc(null); setFailed(true); }}>
          متصفحك لا يدعم تشغيل هذا التسجيل.
        </video>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={load} loading={loading}>
          <Play className="w-4 h-4 ml-1" /> شاهدي التسجيل
        </Button>
      )}
      {failed && <p role="alert" className="text-sm text-red-800">تعذّر تشغيل التسجيل. حاولي مرة أخرى، أو جرّبي متصفح Chrome.</p>}
    </div>
  );
}

/** True when a lesson's verses can be recited back in one recording: one sura, not too many ayat. */
const recitable = (s: LiveSession, maxAyat: number) => {
  if (!s.startRef || !s.endRef) return false;
  const [sura, from] = s.startRef.split(':').map(Number);
  const [endSura, to] = s.endRef.split(':').map(Number);
  return sura === endSura && to - from + 1 <= maxAyat;
};

/**
 * Recorded live lessons of the student's halaqat: she watches what she missed or wants to hear again,
 * and `onRecite` hands the lesson's verses to the recording form.
 */
export function LessonRecordings({ onRecite, maxAyat }: { onRecite: (s: LiveSession) => void; maxAyat: number }) {
  const recordings = useQuery({ queryKey: queryKeys.liveRecordings, queryFn: () => api.getLiveRecordings().then((r) => r.data), refetchOnMount: 'always' });
  if (!recordings.data?.length) return null; // nothing to show until a lesson is recorded

  return (
    <Card data-testid="lesson-recordings">
      <CardHeader>
        <CardTitle>دروس مسجَّلة</CardTitle>
        <CardDescription>دروس معلمتكِ المباشرة التي سُجّلت. شاهديها متى شئتِ، ثم سمّعي آياتها.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-divider">
          {recordings.data.map((s) => (
            <li key={s.id} className="py-3 space-y-2">
              <p className="font-medium text-text-primary">
                {s.title}
                <span className="text-sm font-normal text-text-secondary">
                  {' · '}{s.teacherName ?? 'المعلمة'} · {day(s.startedAt)}{s.recordingDurationMs ? ` · ${lessonLength(s.recordingDurationMs)}` : ''}
                </span>
              </p>
              {s.startRef && s.endRef && <p className="text-sm text-text-secondary">{formatAyahRange(s.startRef, s.endRef)}</p>}
              <RecordingPlayer id={s.id} />
              {recitable(s, maxAyat) && <Button size="sm" onClick={() => onRecite(s)}>سمّعي آيات الدرس</Button>}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
