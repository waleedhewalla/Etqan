'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@itqan/ui';
import { ArrowDown, ArrowUp, BookOpenCheck, Plus, Trash2 } from 'lucide-react';
import { AYAH_COUNTS, compareRefs, countAyat, estimatePages, hifzWeeksFor, parseRef } from '@itqan/quran';
import {
  api, errorMessage, queryKeys, type AdminPrograms, type HifzProgram, type ProgramPeriod, type ProgramPeriodInput, type ProgramWeights,
} from '@/lib/api';
import { formatAyahRange, SURAH_NAMES, toArabicDigits } from '@/lib/quran';
import { PACE_OPTIONS, paceLabel, programDay, weekRhythm, weeksText } from '@/lib/program';
import { LoadError, Spinner } from '@/components/LoadState';
import { useModules } from '@/lib/modules';

const field = 'rounded-xl border border-divider bg-surface-elevated px-3 py-2 text-sm';
const MAX_PERIOD_AYAT = 1500;
const GOOD_WEEKS = { min: 3, max: 6 };

/** A period as it is being edited: verses as sura and ayah numbers, so every box can be typed in. */
interface Draft {
  key: string;
  nameAr: string;
  goalAr: string;
  mode: 'hifz' | 'consolidation';
  sura1: number; ayah1: number; sura2: number; ayah2: number;
  pagesPerDay: number;
  extraPct: number;
  fixedWeeks: number;
}
let nextKey = 0;
const blank = (over: Partial<Draft> = {}): Draft => ({
  key: `new-${nextKey++}`, nameAr: '', goalAr: '', mode: 'hifz', sura1: 78, ayah1: 1, sura2: 78, ayah2: 40,
  pagesPerDay: 0.75, extraPct: 0, fixedWeeks: 2, ...over,
});
const toDraft = (p: ProgramPeriod): Draft => {
  const [sura1, ayah1] = (p.startRef ?? '78:1').split(':').map(Number);
  const [sura2, ayah2] = (p.endRef ?? '78:40').split(':').map(Number);
  return {
    key: p.id ?? `new-${nextKey++}`, nameAr: p.nameAr, goalAr: p.goalAr ?? '', mode: p.kind, sura1, ayah1, sura2, ayah2,
    pagesPerDay: p.pagesPerDay, extraPct: p.extraPct, fixedWeeks: p.fixedWeeks ?? 2,
  };
};
const refs = (d: Draft) => ({ start: `${d.sura1}:${d.ayah1}`, end: `${d.sura2}:${d.ayah2}` });

/** What a draft comes to, worked out here with the same functions the server uses, so the table updates as the admin types. */
function sizeOf(d: Draft, hifzDays: number): { error?: string; ayat: number; pages: number; hifzWeeks: number; weeks: number } {
  const none = { ayat: 0, pages: 0, hifzWeeks: 0 };
  if (d.nameAr.trim().length < 2) return { ...none, weeks: 0, error: 'اكتبي اسم الفترة.' };
  if (d.mode === 'consolidation') {
    return d.fixedWeeks >= 1 && d.fixedWeeks <= 12 ? { ...none, weeks: d.fixedWeeks } : { ...none, weeks: 0, error: 'عدد الأسابيع بين ١ و١٢.' };
  }
  const { start, end } = refs(d);
  const a = parseRef(start); const b = parseRef(end);
  if (!a || !b) return { ...none, weeks: 0, error: 'تحققي من أرقام الآيات.' };
  if (compareRefs(a, b) > 0) return { ...none, weeks: 0, error: 'نهاية المقرر قبل بدايته.' };
  const ayat = countAyat(a, b);
  if (ayat > MAX_PERIOD_AYAT) return { ...none, weeks: 0, error: `الحد الأقصى ${toArabicDigits(MAX_PERIOD_AYAT)} آية في الفترة.` };
  const pages = estimatePages(start, end);
  const hifzWeeks = hifzWeeksFor(pages, d.pagesPerDay, d.extraPct, hifzDays);
  return { ayat, pages, hifzWeeks, weeks: hifzWeeks + 1 };
}

