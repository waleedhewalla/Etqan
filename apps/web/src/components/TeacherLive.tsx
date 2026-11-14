'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@itqan/ui';
import { Radio } from 'lucide-react';
import { AYAH_COUNTS } from '@itqan/quran';
import { api, errorMessage, queryKeys, type LiveSession } from '@/lib/api';
import { formatAyahRange, SURAH_NAMES, toArabicDigits } from '@/lib/quran';
import { LoadError, Spinner } from '@/components/LoadState';

const field = 'rounded-xl border border-divider bg-surface-elevated px-3 py-2';
const when = (iso: string) => new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
/** The calendar day of a lesson in the institution's time zone, as the attendance sheet stores it. */
const dayOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

/** Where a teacher starts a live lesson for her halaqa, and finds the ones she has held. */
export function TeacherLive({ sectionId }: { sectionId: string }) {
  const queryClient = useQueryClient();
  const key = queryKeys.sectionLive(sectionId);
  const list = useQuery({ queryKey: key, queryFn: () => api.getSectionLive(sectionId).then((r) => r.data), refetchInterval: 15000 });

  const [title, setTitle] = useState('');
  const [withVerses, setWithVerses] = useState(false);
  const [sura, setSura] = useState(67);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(5);
  const [notice, setNotice] = useState('');
  const count = AYAH_COUNTS[sura - 1];
  const validVerses = !withVerses || (from >= 1 && to <= count && from <= to);

  const start = useMutation({
    mutationFn: () => api.startLive(sectionId, {
      title: title.trim(),
      ...(withVerses ? { startRef: `${sura}:${from}`, endRef: `${sura}:${to}` } : {}),
    }).then((r) => r.data),
    onSuccess: (session) => { queryClient.invalidateQueries({ queryKey: ['live'] }); window.location.assign(`/live/${session.id}`); },
  });
  const attendance = useMutation({
    mutationFn: async (session: LiveSession) => {
      const { data } = await api.getLiveAttendance(session.id);
      const absent = data.records.filter((r) => !r.present).length;
      const ok = window.confirm(
        `تسجيل حضور ${dayOf(session.startedAt)} من هذا الدرس؟ حضرت ${data.records.length - absent} وغابت ${absent}.`
        + (absent ? ' يصل تنبيه إلى أولياء أمور الغائبات.' : ''),
      );
      if (!ok) return null;
      await api.saveAttendance(sectionId, dayOf(session.startedAt), data.records.map((r) => ({ studentId: r.studentId, present: r.present })));
      return { present: data.records.length - absent, absent };
    },
    onSuccess: (r) => {
      if (!r) return;
      setNotice(`سُجّل الحضور: ${toArabicDigits(r.present)} حاضرة، ${toArabicDigits(r.absent)} غائبة.`);
      queryClient.invalidateQueries({ queryKey: ['sections', sectionId] });
    },
  });

  if (list.isLoading) return <Spinner />;
  if (!list.data) return <LoadError onRetry={() => list.refetch()} />;
  const { enabled, sessions } = list.data;
  const running = sessions.find((s) => s.status === 'live');

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Radio className="w-5 h-5 text-brand-primary" />الدرس المباشر</CardTitle>
          <CardDescription>
            تسمعكِ طالبات الحلقة مباشرة، وترين أسئلتهن ومن ترفع يدها. شاركي شاشتكِ لعرض المصحف (من حاسوب، لا من هاتف).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!enabled ? (
            <p className="rounded-xl bg-amber-50 text-amber-900 px-3 py-2 text-sm" data-testid="live-disabled">
              الدروس المباشرة غير مفعّلة على هذا الخادم بعد. يفعّلها مسؤول النظام بإعداد خادم الصوت والصورة (انظري دليل النشر).
            </p>
          ) : running ? (
            <div className="rounded-xl border border-brand-primary/30 bg-brand-primary/5 p-4 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="font-medium text-text-primary">{running.title} <Badge variant="red" size="sm">مباشر</Badge></p>
                <p className="text-sm text-text-secondary">بدأ {when(running.startedAt)} · {toArabicDigits(running.attended)} طالبة حضرت</p>
              </div>
              <Link href={`/live/${running.id}`}><Button>ادخلي الدرس</Button></Link>
            </div>
          ) : (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (title.trim().length >= 2 && validVerses) start.mutate(); }}>
              <Input id="live-title" label="عنوان الدرس" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: درس سورة الملك" required minLength={2} maxLength={120} />
              <label className="flex items-center gap-2 text-sm">
                <input id="live-with-verses" type="checkbox" checked={withVerses} onChange={(e) => setWithVerses(e.target.checked)} />
                حدّدي آيات الدرس (تظهر للطالبات في الغرفة)
              </label>
              {withVerses && (
                <div className="flex flex-wrap items-end gap-3">
                  <label className="text-sm">
                    <span className="block text-text-secondary mb-1">السورة</span>
                    <select value={sura} className={`${field} min-w-[10rem]`}
                      onChange={(e) => { const n = Number(e.target.value); setSura(n); setFrom(1); setTo(Math.min(AYAH_COUNTS[n - 1], 5)); }}>
                      {SURAH_NAMES.map((name, i) => <option key={name} value={i + 1}>{toArabicDigits(i + 1)}. {name}</option>)}
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="block text-text-secondary mb-1">من الآية</span>
                    <input type="number" min={1} max={count} value={from} onChange={(e) => setFrom(Math.floor(Number(e.target.value)))} className={`${field} w-20`} />
                  </label>
                  <label className="text-sm">
                    <span className="block text-text-secondary mb-1">إلى الآية</span>
                    <input type="number" min={1} max={count} value={to} onChange={(e) => setTo(Math.floor(Number(e.target.value)))} className={`${field} w-20`} />
                  </label>
                </div>
              )}
              {!validVerses && <p role="alert" className="text-sm text-red-800">تحققي من أرقام الآيات: في السورة {toArabicDigits(count)} آية.</p>}
              <Button type="submit" loading={start.isPending} disabled={!validVerses}>ابدئي الدرس الآن</Button>
            </form>
          )}
          {start.isError && <p role="alert" className="text-sm text-red-800">{errorMessage(start.error, 'تعذّر بدء الدرس.')}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>الدروس السابقة</CardTitle></CardHeader>
        <CardContent>
          {sessions.filter((s) => s.status === 'ended').length === 0 ? (
            <p className="text-sm text-text-secondary">لا دروس سابقة.</p>
          ) : (
            <ul className="divide-y divide-divider" data-testid="past-live">
              {sessions.filter((s) => s.status === 'ended').map((s) => (
                <li key={s.id} className="py-3 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="font-medium text-text-primary">{s.title}</p>
                    <p className="text-sm text-text-secondary">
                      {when(s.startedAt)}{s.startRef && s.endRef && ` · ${formatAyahRange(s.startRef, s.endRef)}`} · حضرت {toArabicDigits(s.attended)}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" loading={attendance.isPending && attendance.variables?.id === s.id} onClick={() => attendance.mutate(s)}>
                    تسجيل الحضور من الدرس
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {notice && <p role="status" className="mt-3 text-sm text-text-primary">{notice}</p>}
          {attendance.isError && <p role="alert" className="mt-3 text-sm text-red-800">{errorMessage(attendance.error, 'تعذّر تسجيل الحضور.')}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
