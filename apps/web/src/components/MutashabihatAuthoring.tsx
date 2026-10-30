'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@itqan/ui';
import { AYAH_COUNTS } from '@itqan/quran';
import { api, errorMessage, type Cluster } from '@/lib/api';
import { SURAH_NAMES, toArabicDigits } from '@/lib/quran';
import { ClusterCompare } from '@/components/ClusterCompare';
import { LoadError, Spinner } from '@/components/LoadState';

const APPROVER_ROLES = ['sheikh_reviewer', 'dean', 'advisor', 'operator', 'superadmin'];
const SOURCES: { value: Cluster['source']; label: string }[] = [
  { value: 'other', label: 'أخرى' }, { value: 'kirmani', label: 'الكرماني' },
  { value: 'ansari', label: 'الأنصاري' }, { value: 'sakhawi', label: 'السخاوي' },
];
const STATUS_LABEL: Record<Cluster['approvalStatus'], string> = {
  draft: 'مسودة', pending_review: 'بانتظار الاعتماد', approved: 'معتمدة', rejected: 'مرفوضة',
};

interface Row { sura: number; ayah: number }

/** Teachers propose groups of look-alike verses; a scholar (or administrator) approves them before students see them. */
export function MutashabihatAuthoring({ role }: { role: string }) {
  const queryClient = useQueryClient();
  const canApprove = APPROVER_ROLES.includes(role);
  const [rows, setRows] = useState<Row[]>([{ sura: 2, ayah: 1 }, { sura: 3, ayah: 1 }]);
  const [source, setSource] = useState<Cluster['source']>('other');
  const [tawjih, setTawjih] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['mutashabihat'] });

  const pending = useQuery({ queryKey: ['mutashabihat', 'clusters', 'pending_review'], queryFn: () => api.getClusters('pending_review').then((r) => r.data) });
  const approved = useQuery({ queryKey: ['mutashabihat', 'clusters', 'approved'], queryFn: () => api.getClusters('approved').then((r) => r.data) });

  const create = useMutation({
    mutationFn: () => api.createCluster({ ayahRefs: rows.map((r) => `${r.sura}:${r.ayah}`), source, tawjihAr: tawjih.trim() || undefined }),
    onSuccess: () => { setTawjih(''); refresh(); },
  });
  const review = useMutation({ mutationFn: ({ id, d }: { id: string; d: 'approved' | 'rejected' }) => api.reviewCluster(id, d), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteCluster(id), onSuccess: refresh });

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, k) => {
    if (k !== i) return r;
    const next = { ...r, ...patch };
    return { sura: next.sura, ayah: Math.min(Math.max(1, Math.floor(next.ayah) || 1), AYAH_COUNTS[next.sura - 1]) };
  }));
  const duplicate = new Set(rows.map((r) => `${r.sura}:${r.ayah}`)).size < rows.length;

  const list = (title: string, q: typeof pending, actions: boolean) => (
    <Card>
      <CardHeader><CardTitle>{title} ({toArabicDigits(q.data?.length ?? 0)})</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {q.isLoading ? <Spinner /> : q.isError ? <LoadError onRetry={() => q.refetch()} /> : (q.data ?? []).length === 0 ? (
          <p className="text-sm text-text-secondary">لا يوجد شيء هنا بعد.</p>
        ) : q.data!.map((c) => (
          <div key={c.id} data-testid="cluster-row" className="space-y-2 rounded-xl border border-divider p-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Badge>{STATUS_LABEL[c.approvalStatus]}</Badge>
              {actions && (
                <span className="flex gap-2">
                  {canApprove && <Button size="sm" onClick={() => review.mutate({ id: c.id, d: 'approved' })} loading={review.isPending}>اعتماد</Button>}
                  {canApprove && <Button size="sm" variant="outline" onClick={() => review.mutate({ id: c.id, d: 'rejected' })}>رفض</Button>}
                  <Button size="sm" variant="ghost" onClick={() => { if (window.confirm('حذف هذا الاقتراح؟')) remove.mutate(c.id); }}>حذف</Button>
                </span>
              )}
              {!actions && canApprove && (
                <Button size="sm" variant="outline" onClick={() => review.mutate({ id: c.id, d: 'rejected' })}>إلغاء الاعتماد</Button>
              )}
            </div>
            <ClusterCompare cluster={c} />
          </div>
        ))}
        {(review.isError || remove.isError) && <p role="alert" className="text-sm text-red-800">{errorMessage(review.error ?? remove.error)}</p>}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>اقتراح مجموعة متشابهات</CardTitle>
          <CardDescription>
            اختاري الآيات المتشابهة (من اثنتين إلى ست). لا تظهر للطالبات إلا بعد أن تعتمدها معلمة مراجِعة أو مسؤولة المؤسسة، ثم تظهر لمن يحفظن إحدى آياتها.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <label className="text-sm">
                <span className="block text-text-secondary mb-1">السورة</span>
                <select aria-label={`السورة ${i + 1}`} value={r.sura} onChange={(e) => setRow(i, { sura: Number(e.target.value), ayah: 1 })}
                  className="rounded-xl border border-divider bg-surface-elevated px-3 py-2 min-w-[10rem]">
                  {SURAH_NAMES.map((n, k) => <option key={n} value={k + 1}>{toArabicDigits(k + 1)}. {n}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <span className="block text-text-secondary mb-1">الآية</span>
                <input aria-label={`الآية ${i + 1}`} type="number" min={1} max={AYAH_COUNTS[r.sura - 1]} value={r.ayah}
                  onChange={(e) => setRow(i, { ayah: Number(e.target.value) })} className="w-20 rounded-xl border border-divider bg-surface-elevated px-3 py-2" />
              </label>
              {rows.length > 2 && <Button type="button" size="sm" variant="ghost" onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}>إزالة</Button>}
            </div>
          ))}
          {rows.length < 6 && <Button type="button" size="sm" variant="outline" onClick={() => setRows((rs) => [...rs, { sura: 2, ayah: 1 }])}>إضافة آية</Button>}
          <label className="block text-sm">
            <span className="block text-text-secondary mb-1">المرجع</span>
            <select value={source} onChange={(e) => setSource(e.target.value as Cluster['source'])} className="rounded-xl border border-divider bg-surface-elevated px-3 py-2">
              {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="block text-text-secondary mb-1">توجيه الفرق بين الآيات (اختياري)</span>
            <textarea id="tawjih" value={tawjih} onChange={(e) => setTawjih(e.target.value)} rows={2} maxLength={1000}
              className="w-full rounded-xl border border-divider bg-surface-elevated px-3 py-2" />
          </label>
          {duplicate && <p role="alert" className="text-sm text-red-800">اخترتِ الآية نفسها مرتين.</p>}
          {create.isError && <p role="alert" className="text-sm rounded-lg px-3 py-2 bg-red-50 text-red-800">{errorMessage(create.error, 'لم يُحفظ الاقتراح.')}</p>}
          {create.isSuccess && <p role="status" className="text-sm rounded-lg px-3 py-2 bg-green-50 text-green-800">أُرسل الاقتراح للاعتماد.</p>}
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={duplicate}>إرسال للاعتماد</Button>
        </CardContent>
      </Card>
      {list('بانتظار الاعتماد', pending, true)}
      {list('المعتمدة', approved, false)}
    </div>
  );
}
