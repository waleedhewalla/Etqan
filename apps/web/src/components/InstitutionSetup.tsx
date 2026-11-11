'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from '@itqan/ui';
import { Copy, GraduationCap, UserPlus, UsersRound } from 'lucide-react';
import { api, errorMessage, queryKeys, type SetupHalaqa, type SetupStaff } from '@/lib/api';
import { toArabicDigits } from '@/lib/quran';
import { LoadError, Spinner } from '@/components/LoadState';

const field = 'rounded-xl border border-divider bg-surface-elevated px-3 py-2 text-sm';
const INVITATION: Record<string, string> = {
  sent: 'أُرسلت لها رسالة بطريقة الدخول.',
  skipped: 'البريد غير مُعدّ على الخادم، فأخبريها أن تدخل من «دخول هيئة التدريس» ببريدها.',
  failed: 'أُضيفت، لكن تعذّر إرسال الرسالة. أخبريها أن تدخل من «دخول هيئة التدريس» ببريدها.',
};

/** Where a dean staffs her institution: adds teachers, opens halaqat for them and hands out join codes. */
export function InstitutionSetup() {
  const queryClient = useQueryClient();
  const setup = useQuery({ queryKey: queryKeys.adminSetup, queryFn: () => api.getSetup().then((r) => r.data) });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.adminSetup });
    queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] });
  };

  if (setup.isLoading) return <Spinner />;
  if (setup.isError || !setup.data) return <LoadError onRetry={() => setup.refetch()} />;
  const { staff, halaqat } = setup.data;
  const teachers = staff.filter((s) => s.active);

  return (
    <section className="grid grid-cols-1 lg:grid-cols-2 gap-6" aria-label="إعداد المؤسسة">
      <Teachers staff={staff} onChange={refresh} />
      <Halaqat halaqat={halaqat} teachers={teachers} onChange={refresh} />
    </section>
  );
}