const toInput = (d: Draft): ProgramPeriodInput => d.mode === 'consolidation'
  ? { nameAr: d.nameAr.trim(), goalAr: d.goalAr.trim() || null, fixedWeeks: d.fixedWeeks }
  : {
    nameAr: d.nameAr.trim(), goalAr: d.goalAr.trim() || null, startRef: refs(d).start, endRef: refs(d).end,
    pagesPerDay: d.pagesPerDay, extraPct: d.extraPct,
  };

/** «الأسبوع ٥» or «الأسابيع ٥–٨». */
const weeksSpan = (from: number, weeks: number) => (weeks <= 1 ? `الأسبوع ${toArabicDigits(from + 1)}` : `الأسابيع ${toArabicDigits(from + 1)}–${toArabicDigits(from + weeks)}`);

/** Where the admin sets what must be memorized in each period, how fast, and how a period is assessed. */
export function HifzProgramSetup() {
  const queryClient = useQueryClient();
  const { isOn } = useModules();
  const data = useQuery({ queryKey: queryKeys.adminPrograms, queryFn: () => api.getPrograms().then((r) => r.data), enabled: isOn('program') });
  const [chosen, setChosen] = useState('');
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.adminPrograms });
    queryClient.invalidateQueries({ queryKey: ['sections'] });
  };
  const create = useMutation({
    mutationFn: (nameAr: string) => api.createProgram({ nameAr }).then((r) => r.data),
    onSuccess: (p) => { setChosen(p.id); refresh(); },
  });
  const [newName, setNewName] = useState('');

  if (!isOn('program')) {
    return (
      <Card data-testid="program-off"><CardContent className="py-6 text-sm text-text-secondary">
        وحدة «برنامج الحفظ» موقوفة في مؤسستكِ. فعّليها من تبويب «الوحدات» لتضبطي فترات الحفظ.
      </CardContent></Card>
    );
  }
  if (data.isLoading) return <Spinner />;
  if (data.isError || !data.data) return <LoadError onRetry={() => data.refetch()} />;
  const { programs, halaqat } = data.data;
  const program = programs.find((p) => p.id === chosen) ?? programs[0];

  return (
    <Card id="hifz-program" data-testid="hifz-program">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><BookOpenCheck className="w-5 h-5 text-brand-primary" />برنامج الحفظ</CardTitle>
        <CardDescription>
          حدّدي فترات الحفظ، وما يُطلب حفظه في كل فترة وبأي وتيرة. تُحسب مدة كل فترة وجدولها من ذلك، وتظهر لكل حلقة تتبع البرنامج مقرّرها الحالي.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-end gap-3">
          {programs.length > 0 && (
            <label className="text-sm">
              <span className="block text-text-secondary mb-1">البرنامج</span>
              <select aria-label="البرنامج" className={`${field} min-w-[12rem]`} value={program?.id ?? ''} onChange={(e) => setChosen(e.target.value)}>
                {programs.map((p) => <option key={p.id} value={p.id}>{p.nameAr}{p.active ? '' : ' (مؤرشف)'}</option>)}
              </select>
            </label>
          )}
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (newName.trim().length >= 2) { create.mutate(newName.trim()); setNewName(''); } }}>
            <Input id="program-new-name" label={programs.length ? 'برنامج جديد' : 'اسم البرنامج'} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="مثال: برنامج السنة الأولى" minLength={2} />
            <Button type="submit" loading={create.isPending} disabled={newName.trim().length < 2}><Plus className="w-4 h-4 ml-1" /> إنشاء</Button>
          </form>
        </div>
        {create.isError && <p role="alert" className="text-sm text-red-800">{errorMessage(create.error, 'تعذّر إنشاء البرنامج.')}</p>}

        {program ? (
          <>
            <Settings key={program.id} program={program} onChange={refresh} onDeleted={() => setChosen('')} />
            <Periods key={`${program.id}-${program.periods.map((p) => p.id).join()}-${program.hifzDaysPerWeek}`} program={program} onChange={refresh} />
            <Summary program={program} />
            {(program.inUse || program.hasResults) && <Results program={program} />}
            <Assignment program={program} halaqat={halaqat} programs={programs} today={data.data.today} onChange={refresh} />
          </>
        ) : (
          <p className="text-sm text-text-secondary">لا برامج بعد. أنشئي برنامجاً ثم أضيفي إليه الفترات.</p>
        )}
      </CardContent>
    </Card>
  );
}

