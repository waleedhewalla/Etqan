'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@itqan/ui';
import { Radio } from 'lucide-react';
import { api, queryKeys } from '@/lib/api';

/** Shown on the home screen while a live lesson of one of the user's halaqat is on. */
export function LiveNowBanner() {
  const now = useQuery({ queryKey: queryKeys.liveNow, queryFn: () => api.getLiveNow().then((r) => r.data), refetchInterval: 20000 });
  if (!now.data?.length) return null;
  return (
    <div className="mb-4 space-y-2" data-testid="live-now">
      {now.data.map((s) => (
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
