'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@itqan/ui';
import { ChevronDown, ChevronUp, Upload, UserPlus, UsersRound } from 'lucide-react';
import {
  api, errorMessage, normalizePhone, queryKeys, type BulkStatus, type DirectoryUser, type NewUser, type SetupHalaqa,
} from '@/lib/api';
import { CREATABLE, ROLE_LABEL, isStaffRole } from '@/lib/admin-labels';
import { toArabicDigits } from '@/lib/quran';
import { useAuth } from '@/lib/auth-context';
import { LoadError, Spinner } from '@/components/LoadState';

const field = 'rounded-xl border border-divider bg-surface-elevated px-3 py-2 text-sm';
const INVITATION = {
  sent: 'أُرسلت إليها رسالة بطريقة الدخول.',
  skipped: 'البريد غير مُعدّ على الخادم، فأخبريها أن تدخل من «دخول هيئة التدريس» ببريدها.',
  failed: 'أُضيف الحساب، لكن تعذّر إرسال الرسالة. أخبريها أن تدخل من «دخول هيئة التدريس» ببريدها.',
} as const;
const BULK_STATUS: Record<BulkStatus, { label: string; tone: 'green' | 'neutral' | 'red' | 'gold' }> = {
  created: { label: 'أُضيفت', tone: 'green' },
  enrolled: { label: 'أُدخلت الحلقة', tone: 'green' },
  exists: { label: 'موجودة مسبقاً', tone: 'neutral' },
  invalid: { label: 'بيانات غير صالحة', tone: 'red' },
  full: { label: 'الحلقة ممتلئة', tone: 'gold' },
  plan_limit: { label: 'بلغت المؤسسة حدّ الترخيص', tone: 'gold' },
};
const FILTER_ROLES = ['student', 'mahram', 'lecturer', 'muhaffiza', 'sheikh_reviewer', 'advisor', 'dean'] as const;

/** The institution's people: find anyone, add students, guardians and staff, correct them, stop them, and place students in halaqat. */
export function UsersAdmin() {
  const queryClient = useQueryClient();
  const [role, setRole] = useState('');
  const [active, setActive] = useState<'all' | 'true' | 'false'>('all');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => { setQ(search.trim()); setOffset(0); }, 300); return () => clearTimeout(t); }, [search]);

  const filter = { role: role || undefined, q: q || undefined, active, offset };
  const directory = useQuery({ queryKey: queryKeys.adminUsers(filter), queryFn: () => api.getUsers(filter).then((r) => r.data), placeholderData: (prev) => prev });
  const setup = useQuery({ queryKey: queryKeys.adminSetup, queryFn: () => api.getSetup().then((r) => r.data) });
  const halaqat = (setup.data?.halaqat ?? []).filter((h) => h.active);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin'] });
    queryClient.invalidateQueries({ queryKey: ['sections'] });
  };

  const data = directory.data;
  const counts = data?.counts ?? {};
  const everyone = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <section className="space-y-6" aria-label="المستخدمون" data-testid="users-admin">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UsersRound className="w-5 h-5 text-brand-primary" />المستخدمون</CardTitle>
          <CardDescription>كل من في المؤسسة: طالبات وأولياء أمور ومعلمات. ابحثي، وعدّلي البيانات، وأوقفي حساباً أو أعيديه، وأدخلي الطالبة حلقتها.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm grow min-w-[12rem]">
              <span className="block text-text-secondary mb-1">بحث بالاسم أو الرقم أو البريد</span>
              <input className={`${field} w-full`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="اكتبي للبحث" aria-label="بحث" />
            </label>
            <label className="text-sm">
              <span className="block text-text-secondary mb-1">النوع</span>
              <select className={field} value={role} aria-label="النوع" onChange={(e) => { setRole(e.target.value); setOffset(0); }}>
                <option value="">الكل ({toArabicDigits(everyone)})</option>
                {FILTER_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]} ({toArabicDigits(counts[r] ?? 0)})</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-text-secondary mb-1">الحالة</span>
              <select className={field} value={active} aria-label="الحالة" onChange={(e) => { setActive(e.target.value as typeof active); setOffset(0); }}>
                <option value="all">الكل</option><option value="true">نشطة</option><option value="false">موقوفة</option>
              </select>
            </label>
          </div>

          {directory.isLoading ? <Spinner /> : directory.isError || !data ? <LoadError onRetry={() => directory.refetch()} /> : data.users.length === 0 ? (
            <p className="text-sm text-text-secondary">لا نتائج. غيّري البحث أو الفلتر.</p>
          ) : (
            <>
              <ul className="divide-y divide-divider" data-testid="user-list">
                {data.users.map((u) => (
                  <UserRow key={u.id} user={u} halaqat={halaqat} open={open === u.id} onToggle={() => setOpen(open === u.id ? null : u.id)} onChange={refresh} />
                ))}
              </ul>
              <div className="flex items-center justify-between gap-3 text-sm text-text-secondary">
                <span>{toArabicDigits(offset + 1)}–{toArabicDigits(offset + data.users.length)} من {toArabicDigits(data.total)}</span>
                <span className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - data.pageSize))}>السابق</Button>
                  <Button size="sm" variant="outline" disabled={offset + data.pageSize >= data.total} onClick={() => setOffset(offset + data.pageSize)}>التالي</Button>
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AddUser halaqat={halaqat} onChange={refresh} />
        <BulkStudents halaqat={halaqat} onChange={refresh} />
      </div>
    </section>
  );
}