function Settings({ program, onChange, onDeleted }: { program: HifzProgram; onChange: () => void; onDeleted: () => void }) {
  const [name, setName] = useState(program.nameAr);
  const [days, setDays] = useState(program.hifzDaysPerWeek);
  const [weights, setWeights] = useState<ProgramWeights>(program.weights);
  const [pass, setPass] = useState(program.passScore);
  const [min, setMin] = useState(program.minCriterionPct);
  const [notice, setNotice] = useState('');
  const sum = weights.hifz + weights.tajweed + weights.review + weights.retention;
  const save = useMutation({
    mutationFn: () => api.editProgram(program.id, { nameAr: name.trim(), hifzDaysPerWeek: days, weights, passScore: pass, minCriterionPct: min }).then((r) => r.data),
    onSuccess: () => { setNotice('حُفظت إعدادات البرنامج.'); onChange(); },
  });
  const archive = useMutation({
    mutationFn: () => api.editProgram(program.id, { active: !program.active }).then((r) => r.data),
    onSuccess: (p) => { setNotice(p.active ? 'أُعيد تفعيل البرنامج.' : 'أُرشف البرنامج: لا يمكن إسناده إلى حلقات جديدة.'); onChange(); },
  });
  const remove = useMutation({ mutationFn: () => api.deleteProgram(program.id), onSuccess: () => { onDeleted(); onChange(); } });
  const num = (set: (n: number) => void) => (e: React.ChangeEvent<HTMLInputElement>) => set(Math.floor(Number(e.target.value)));
  const WEIGHTS: { key: keyof ProgramWeights; label: string }[] = [
    { key: 'hifz', label: 'الحفظ' }, { key: 'tajweed', label: 'التجويد' }, { key: 'review', label: 'المراجعة' }, { key: 'retention', label: 'التثبيت' },
  ];

  return (
    <form className="space-y-4 rounded-2xl border border-divider p-4" aria-label="إعدادات البرنامج"
      onSubmit={(e) => { e.preventDefault(); setNotice(''); if (sum === 100 && name.trim().length >= 2) save.mutate(); }}>
      <div className="grid sm:grid-cols-2 gap-3">
        <Input id="program-name" label="اسم البرنامج" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
        <label className="text-sm">
          <span className="block text-text-secondary mb-1">أيام الحفظ الجديد في الأسبوع</span>
          <select id="program-days" className={`${field} w-full`} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{toArabicDigits(n)} {n === 4 ? '(الافتراضي)' : ''}</option>)}
          </select>
          <span className="block text-xs text-text-secondary mt-1">{weekRhythm(days)}. الجمعة والسبت خارج البرنامج.</span>
        </label>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-text-primary mb-2">درجات التقييم في كل فترة (المجموع ١٠٠)</legend>
        <div className="flex flex-wrap items-end gap-3">
          {WEIGHTS.map(({ key, label }) => (
            <label key={key} className="text-sm">
              <span className="block text-text-secondary mb-1">{label}</span>
              <input type="number" min={0} max={100} className={`${field} w-20`} value={weights[key]} aria-label={`درجة ${label}`}
                onChange={num((n) => setWeights({ ...weights, [key]: n }))} />
            </label>
          ))}
          <p className={`text-sm pb-2 ${sum === 100 ? 'text-text-secondary' : 'text-red-800'}`} role={sum === 100 ? undefined : 'alert'}>
            المجموع {toArabicDigits(sum)}{sum !== 100 && ' — يجب أن يكون ١٠٠'}
          </p>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-text-secondary mb-1">مجموع الانتقال للفترة التالية</span>
          <input type="number" min={50} max={100} className={`${field} w-24`} value={pass} aria-label="مجموع الانتقال" onChange={num(setPass)} />
        </label>
        <label className="text-sm">
          <span className="block text-text-secondary mb-1">أقل نسبة لأي معيار (٪ من درجته)</span>
          <input type="number" min={0} max={100} className={`${field} w-24`} value={min} aria-label="أقل نسبة لأي معيار" onChange={num(setMin)} />
        </label>
        <Button type="submit" loading={save.isPending} disabled={sum !== 100 || pass < 50 || pass > 100 || min < 0 || min > 100 || name.trim().length < 2}>حفظ الإعدادات</Button>
        <Button type="button" variant="ghost" loading={archive.isPending} onClick={() => archive.mutate()}>{program.active ? 'أرشفة البرنامج' : 'إعادة التفعيل'}</Button>
        {!program.inUse && !program.hasResults && (
          <Button type="button" variant="ghost" loading={remove.isPending}
            onClick={() => { if (window.confirm(`حذف «${program.nameAr}» وفتراته؟ لا يمكن التراجع.`)) remove.mutate(); }}>
            <Trash2 className="w-4 h-4 ml-1" /> حذف
          </Button>
        )}
      </div>
      {notice && <p role="status" className="text-sm text-text-primary">{notice}</p>}
      {(save.isError || archive.isError || remove.isError) && (
        <p role="alert" className="text-sm text-red-800">{errorMessage(save.error ?? archive.error ?? remove.error, 'تعذّر الحفظ.')}</p>
      )}
    </form>
  );
}

