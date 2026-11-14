'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@itqan/ui';
import { CalendarClock, Radio } from 'lucide-react';
import { api, queryKeys } from '@/lib/api';
import { lessonTime } from '@/lib/live-time';

/** Shown on the home screen while a live lesson of one of the user's halaqat is on. */
export function LiveNowBanner() {
  const now = useQuery({ queryKey: queryKeys.liveNow, queryFn: () => api.getLiveNow().then((r) => r.data), refetchInterval: 20000 });
  const upcoming = useQuery({ queryKey: queryKeys.liveUpcoming, queryFn: () => api.getLiveUpcoming().then((r) => r.data), refetchInterval: 60000 });
  const soon = upcoming.data?.slice(0, 3) ?? [];
  if (!now.data?.length && soon.length === 0) return null;
  return (
    <div className="mb-4 space-y-2" data-testid="live-now">
      {soon.map((s) => (
        <div key={s.id} className="rounded-2xl border border-divider bg-surface-elevated p-4 flex items-center gap-2 text-sm text-text-primary" data-testid="live-upcoming">
          <CalendarClock className="w-5 h-5 text-brand-primary shrink-0" />
          <span><b>درس قادم:</b> {s.title}{s.sectionName && ` — ${s.sectionName}`} · {lessonTime(s.scheduledAt!)}</span>
        </div>
      ))}
      {(now.data ?? []).map((s) => (
        <div key={s.id} className="rounded-2xl border border-red-200 bg-red-50 p-4 flex items-center justify-between gap-3 flex-wrap">
          <p className="flex items-center gap-2 text-sm text-red-900">
            <Radio className="w-5 h-5" />
            <span><b>درس مباشر الآن:</b> {s.title}{s.teacherName && ` — ${s.teacherName}`}</span>
          </p>
          <Link href={`/live/${s.id}`}><Button size="sm">انضمي</Button></Link>
        </div>
      ))}
    </div>
  );
}
