'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@itqan/ui';
import { api, queryKeys, type StudentLesson } from '@/lib/api';
import { formatAyahRange, toArabicDigits } from '@/lib/quran';
import { TasmiAudio } from '@/components/TasmiAudio';
import { VerseText } from '@/components/VerseText';

const day = (iso: string) => new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'long' }).format(new Date(iso));

function status(lesson: StudentLesson): { label: string; tone: 'green' | 'amber' | 'info' | 'neutral' } {
  const mine = lesson.myRecitation;
  if (!mine) return { label: 'لم تسمّعيها بعد', tone: 'neutral' };
  if (mine.verdict === 'approved') return { label: `مقبول${mine.total !== null ? ` · ${toArabicDigits(Math.round(mine.total))}` : ''}`, tone: 'green' };
  if (mine.verdict === 'redo') return { label: 'أعيدي التسميع', tone: 'amber' };
  return { label: 'بانتظار تقييم المعلمة', tone: 'info' };
}

/**
 * «آيات للحفظ»: verses the student's teacher recorded. She listens, memorizes, then recites them back;
 * `onRecite` hands the lesson to the recording form.
 */
export function StudentLessons({ onRecite, selectedId }: { onRecite: (lesson: StudentLesson) => void; selectedId: string | null }) {
  const lessons = useQuery({ queryKey: queryKeys.myLessons, queryFn: () => api.getMyLessons().then((r) => r.data), refetchOnMount: 'always' });
  const [open, setOpen] = useState<string | null>(null);
  if (!lessons.data?.length) return null; // nothing to show until a teacher records something

  return (
    <Card data-testid="student-lessons">
      <CardHeader>
        <CardTitle>آيات للحفظ من معلمتكِ</CardTitle>
        <CardDescription>استمعي إلى تلاوة معلمتكِ وكرّريها حتى تحفظيها، ثم سمّعيها لها.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-divider">
          {lessons.data.map((l) => {
            const s = status(l);
            return (
              <li key={l.id} className={`py-3 space-y-2 ${selectedId === l.id ? 'rounded-xl bg-brand-primary/5 px-3 -mx-3' : ''}`}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="font-medium text-text-primary">
                    {formatAyahRange(l.startRef, l.endRef)}
                    <span className="text-sm font-normal text-text-secondary"> · {l.teacherName ?? 'المعلمة'} · {day(l.createdAt)}</span>
                  </p>
                  <Badge variant={s.tone} size="sm">{s.label}</Badge>
                </div>
                {l.note && <p className="text-sm text-text-secondary">{l.note}</p>}
                <TasmiAudio id={l.id} hasAudio kind="lesson" />
                {open === l.id && (
                  <div className="rounded-xl border border-divider bg-surface-canvas p-4 max-h-56 overflow-y-auto">
                    <VerseText start={l.startRef} end={l.endRef} />
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setOpen(open === l.id ? null : l.id)}>
                    {open === l.id ? 'إخفاء الآيات' : 'أظهري الآيات'}
                  </Button>
                  <Button size="sm" onClick={() => onRecite(l)}>
                    {l.myRecitation ? 'سمّعيها مرة أخرى' : 'سمّعي هذه الآيات'}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