function Teachers({ staff, onChange }: { staff: SetupStaff[]; onChange: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState('');
  const add = useMutation({
    mutationFn: () => api.addStaff({ displayNameAr: name.trim(), email: email.trim() }).then((r) => r.data),
    onSuccess: (made) => { setName(''); setEmail(''); setNotice(`أُضيفت ${made.displayNameAr}. ${INVITATION[made.invitation]}`); onChange(); },
  });
  const toggle = useMutation({
    mutationFn: (s: SetupStaff) => api.editStaff(s.id, { active: !s.active }).then((r) => r.data),
    onSuccess: (s) => { add.reset(); setNotice(s.active ? `أُعيد دخول ${s.displayNameAr}.` : `أُوقف دخول ${s.displayNameAr}.`); onChange(); },
  });
  const confirmToggle = (s: SetupStaff) => {
    if (s.active && !window.confirm(`إيقاف دخول ${s.displayNameAr}؟ ${s.halaqat ? 'حلقاتها تبقى باسمها حتى تُسندي كلاً منها إلى معلمة أخرى.' : ''}`)) return;
    toggle.mutate(s);
  };

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><GraduationCap className="w-5 h-5 text-brand-primary" />المعلمات</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <ul id="setup-staff" className="divide-y divide-divider text-sm">
          {staff.map((s) => (
            <li key={s.id} className="py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-text-primary truncate">{s.displayNameAr}{s.role === 'dean' && <span className="text-text-secondary font-normal"> — عميدة</span>}</p>
                <p dir="ltr" className="text-xs text-text-secondary truncate text-right">{s.email ?? '—'}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-text-secondary">{s.halaqat === 0 ? 'بلا حلقة' : `${toArabicDigits(s.halaqat)} حلقة`}</span>
                {!s.active && <Badge variant="red" size="sm">موقوفة</Badge>}
                {s.role !== 'dean' && (
                  <Button size="sm" variant="ghost" disabled={toggle.isPending} onClick={() => confirmToggle(s)}>
                    {s.active ? 'إيقاف الدخول' : 'إعادة الدخول'}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        <form className="grid sm:grid-cols-[1fr_1fr_auto] gap-2 items-end border-t border-divider pt-4"
          onSubmit={(e) => { e.preventDefault(); setNotice(''); add.mutate(); }}>
          <Input id="staff-name" label="اسم المعلمة" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
          <Input id="staff-email" label="بريدها الإلكتروني" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Button type="submit" loading={add.isPending}><UserPlus className="w-4 h-4 ml-1" /> إضافة</Button>
        </form>
        <p className="text-xs text-text-secondary">تدخل المعلمة برابط يصل إلى بريدها، بلا كلمة سر.</p>
        {notice && <p role="status" className="text-sm text-text-primary">{notice}</p>}
        {(add.isError || toggle.isError) && (
          <p role="alert" className="text-sm text-red-800">
            {errorMessage(add.error ?? toggle.error, 'تعذّر الحفظ. قد يكون البريد مسجّلاً من قبل.')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Halaqat({ halaqat, teachers, onChange }: { halaqat: SetupHalaqa[]; teachers: SetupStaff[]; onChange: () => void }) {
  const [name, setName] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [notice, setNotice] = useState('');
  const chosen = teacherId || teachers[0]?.id || '';
  const add = useMutation({
    mutationFn: () => api.addHalaqa({ nameAr: name.trim(), teacherId: chosen }).then((r) => r.data),
    onSuccess: (h) => { setName(''); setNotice(`فُتحت «${h.nameAr}». رمز الانضمام: ${h.joinCode}`); onChange(); },
  });
  const reassign = useMutation({
    mutationFn: ({ id, to }: { id: string; to: string }) => api.editHalaqa(id, { teacherId: to }).then((r) => r.data),
    onSuccess: (h) => { add.reset(); setNotice(`أُسندت «${h.nameAr}» إلى ${h.teacherName}.`); onChange(); },
  });
  const copy = async (code: string) => {
    try { await navigator.clipboard.writeText(code); setNotice(`نُسخ الرمز ${code}.`); } catch { setNotice(`الرمز: ${code}`); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><UsersRound className="w-5 h-5 text-brand-primary" />الحلقات</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {halaqat.length === 0 ? (
          <p className="text-sm text-text-secondary">لا توجد حلقات بعد. أضيفي معلمة ثم افتحي لها حلقة، وأعطي طالباتها رمز الانضمام.</p>
        ) : (
          <ul id="setup-halaqat" className="divide-y divide-divider text-sm">
            {halaqat.map((h) => (
              <li key={h.id} className="py-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <div className="min-w-0">
                  <p className="font-medium text-text-primary truncate">{h.nameAr}</p>
                  <p className="text-xs text-text-secondary">{toArabicDigits(h.students)} من {toArabicDigits(h.maxStudents)} طالبة</p>
                </div>
                <div className="flex items-center gap-2">
                  <select aria-label={`معلمة ${h.nameAr}`} className={field} disabled={reassign.isPending}
                    value={h.teacherId ?? ''} onChange={(e) => reassign.mutate({ id: h.id, to: e.target.value })}>
                    {!teachers.some((t) => t.id === h.teacherId) && <option value={h.teacherId ?? ''}>{h.teacherName ?? 'بلا معلمة'} (موقوفة)</option>}
                    {teachers.map((t) => <option key={t.id} value={t.id}>{t.displayNameAr}</option>)}
                  </select>
                  <button type="button" onClick={() => copy(h.joinCode)} title="نسخ رمز الانضمام"
                    className="flex items-center gap-1.5 rounded-xl border border-divider px-3 py-2 font-mono tracking-wider hover:border-brand-primary/40">
                    <span dir="ltr">{h.joinCode}</span><Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <form className="grid sm:grid-cols-[1fr_1fr_auto] gap-2 items-end border-t border-divider pt-4"
          onSubmit={(e) => { e.preventDefault(); setNotice(''); if (chosen) add.mutate(); }}>
          <Input id="halaqa-name" label="اسم الحلقة" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
          <label className="text-sm">
            <span className="block text-text-secondary mb-1">المعلمة</span>
            <select id="halaqa-teacher" className={`${field} w-full`} value={chosen} onChange={(e) => setTeacherId(e.target.value)}>
              {teachers.map((t) => <option key={t.id} value={t.id}>{t.displayNameAr}</option>)}
            </select>
          </label>
          <Button type="submit" loading={add.isPending} disabled={!chosen}>فتح حلقة</Button>
        </form>
        {notice && <p role="status" className="text-sm text-text-primary">{notice}</p>}
        {(add.isError || reassign.isError) && (
          <p role="alert" className="text-sm text-red-800">{errorMessage(add.error ?? reassign.error, 'تعذّر الحفظ. حاولي مرة أخرى.')}</p>
        )}
      </CardContent>
    </Card>
  );
}
