'use client';

import { useState } from 'react';
import { Button } from '@itqan/ui';
import { Play } from 'lucide-react';
import { API_URL, api } from '@/lib/api';

/**
 * Plays a stored recitation. The link is requested only when someone presses play
 * (each request is recorded in the audit log) and expires after a few minutes.
 */
export function TasmiAudio({ id, hasAudio, kind = 'recording' }: {
  id: string;
  hasAudio: boolean;
  /** `reply` plays the teacher's recorded reply to this recitation instead of the recitation itself. */
  kind?: 'recording' | 'reply';
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!hasAudio) {
    return kind === 'reply' ? null : <p className="text-sm text-text-secondary">لا يوجد تسجيل صوتي لهذا التسميع.</p>;
  }

  async function load() {
    setLoading(true);
    setFailed(false);
    try {
      const { data } = await (kind === 'reply' ? api.getTasmiReplyAudioLink(id) : api.getTasmiAudioLink(id));
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
        <audio controls autoPlay src={src} className="w-full" onError={() => { setSrc(null); setFailed(true); }}>
          متصفحك لا يدعم تشغيل الصوت.
        </audio>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={load} loading={loading}>
          <Play className="w-4 h-4 ml-1" /> {kind === 'reply' ? 'استمعي إلى ردّ المعلمة' : 'تشغيل التسجيل'}
        </Button>
      )}
      {failed && <p role="alert" className="text-sm text-red-800">تعذّر تشغيل التسجيل. حاولي مرة أخرى.</p>}
    </div>
  );
}
