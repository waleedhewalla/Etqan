'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@itqan/ui';
import { Trash2 } from 'lucide-react';
import { AYAH_COUNTS } from '@itqan/quran';
import { api, errorMessage, queryKeys, type TeacherLesson } from '@/lib/api';
import { formatAyahRange, SURAH_NAMES, toArabicDigits } from '@/lib/quran';
import { RecitationRecorder, type Recording } from '@/components/RecitationRecorder';
import { TasmiAudio } from '@/components/TasmiAudio';
import { VerseText } from '@/components/VerseText';
import { LoadError, Spinner } from '@/components/LoadState';

/** The most verses a student can recite back in one recording, so the most a lesson may cover. */
const MAX_AYAT = 60;
const field = 'rounded-xl border border-divider bg-surface-elevated px-3 py-2';
const day = (iso: string) => new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'long' }).format(new Date(iso));

/**
 * «آيات للحفظ»: the teacher records verses for her halaqa to listen to and memorize,
 * and sees how many students have recited each lesson back.
 */
export function TeacherLessons({ sectionId }: { sectionId: string }) {
  const queryClient = useQueryClient();
  const key = queryKeys.sectionLessons(sectionId);
  const lessons = useQuery({ queryKey: key, queryFn: () => api.getSectionLessons(sectionId).then((r) => r.data) });

  const [sura, setSura] = useState(78);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(5);
  const [note, setNote] = useState('');
  const [addToPlan, setAddToPlan] = useState(true);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [recorderKey, setRecorderKey] = useState(0);
  const [notice, setNotice] = useState('');
  const count = AYAH_COUNTS[sura - 1];
  const valid = from >= 1 && to <= count && from <= to && to - from + 1 <= MAX_AYAT;

  const create = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('startRef', `${sura}:${from}`);
      form.append('endRef', `${sura}:${to}`);
      if (note.trim()) form.append('note', note.trim());
      form.append('durationMs', String(Math.round(recording!.durationMs)));
      form.append('addToPlan', String(addToPlan));
      form.append('audio', recording!.blob, 'lesson');
      return api.createLesson(sectionId, form).then((r) => r.data);
    },
    onSuccess: (lesson) => {
      setRecording(null);
      setRecorderKey((k) => k + 1);
      setNote('');
      setNotice(`نُشرت ${formatAyahRange(lesson.startRef, lesson.endRef)} لطالبات الحلقة.${lesson.planned ? ' وأُضيفت إلى خطط حفظهن.' : ''}`);
      queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const remove = useMutation({
    mutationFn: (lesson: TeacherLesson) => api.deleteLesson(lesson.id),
    onSuccess: () => { setNotice('حُذف الدرس وتسجيله.'); queryClient.invalidateQueries({ queryKey: key }); },
  });
  const confirmRemove = (lesson: TeacherLesson) => {
    const kept = lesson.recited ? ' تسميعات الطالبات لهذه الآيات تبقى.' : '';
    if (window.confirm(`حذف ${formatAyahRange(lesson.startRef, lesson.endRef)} وتسجيلها؟${kept}`)) remove.mutate(lesson);
  };
  const setNumber = (set: (n: number) => void) => (e: React.ChangeEvent<HTMLInputElement>) => { set(Math.floor(Number(e.target.value))); setNotice(''); };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>آيات للحفظ</CardTitle>
          <CardDescription>سجّلي الآيات بصوتك لتستمع إليها طالبات الحلقة ويحفظنها، ثم يسمّعنها لكِ.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="block text-text-secondary mb-1">السورة</span>
              <select id="lesson-sura" value={sura} className={`${field} min-w-[10rem]`}
                onChange={(e) => { const n = Number(e.target.value); setSura(n); setFrom(1); setTo(Math.min(AYAH_COUNTS[n - 1], 5)); setNotice(''); }}>
                {SURAH_NAMES.map((name, i) => <option key={name} value={i + 1}>{toArabicDigits(i + 1)}. {name}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-text-secondary mb-1">من الآية</span>
              <input id="lesson-from" type="number" min={1} max={count} value={from} onChange={setNumber(setFrom)} className={`${field} w-20`} />
            </label>
            <label className="text-sm">
              <span className="block text-text-secondary mb-1">إلى الآية</span>
              <input id="lesson-to" type="number" min={1} max={count} value={to} onChange={setNumber(setTo)} className={`${field} w-20`} />
            </label>
          </div>
          {!valid ? (
            <p role="alert" className="text-sm text-red-800">
              تحققي من أرقام الآيات: في السورة {toArabicDigits(count)} آية، والدرس الواحد حتى {toArabicDigits(MAX_AYAT)} آية.
            </p>
          ) : (
            <div className="rounded-xl border border-divider bg-surface-canvas p-4 max-h-56 overflow-y-auto">
              <VerseText start={`${sura}:${from}`} end={`${sura}:${to}`} />
            </div>
          )}

          <RecitationRecorder key={recorderKey} onChange={(r) => { setRecording(r); setNotice(''); }} disabled={create.isPending} />

          <label className="block text-sm">
            <span className="font-medium text-text-primary">ملاحظة للطالبات (اختياري)</span>
            <input id="lesson-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)}
              placeholder="مثال: انتبهن لمدّ الكلمة الأولى" className={`${field} mt-1 w-full`} />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input id="lesson-plan" type="checkbox" checked={addToPlan} onChange={(e) => setAddToPlan(e.target.checked)} className="mt-1" />
            <span>أضيفي هذه الآيات إلى خطة كل طالبة حفظاً جديداً. الآيات الموجودة في خطتها لا تتغير.</span>
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!recording || !valid}>نشر للطالبات</Button>
            {!recording && <span className="text-sm text-text-secondary">سجّلي التلاوة أولاً.</span>}
          </div>
          {notice && <p role="status" className="text-sm text-text-primary">{notice}</p>}
          {(create.isError || remove.isError) && (
            <p role="alert" className="text-sm text-red-800">{errorMessage(create.error ?? remove.error, 'تعذّر الحفظ. حاولي مرة أخرى.')}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>الدروس المنشورة</CardTitle></CardHeader>
        <CardContent>
          {lessons.isLoading ? <Spinner /> : !lessons.data ? <LoadError onRetry={() => lessons.refetch()} /> : lessons.data.length === 0 ? (
            <p className="text-sm text-text-secondary">لم تنشري آيات للحفظ بعد.</p>
          ) : (
            <ul className="divide-y divide-divider" data-testid="teacher-lessons">
              {lessons.data.map((l) => (
                <li key={l.id} className="py-3 space-y-2">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <p className="font-medium text-text-primary">
                      {formatAyahRange(l.startRef, l.endRef)} <span className="text-sm font-normal text-text-secondary">· {day(l.createdAt)}</span>
                    </p>
                    <span className="flex items-center gap-2 text-sm text-text-secondary">
                      سمّعت {toArabicDigits(l.recited)} من {toArabicDigits(l.students)}
                      <button type="button" onClick={() => confirmRemove(l)} disabled={remove.isPending}
                        className="p-1.5 rounded-lg hover:bg-surface-canvas hover:text-red-800" aria-label={`حذف ${formatAyahRange(l.startRef, l.endRef)}`}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </span>
                  </div>
                  {l.note && <p className="text-sm text-text-secondary">{l.note}</p>}
                  <TasmiAudio id={l.id} hasAudio kind="lesson" />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