function VersePicker({ label, sura, ayah, onChange }: { label: string; sura: number; ayah: number; onChange: (sura: number, ayah: number) => void }) {
  const count = AYAH_COUNTS[sura - 1];
  return (
    <div className="flex items-end gap-2">
      <label className="text-sm">
        <span className="block text-text-secondary mb-1">{label}: السورة</span>
        <select aria-label={`${label}: السورة`} className={`${field} min-w-[9rem]`} value={sura}
          onChange={(e) => { const n = Number(e.target.value); onChange(n, Math.min(ayah, AYAH_COUNTS[n - 1])); }}>
          {SURAH_NAMES.map((name, i) => <option key={name} value={i + 1}>{toArabicDigits(i + 1)}. {name}</option>)}
        </select>
      </label>
      <label className="text-sm">
        <span className="block text-text-secondary mb-1">الآية</span>
        <input type="number" min={1} max={count} aria-label={`${label}: الآية`} className={`${field} w-20`} value={ayah}
          onChange={(e) => onChange(sura, Math.floor(Number(e.target.value)))} />
      </label>
    </div>
  );
}

function Periods({ program, onChange }: { program: HifzProgram; onChange: () => void }) {
  const [drafts, setDrafts] = useState<Draft[]>(() => program.periods.map(toDraft));
  const [notice, setNotice] = useState('');
  const saved = useMemo(() => JSON.stringify(program.periods.map((p) => toInput(toDraft(p)))), [program.periods]);
  const dirty = JSON.stringify(drafts.map(toInput)) !== saved;
  const sizes = drafts.map((d) => sizeOf(d, program.hifzDaysPerWeek));
  const invalid = sizes.some((s) => s.error) || drafts.length === 0;
  const total = sizes.reduce((n, s) => n + s.weeks, 0);

  const save = useMutation({
    mutationFn: () => api.saveProgramPeriods(program.id, drafts.map(toInput)).then((r) => r.data),
    onSuccess: () => { setNotice('حُفظت الفترات وأُعيد حساب الجدول.'); onChange(); },
  });
  const edit = (key: string, patch: Partial<Draft>) => { setNotice(''); setDrafts((all) => all.map((d) => (d.key === key ? { ...d, ...patch } : d))); };
  const move = (i: number, by: -1 | 1) => setDrafts((all) => {
    const next = [...all];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    return next;
  });
  // Leaving with unsaved changes loses them; say so.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  return (
    <div className="space-y-3" aria-label="فترات البرنامج">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-heading font-semibold text-text-primary">الفترات ومقرّر الحفظ</h3>
        <p className="text-sm text-text-secondary">عدد الفترات: {toArabicDigits(drafts.length)} · المدة الكلية: {weeksText(total)}</p>
      </div>
      {drafts.length === 0 && <p className="text-sm text-text-secondary">لا فترات بعد. أضيفي أول فترة وحدّدي ما يُطلب حفظه فيها.</p>}
      <ol className="space-y-3" data-testid="program-periods">
        {drafts.map((d, i) => {
          const size = sizes[i];
          const odd = d.mode === 'hifz' && !size.error && (size.hifzWeeks < GOOD_WEEKS.min || size.hifzWeeks > GOOD_WEEKS.max);
          return (
            <li key={d.key} className="rounded-2xl border border-divider p-4 space-y-3" data-testid={`period-${i + 1}`}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="font-medium text-text-primary">الفترة {toArabicDigits(i + 1)}</p>
                <div className="flex items-center gap-1">
                  <button type="button" aria-label={`رفع الفترة ${i + 1}`} disabled={i === 0} onClick={() => move(i, -1)} className="p-1.5 rounded-lg border border-divider disabled:opacity-40"><ArrowUp className="w-4 h-4" /></button>
                  <button type="button" aria-label={`إنزال الفترة ${i + 1}`} disabled={i === drafts.length - 1} onClick={() => move(i, 1)} className="p-1.5 rounded-lg border border-divider disabled:opacity-40"><ArrowDown className="w-4 h-4" /></button>
                  <button type="button" aria-label={`حذف الفترة ${i + 1}`} onClick={() => setDrafts((all) => all.filter((x) => x.key !== d.key))} className="p-1.5 rounded-lg border border-divider text-red-800"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <Input id={`period-name-${i}`} label="اسم الفترة" value={d.nameAr} onChange={(e) => edit(d.key, { nameAr: e.target.value })} placeholder="مثال: التأسيس" />
                <Input id={`period-goal-${i}`} label="هدف الفترة (اختياري)" value={d.goalAr} maxLength={300} onChange={(e) => edit(d.key, { goalAr: e.target.value })} />
              </div>
              <div className="flex gap-4 text-sm" role="radiogroup" aria-label="نوع الفترة">
                <label className="flex items-center gap-1.5"><input type="radio" name={`mode-${d.key}`} checked={d.mode === 'hifz'} onChange={() => edit(d.key, { mode: 'hifz' })} /> حفظ جديد</label>
                <label className="flex items-center gap-1.5"><input type="radio" name={`mode-${d.key}`} checked={d.mode === 'consolidation'} onChange={() => edit(d.key, { mode: 'consolidation' })} /> تثبيت ومراجعة بلا حفظ جديد</label>
              </div>
              {d.mode === 'hifz' ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-4">
                    <VersePicker label="من" sura={d.sura1} ayah={d.ayah1} onChange={(sura1, ayah1) => edit(d.key, { sura1, ayah1 })} />
                    <VersePicker label="إلى" sura={d.sura2} ayah={d.ayah2} onChange={(sura2, ayah2) => edit(d.key, { sura2, ayah2 })} />
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <label className="text-sm">
                      <span className="block text-text-secondary mb-1">الوتيرة</span>
                      <select aria-label="الوتيرة" className={field} value={d.pagesPerDay} onChange={(e) => edit(d.key, { pagesPerDay: Number(e.target.value) })}>
                        {PACE_OPTIONS.map((p) => <option key={p} value={p}>{paceLabel(p)}</option>)}
                      </select>
                    </label>
                    <label className="text-sm">
                      <span className="block text-text-secondary mb-1">وقت إضافي للسور الطويلة أو المتشابهة</span>
                      <select aria-label="وقت إضافي" className={field} value={d.extraPct} onChange={(e) => edit(d.key, { extraPct: Number(e.target.value) })}>
                        {[0, 25, 50, 100].map((p) => <option key={p} value={p}>{p === 0 ? 'بلا إضافة' : `+${toArabicDigits(p)}٪`}</option>)}
                      </select>
                    </label>
                  </div>
                </div>
              ) : (
                <label className="text-sm inline-block">
                  <span className="block text-text-secondary mb-1">عدد الأسابيع</span>
                  <input type="number" min={1} max={12} aria-label="عدد الأسابيع" className={`${field} w-24`} value={d.fixedWeeks}
                    onChange={(e) => edit(d.key, { fixedWeeks: Math.floor(Number(e.target.value)) })} />
                </label>
              )}
              {size.error ? (
                <p role="alert" className="text-sm text-red-800">{size.error}</p>
              ) : (
                <p className="text-sm text-text-secondary" data-testid={`period-size-${i + 1}`}>
                  {d.mode === 'hifz'
                    ? <>نحو {toArabicDigits(size.pages)} صفحة ({toArabicDigits(size.ayat)} آية): حفظ {weeksText(size.hifzWeeks)} + أسبوع اختبار = <strong>{weeksText(size.weeks)}</strong></>
                    : <>{weeksText(size.weeks)}</>}
                  {odd && <span className="text-amber-800"> — {size.hifzWeeks < GOOD_WEEKS.min ? 'قصيرة: يصعب قياس التثبيت فيها.' : 'طويلة: يتراكم فيها النسيان. فكّري في تقسيمها.'}</span>}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={() => {
          const last = drafts.at(-1);
          setNotice('');
          setDrafts([...drafts, blank(last && last.mode === 'hifz' && last.sura2 > 1 ? { sura1: last.sura2 - 1, ayah1: 1, sura2: last.sura2 - 1, ayah2: AYAH_COUNTS[last.sura2 - 2], pagesPerDay: last.pagesPerDay } : {})]);
        }}><Plus className="w-4 h-4 ml-1" /> إضافة فترة</Button>
        <Button type="button" loading={save.isPending} disabled={!dirty || invalid} onClick={() => { setNotice(''); save.mutate(); }}>حفظ الفترات</Button>
        {dirty && <span className="text-sm text-amber-800">تغييرات غير محفوظة</span>}
      </div>
      {notice && <p role="status" className="text-sm text-text-primary">{notice}</p>}
      {save.isError && <p role="alert" className="text-sm text-red-800">{errorMessage(save.error, 'تعذّر حفظ الفترات.')}</p>}
    </div>
  );
}

/** The whole program at a glance: periods, verses, weeks, and how a period is passed. */
function Summary({ program }: { program: HifzProgram }) {
  if (program.periods.length === 0) return null;
  const msg = (w: HifzProgram['warnings'][number]) => {
    if (w.type === 'overlap') return `الفترتان ${toArabicDigits(w.a + 1)} و${toArabicDigits(w.b + 1)} يتداخل مقرّرهما.`;
    return `الفترة ${toArabicDigits(w.period + 1)}: مدة الحفظ ${weeksText(w.weeks)}، ${w.type === 'short' ? 'وهي قصيرة لقياس التثبيت' : 'وهي طويلة'}.`;
  };
  return (
    <div className="space-y-3" data-testid="program-summary">
      <h3 className="font-heading font-semibold text-text-primary">الملخص الشامل</h3>
      <div className="overflow-x-auto rounded-2xl border border-divider">
        <table className="w-full text-sm">
          <thead className="bg-surface-canvas text-text-secondary">
            <tr>
              <th className="text-right p-2.5">#</th><th className="text-right p-2.5">الفترة</th><th className="text-right p-2.5">مقرّر الحفظ</th>
              <th className="text-right p-2.5">الصفحات</th><th className="text-right p-2.5">الوتيرة</th><th className="text-right p-2.5">المدة</th><th className="text-right p-2.5">الأسابيع</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {program.periods.map((p, i) => (
              <tr key={p.id ?? i}>
                <td className="p-2.5">{toArabicDigits(i + 1)}</td>
                <td className="p-2.5 font-medium">{p.nameAr}{p.goalAr && <span className="block text-xs font-normal text-text-secondary">{p.goalAr}</span>}</td>
                <td className="p-2.5">{p.startRef && p.endRef ? formatAyahRange(p.startRef, p.endRef) : <Badge variant="neutral" size="sm">تثبيت</Badge>}</td>
                <td className="p-2.5">{p.kind === 'hifz' ? toArabicDigits(p.pages) : '—'}</td>
                <td className="p-2.5">{p.kind === 'hifz' ? paceLabel(p.pagesPerDay) : '—'}</td>
                <td className="p-2.5">{weeksText(p.weeks)}{p.kind === 'hifz' && <span className="block text-xs text-text-secondary">منها {weeksText(p.hifzWeeks)} حفظ</span>}</td>
                <td className="p-2.5 whitespace-nowrap">{weeksSpan(p.startWeek, p.weeks)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-surface-canvas font-medium">
            <tr><td className="p-2.5" colSpan={3}>الإجمالي</td><td className="p-2.5">{toArabicDigits(program.totals.pages)}</td><td className="p-2.5" /><td className="p-2.5" colSpan={2}>{weeksText(program.totals.weeks)}</td></tr>
          </tfoot>
        </table>
      </div>
      <p className="text-sm text-text-secondary">
        الانتقال إلى الفترة التالية: مجموع {toArabicDigits(program.passScore)} فأكثر من ١٠٠، ولا يقل أي معيار عن {toArabicDigits(program.minCriterionPct)}٪ من درجته
        (الحفظ {toArabicDigits(program.weights.hifz)}، التجويد {toArabicDigits(program.weights.tajweed)}، المراجعة {toArabicDigits(program.weights.review)}، التثبيت {toArabicDigits(program.weights.retention)}).
      </p>
      {program.warnings.length > 0 && (
        <ul className="text-sm text-amber-900 bg-amber-50 rounded-xl px-3 py-2 space-y-1" data-testid="program-warnings">
          {program.warnings.map((w, i) => <li key={i}>{msg(w)}</li>)}
        </ul>
      )}
    </div>
  );
}

/** Which halaqa follows which program, and from which week. */
function Assignment({ program, halaqat, programs, today, onChange }: {
  program: HifzProgram; halaqat: AdminPrograms['halaqat']; programs: HifzProgram[]; today: string; onChange: () => void;
}) {
  const [edits, setEdits] = useState<Record<string, { programId: string; date: string }>>({});
  const [notice, setNotice] = useState('');
  const save = useMutation({
    mutationFn: (v: { id: string; programId: string; date: string }) => api.assignProgram(v.id, v.programId || null, v.programId ? v.date : undefined),
    onSuccess: (_r, v) => {
      setEdits(({ [v.id]: _gone, ...rest }) => rest);
      setNotice(v.programId ? 'حُفظ إسناد البرنامج. تظهر الفترة الحالية لمعلمة الحلقة وطالباتها.' : 'لم تعد الحلقة تتبع برنامجاً.');
      onChange();
    },
  });
  if (halaqat.length === 0) return null;
  const usable = programs.filter((p) => p.active && p.periods.length > 0);

  return (
    <div className="space-y-3" data-testid="program-assign">
      <h3 className="font-heading font-semibold text-text-primary">الحلقات التي تتبع البرنامج</h3>
      <ul className="divide-y divide-divider text-sm">
        {halaqat.map((h) => {
          const e = edits[h.id] ?? { programId: h.programId ?? '', date: h.weekStart ?? today };
          const changed = (h.programId ?? '') !== e.programId || (e.programId !== '' && (h.weekStart ?? '') !== e.date);
          const current = programs.find((p) => p.id === h.programId);
          return (
            <li key={h.id} className="py-2.5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium text-text-primary">{h.nameAr}</p>
                <p className="text-xs text-text-secondary">{current ? `تتبع «${current.nameAr}» منذ ${programDay(h.weekStart!)}` : 'لا تتبع برنامجاً'}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select aria-label={`برنامج ${h.nameAr}`} className={field} value={e.programId} onChange={(ev) => setEdits({ ...edits, [h.id]: { ...e, programId: ev.target.value } })}>
                  <option value="">بلا برنامج</option>
                  {usable.map((p) => <option key={p.id} value={p.id}>{p.nameAr}</option>)}
                  {current && !usable.includes(current) && <option value={current.id}>{current.nameAr}</option>}
                </select>
                {e.programId && (
                  <label className="flex items-center gap-1.5 text-text-secondary">بدءاً من
                    <input type="date" aria-label={`بداية ${h.nameAr}`} className={field} value={e.date} onChange={(ev) => setEdits({ ...edits, [h.id]: { ...e, date: ev.target.value } })} />
                  </label>
                )}
                <Button size="sm" disabled={!changed || (e.programId !== '' && !e.date)} loading={save.isPending && save.variables?.id === h.id}
                  onClick={() => { setNotice(''); save.mutate({ id: h.id, programId: e.programId, date: e.date }); }}>حفظ</Button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-text-secondary">يبدأ الأسبوع الأول يوم الأحد من الأسبوع الذي تختارينه. غيّري البداية متى شئتِ، فتُعاد الفترة الحالية من التاريخ الجديد.</p>
      {program.periods.length === 0 && <p className="text-xs text-amber-800">أضيفي فترة واحدة على الأقل قبل إسناد هذا البرنامج إلى حلقة.</p>}
      {notice && <p role="status" className="text-sm text-text-primary">{notice}</p>}
      {save.isError && <p role="alert" className="text-sm text-red-800">{errorMessage(save.error, 'تعذّر الحفظ.')}</p>}
    </div>
  );
}

/** How the students are doing in each period: those who passed it, those repeating it, and the attempts that did not pass. */
function Results({ program }: { program: HifzProgram }) {
  const results = useQuery({ queryKey: queryKeys.programResults(program.id), queryFn: () => api.getProgramResults(program.id).then((r) => r.data) });
  if (!results.data || results.data.students === 0) return null;
  return (
    <div className="space-y-3" data-testid="program-results">
      <h3 className="font-heading font-semibold text-text-primary">نتائج اختبارات الفترات</h3>
      <div className="overflow-x-auto rounded-2xl border border-divider">
        <table className="w-full text-sm">
          <thead className="bg-surface-canvas text-text-secondary">
            <tr><th className="text-right p-2.5">الفترة</th><th className="text-right p-2.5">اجتازتها</th><th className="text-right p-2.5">تعيدها الآن</th><th className="text-right p-2.5">محاولات لم تنجح</th></tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {results.data.periods.map((p) => (
              <tr key={p.index}>
                <td className="p-2.5 font-medium">{p.nameAr}</td><td className="p-2.5">{toArabicDigits(p.passed)}</td>
                <td className="p-2.5">{toArabicDigits(p.repeating)}</td><td className="p-2.5">{toArabicDigits(p.failedAttempts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-text-secondary">من اختُبرت من طالبات الحلقات التي تتبع هذا البرنامج: {toArabicDigits(results.data.students)}. إن عدّلتِ فترات برنامج بدأ اختباره فتغيّر ترتيبها، فراجعي النتائج: تُربط بموضع الفترة في البرنامج.</p>
    </div>
  );
}