function UserRow({ user: u, halaqat, open, onToggle, onChange }: { user: DirectoryUser; halaqat: SetupHalaqa[]; open: boolean; onToggle: () => void; onChange: () => void }) {
  const { user: me } = useAuth();
  const staff = isStaffRole(u.role);
  const contact = staff ? u.email : u.whatsappE164;
  const attached = u.role === 'student' ? u.halaqat.map((h) => h.nameAr)
    : u.role === 'mahram' ? u.children.map((c) => c.displayNameAr) : u.halaqat.map((h) => h.nameAr);
  const attachedLabel = u.role === 'student' ? 'الحلقة' : u.role === 'mahram' ? 'أولياء أمر' : 'تقود';

  return (
    <li className={`py-3 space-y-3 ${u.active ? '' : 'opacity-70'}`} data-testid={`user-${u.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-text-primary flex items-center gap-2 flex-wrap">
            {u.displayNameAr}
            <Badge variant={u.role === 'student' ? 'green' : u.role === 'mahram' ? 'neutral' : 'gold'} size="sm">{ROLE_LABEL[u.role]}</Badge>
            {!u.active && <Badge variant="red" size="sm">موقوفة</Badge>}
          </p>
          <p className="text-xs text-text-secondary">
            <span dir="ltr">{contact ?? '—'}</span>
            {attached.length > 0 && <> · {attachedLabel}: {attached.join('، ')}</>}
            {u.role === 'student' && u.guardians.length > 0 && <> · ولي الأمر: {u.guardians.map((g) => g.displayNameAr).join('، ')}</>}
          </p>
        </div>
        <Button size="sm" variant="outline" aria-expanded={open} onClick={onToggle}>
          {open ? <ChevronUp className="w-4 h-4 ml-1" /> : <ChevronDown className="w-4 h-4 ml-1" />} إدارة
        </Button>
      </div>
      {open && <UserPanel user={u} halaqat={halaqat} isMe={me?.id === u.id} onChange={onChange} />}
    </li>
  );
}

function UserPanel({ user: u, halaqat, isMe, onChange }: { user: DirectoryUser; halaqat: SetupHalaqa[]; isMe: boolean; onChange: () => void }) {
  const staff = isStaffRole(u.role);
  const [name, setName] = useState(u.displayNameAr);
  const [contact, setContact] = useState(staff ? u.email ?? '' : u.whatsappE164 ?? '');
  const [notice, setNotice] = useState('');
  const [guardian, setGuardian] = useState({ name: '', number: '' });
  const [section, setSection] = useState('');
  const done = (message: string) => () => { setNotice(message); onChange(); };

  const save = useMutation({
    mutationFn: () => api.editUser(u.id, { displayNameAr: name.trim(), ...(staff ? { email: contact.trim() } : { whatsapp: normalizePhone(contact) }) }).then((r) => r.data),
    onSuccess: done('حُفظت البيانات.'),
  });
  const toggle = useMutation({
    mutationFn: () => api.editUser(u.id, { active: !u.active }).then((r) => r.data),
    onSuccess: done(u.active ? 'أُوقف الحساب: لم يعد صاحبه يدخل.' : 'أُعيد تفعيل الحساب.'),
  });
  const join = useMutation({ mutationFn: (id: string) => api.addUserToHalaqa(u.id, id).then((r) => r.data), onSuccess: () => { setSection(''); done('أُضيفت الطالبة إلى الحلقة.')(); } });
  const leave = useMutation({ mutationFn: (id: string) => api.removeUserFromHalaqa(u.id, id).then((r) => r.data), onSuccess: done('أُخرجت الطالبة من الحلقة. يبقى سجلّها.') });
  const link = useMutation({
    mutationFn: () => api.linkUserGuardian(u.id, { displayNameAr: guardian.name.trim(), whatsapp: normalizePhone(guardian.number) }).then((r) => r.data),
    onSuccess: () => { setGuardian({ name: '', number: '' }); done('رُبط ولي الأمر.')(); },
  });
  const unlink = useMutation({ mutationFn: (id: string) => api.unlinkUserGuardian(u.id, id).then((r) => r.data), onSuccess: done('فُكّ الربط. يبقى حساب ولي الأمر.') });
  const error = save.error ?? toggle.error ?? join.error ?? leave.error ?? link.error ?? unlink.error;
  const free = halaqat.filter((h) => !u.halaqat.some((x) => x.id === h.id));

  return (
    <div className="rounded-2xl bg-surface-canvas p-4 space-y-4">
      <form className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end" onSubmit={(e) => { e.preventDefault(); setNotice(''); save.mutate(); }}>
        <Input id={`name-${u.id}`} label="الاسم" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
        <Input id={`contact-${u.id}`} label={staff ? 'البريد الإلكتروني' : 'رقم واتساب'} type={staff ? 'email' : 'tel'} dir="ltr" value={contact} onChange={(e) => setContact(e.target.value)} required />
        <Button type="submit" loading={save.isPending}>حفظ</Button>
      </form>

      {u.role === 'student' && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-text-primary">الحلقات</p>
          <ul className="flex flex-wrap gap-2">
            {u.halaqat.length === 0 && <li className="text-sm text-text-secondary">ليست في حلقة.</li>}
            {u.halaqat.map((h) => (
              <li key={h.id} className="flex items-center gap-1.5 rounded-full border border-divider bg-surface-elevated px-3 py-1 text-sm">
                {h.nameAr}
                <button type="button" aria-label={`إخراج من ${h.nameAr}`} className="text-red-800" disabled={leave.isPending}
                  onClick={() => { if (window.confirm(`إخراج ${u.displayNameAr} من «${h.nameAr}»؟ يبقى وردها وسجلّها.`)) { setNotice(''); leave.mutate(h.id); } }}>×</button>
              </li>
            ))}
          </ul>
          {u.active && free.length > 0 && (
            <div className="flex items-center gap-2">
              <select aria-label="حلقة للإضافة" className={field} value={section} onChange={(e) => setSection(e.target.value)}>
                <option value="">اختاري حلقة…</option>
                {free.map((h) => <option key={h.id} value={h.id}>{h.nameAr} ({toArabicDigits(h.students)}/{toArabicDigits(h.maxStudents)})</option>)}
              </select>
              <Button size="sm" disabled={!section} loading={join.isPending} onClick={() => { setNotice(''); join.mutate(section); }}>إضافة إلى الحلقة</Button>
            </div>
          )}

          <p className="text-sm font-medium text-text-primary pt-2">أولياء الأمور</p>
          <ul className="space-y-1">
            {u.guardians.length === 0 && <li className="text-sm text-text-secondary">لا ولي أمر مرتبط.</li>}
            {u.guardians.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{g.displayNameAr} <span dir="ltr" className="text-xs text-text-secondary">{g.whatsappE164}</span></span>
                <button type="button" className="text-xs text-red-800 underline" disabled={unlink.isPending}
                  onClick={() => { if (window.confirm(`فكّ ربط ${g.displayNameAr}؟`)) { setNotice(''); unlink.mutate(g.id); } }}>فك الربط</button>
              </li>
            ))}
          </ul>
          <form className="grid sm:grid-cols-[1fr_1fr_auto] gap-2 items-end" onSubmit={(e) => { e.preventDefault(); setNotice(''); link.mutate(); }}>
            <Input id={`g-name-${u.id}`} label="اسم ولي الأمر" value={guardian.name} onChange={(e) => setGuardian({ ...guardian, name: e.target.value })} required minLength={2} />
            <Input id={`g-number-${u.id}`} label="رقم واتساب" type="tel" dir="ltr" value={guardian.number} onChange={(e) => setGuardian({ ...guardian, number: e.target.value })} required />
            <Button type="submit" size="sm" loading={link.isPending}>ربط</Button>
          </form>
        </div>
      )}
      {u.role === 'mahram' && u.children.length > 0 && <p className="text-sm text-text-secondary">أولياء أمر: {u.children.map((c) => c.displayNameAr).join('، ')}</p>}

      <div className="flex flex-wrap items-center gap-3 border-t border-divider pt-3">
        {isMe ? (
          <p className="text-xs text-text-secondary">هذا حسابكِ: لا يمكنكِ إيقاف دخولكِ.</p>
        ) : (
          <Button size="sm" variant={u.active ? 'outline' : 'primary'} loading={toggle.isPending}
            onClick={() => { if (!u.active || window.confirm(`إيقاف حساب ${u.displayNameAr}؟ لن تستطيع الدخول حتى تُعيدي تفعيله. لا يُحذف شيء من سجلها.`)) { setNotice(''); toggle.mutate(); } }}>
            {u.active ? 'إيقاف الحساب' : 'إعادة تفعيل الحساب'}
          </Button>
        )}
      </div>
      {notice && <p role="status" className="text-sm text-text-primary">{notice}</p>}
      {error && <p role="alert" className="text-sm text-red-800">{errorMessage(error, 'تعذّر الحفظ. حاولي مرة أخرى.')}</p>}
    </div>
  );
}

function AddUser({ halaqat, onChange }: { halaqat: SetupHalaqa[]; onChange: () => void }) {
  const { user: me } = useAuth();
  const roles = CREATABLE.filter((r) => !r.operatorOnly || me?.role === 'operator' || me?.role === 'superadmin');
  const [role, setRole] = useState<NewUser['role']>('student');
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [section, setSection] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [guardianNumber, setGuardianNumber] = useState('');
  const [notice, setNotice] = useState('');
  const staff = isStaffRole(role);

  const add = useMutation({
    mutationFn: () => {
      const displayNameAr = name.trim();
      const body: NewUser = staff
        ? { role: role as Extract<NewUser, { email: string }>['role'], displayNameAr, email: contact.trim() }
        : role === 'student'
          ? {
            role, displayNameAr, whatsapp: normalizePhone(contact), ...(section ? { sectionId: section } : {}),
            ...(guardianNumber.trim() ? { guardian: { displayNameAr: guardianName.trim(), whatsapp: normalizePhone(guardianNumber) } } : {}),
          }
          : { role: 'mahram', displayNameAr, whatsapp: normalizePhone(contact) };
      return api.createUser(body).then((r) => r.data);
    },
    onSuccess: (made) => {
      setName(''); setContact(''); setGuardianName(''); setGuardianNumber('');
      setNotice(`أُضيف ${made.displayNameAr} (${ROLE_LABEL[made.role]}). ${made.invitation ? INVITATION[made.invitation] : 'تدخل برقم واتساب هذا: يصلها رمز دخول.'}`);
      onChange();
    },
  });

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><UserPlus className="w-5 h-5 text-brand-primary" />إضافة مستخدم</CardTitle></CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setNotice(''); add.mutate(); }}>
          <label className="text-sm block">
            <span className="block text-text-secondary mb-1">النوع</span>
            <select id="new-user-role" className={`${field} w-full`} value={role} onChange={(e) => { setRole(e.target.value as NewUser['role']); setContact(''); setNotice(''); }}>
              {roles.map((r) => <option key={r.role} value={r.role}>{ROLE_LABEL[r.role]}</option>)}
            </select>
          </label>
          <Input id="new-user-name" label="الاسم" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
          <Input id="new-user-contact" label={staff ? 'البريد الإلكتروني' : 'رقم واتساب (يدخل به)'} type={staff ? 'email' : 'tel'} dir="ltr" value={contact}
            onChange={(e) => setContact(e.target.value)} placeholder={staff ? 'name@example.com' : '010 1234 5678'} required />
          {role === 'student' && (
            <>
              <label className="text-sm block">
                <span className="block text-text-secondary mb-1">الحلقة (اختياري)</span>
                <select id="new-user-section" className={`${field} w-full`} value={section} onChange={(e) => setSection(e.target.value)}>
                  <option value="">بلا حلقة الآن</option>
                  {halaqat.map((h) => <option key={h.id} value={h.id}>{h.nameAr} ({toArabicDigits(h.students)}/{toArabicDigits(h.maxStudents)})</option>)}
                </select>
              </label>
              <fieldset className="grid sm:grid-cols-2 gap-3">
                <legend className="text-sm text-text-secondary mb-1">ولي الأمر (اختياري)</legend>
                <Input id="new-guardian-name" label="الاسم" value={guardianName} onChange={(e) => setGuardianName(e.target.value)} required={Boolean(guardianNumber)} />
                <Input id="new-guardian-number" label="رقم واتساب" type="tel" dir="ltr" value={guardianNumber} onChange={(e) => setGuardianNumber(e.target.value)} />
              </fieldset>
            </>
          )}
          <Button type="submit" loading={add.isPending}>إضافة</Button>
          {notice && <p role="status" className="text-sm text-text-primary" data-testid="add-user-notice">{notice}</p>}
          {add.isError && <p role="alert" className="text-sm text-red-800">{errorMessage(add.error, 'تعذّرت الإضافة. تحققي من البيانات.')}</p>}
        </form>
        <p className="text-xs text-text-secondary mt-3">
          الطالبة وولي الأمر يدخلان برمز يصل إلى واتساب، والمعلمة والمرشدة والعميدة برابط يصل إلى بريدها. أرقام الهواتف تُكتب كما تعرفينها: ٠١٠… تُحوَّل تلقائياً.
        </p>
      </CardContent>
    </Card>
  );
}

/** One student a line, «الاسم، الرقم»: the way a class list is usually kept. */
function BulkStudents({ halaqat, onChange }: { halaqat: SetupHalaqa[]; onChange: () => void }) {
  const [text, setText] = useState('');
  const [section, setSection] = useState('');
  const rows = text.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const parts = line.split(/[,،;\t]/).map((p) => p.trim());
    return { displayNameAr: parts[0] ?? '', whatsapp: parts[1] ? normalizePhone(parts[1]) : '' };
  });
  const run = useMutation({
    mutationFn: () => api.addStudentsInBulk(rows, section || undefined).then((r) => r.data),
    onSuccess: (r) => { if (r.failed === 0) setText(''); onChange(); },
  });
  const result = run.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Upload className="w-5 h-5 text-brand-primary" />إضافة طالبات دفعة واحدة</CardTitle>
        <CardDescription>الصقي قائمة الصف: سطر لكل طالبة، «الاسم، رقم الواتساب». حتى {toArabicDigits(100)} طالبة في المرة.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <textarea id="bulk-text" rows={6} dir="auto" className={`${field} w-full font-mono`} value={text} onChange={(e) => { setText(e.target.value); run.reset(); }}
          placeholder={'منى أحمد، 010 1234 5678\nهدى علي، 011 2345 6789'} aria-label="قائمة الطالبات" />
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block text-text-secondary mb-1">الحلقة (اختياري)</span>
            <select className={field} value={section} aria-label="حلقة الدفعة" onChange={(e) => setSection(e.target.value)}>
              <option value="">بلا حلقة الآن</option>
              {halaqat.map((h) => <option key={h.id} value={h.id}>{h.nameAr} ({toArabicDigits(h.students)}/{toArabicDigits(h.maxStudents)})</option>)}
            </select>
          </label>
          <Button loading={run.isPending} disabled={rows.length === 0 || rows.length > 100} onClick={() => run.mutate()}>
            إضافة {rows.length > 0 && `${toArabicDigits(rows.length)} طالبة`}
          </Button>
        </div>
        {rows.length > 100 && <p role="alert" className="text-sm text-red-800">الحد الأقصى ١٠٠ طالبة في المرة.</p>}
        {run.isError && <p role="alert" className="text-sm text-red-800">{errorMessage(run.error, 'تعذّرت الإضافة.')}</p>}
        {result && (
          <div className="space-y-2" data-testid="bulk-result">
            <p role="status" className="text-sm text-text-primary">
              أُضيفت {toArabicDigits(result.created)} · أُدخلت الحلقة {toArabicDigits(result.enrolled)} · موجودة مسبقاً {toArabicDigits(result.exists)} · لم تُضف {toArabicDigits(result.failed)}.
            </p>
            {result.results.some((r) => r.status !== 'created' && r.status !== 'enrolled') && (
              <ul className="text-sm divide-y divide-divider max-h-56 overflow-y-auto rounded-xl border border-divider">
                {result.results.filter((r) => r.status !== 'created' && r.status !== 'enrolled').map((r) => (
                  <li key={r.row} className="flex items-center justify-between gap-2 px-3 py-1.5">
                    <span>{toArabicDigits(r.row)}. {r.displayNameAr || '—'} <span dir="ltr" className="text-xs text-text-secondary">{r.whatsapp}</span></span>
                    <Badge variant={BULK_STATUS[r.status].tone} size="sm">{BULK_STATUS[r.status].label}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <p className="text-xs text-text-secondary">تُضاف الطالبة مرة واحدة مهما تكرر رقمها. من لها حساب لا يتغير حسابها، وتُدخل الحلقة إن اخترتِ واحدة.</p>
      </CardContent>
    </Card>
  );
}
