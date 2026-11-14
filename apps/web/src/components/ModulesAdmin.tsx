'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@itqan/ui';
import { AlertTriangle, Blocks } from 'lucide-react';
import { api, errorMessage, queryKeys, type ModuleKey, type ModuleSettingValue, type ModuleView } from '@/lib/api';
import { toArabicDigits } from '@/lib/quran';
import { LoadError, Spinner } from '@/components/LoadState';

const field = 'rounded-xl border border-divider bg-surface-elevated px-3 py-2 text-sm';
const GROUPS: { title: string; keys: ModuleKey[] }[] = [
  { title: 'الأساس', keys: ['review', 'mushaf'] },
  { title: 'التسميع والحفظ', keys: ['recitation', 'ai_checking', 'lessons', 'program', 'mutashabihat'] },
  { title: 'الدروس المباشرة', keys: ['live'] },
  { title: 'المتابعة والتقارير', keys: ['attendance', 'monthly_record', 'badges', 'guardians', 'notifications'] },
];

/** Where an admin chooses which of the product's modules her institution uses, and sets what each does. */
export function ModulesAdmin() {
  const queryClient = useQueryClient();
  const data = useQuery({ queryKey: queryKeys.adminModules, queryFn: () => api.getModules().then((r) => r.data.modules) });
  const apply = (modules: ModuleView[]) => {
    queryClient.setQueryData(queryKeys.adminModules, modules);
    // Every screen reads which modules are on from the sign-in profile.
    queryClient.invalidateQueries({ queryKey: queryKeys.me });
    queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
  };

  if (data.isLoading) return <Spinner />;
  if (data.isError || !data.data) return <LoadError onRetry={() => data.refetch()} />;
  const byKey = new Map(data.data.map((m) => [m.key, m]));

  return (
    <section className="space-y-6" aria-label="وحدات المنصة" data-testid="modules-admin">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Blocks className="w-5 h-5 text-brand-primary" />وحدات المنصة</CardTitle>
          <CardDescription>
            اختاري ما تستخدمه مؤسستكِ من وحدات المنصة، واضبطي إعدادات كل وحدة. الوحدة الموقوفة تختفي من شاشات المعلمات والطالبات، ولا يُحذف شيء من بياناتها، وتعود كما كانت عند تفعيلها.
          </CardDescription>
        </CardHeader>
      </Card>
      {GROUPS.map((g) => (
        <div key={g.title} className="space-y-3">
          <h2 className="font-heading font-semibold text-text-primary">{g.title}</h2>
          {g.keys.map((k) => byKey.get(k)).filter((m): m is ModuleView => Boolean(m)).map((m) => (
            <ModuleCard key={m.key} module={m} all={byKey} onChange={apply} />
          ))}
        </div>
      ))}
    </section>
  );
}

function ModuleCard({ module: m, all, onChange }: { module: ModuleView; all: Map<ModuleKey, ModuleView>; onChange: (modules: ModuleView[]) => void }) {
  const initial = Object.fromEntries(m.settings.map((s) => [s.key, s.value])) as Record<string, ModuleSettingValue>;
  const [values, setValues] = useState(initial);
  const [notice, setNotice] = useState('');
  const dirty = m.settings.some((s) => values[s.key] !== s.value);
  const valid = m.settings.every((s) => s.kind === 'bool' || (Number.isInteger(values[s.key]) && Number(values[s.key]) >= (s.min ?? -Infinity) && Number(values[s.key]) <= (s.max ?? Infinity)));

  const mutation = useMutation({
    mutationFn: (change: Parameters<typeof api.saveModule>[1]) => api.saveModule(m.key, change).then((r) => r.data.modules),
    onSuccess: (modules, change) => {
      onChange(modules);
      const fresh = modules.find((x) => x.key === m.key)!;
      setValues(Object.fromEntries(fresh.settings.map((s) => [s.key, s.value])) as Record<string, ModuleSettingValue>);
      setNotice(change.enabled === true ? 'فُعّلت الوحدة.' : change.enabled === false ? 'أُوقفت الوحدة.' : change.reset ? 'أُعيد الإعداد إلى الافتراضي.' : 'حُفظت الإعدادات.');
    },
  });
  const toggle = () => {
    setNotice('');
    if (m.requested && !window.confirm(`إيقاف «${m.labelAr}»؟ تختفي من شاشات المعلمات والطالبات${dependents(m, all)}، وتبقى بياناتها محفوظة.`)) return;
    mutation.mutate({ enabled: !m.requested });
  };

  return (
    <Card data-testid={`module-${m.key}`} className={m.enabled ? '' : 'opacity-90'}>
      <CardContent className="py-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-2xl">
            <p className="font-medium text-text-primary flex items-center gap-2 flex-wrap">
              {m.labelAr}
              {m.core ? <Badge variant="neutral" size="sm">أساسية</Badge>
                : m.enabled ? <Badge variant="green" size="sm">مفعّلة</Badge>
                : m.blockedBy ? <Badge variant="gold" size="sm">موقوفة لأن «{all.get(m.blockedBy)?.labelAr}» موقوفة</Badge>
                : <Badge variant="red" size="sm">موقوفة</Badge>}
            </p>
            <p className="text-sm text-text-secondary mt-1">{m.descriptionAr}</p>
          </div>
          {!m.core && (
            <button type="button" role="switch" aria-checked={m.requested} aria-label={`تفعيل ${m.labelAr}`} disabled={mutation.isPending} onClick={toggle}
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition ${m.requested ? 'bg-brand-primary' : 'bg-divider'} disabled:opacity-60`}>
              <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${m.requested ? '-translate-x-6' : '-translate-x-1'}`} />
            </button>
          )}
        </div>

        {m.availability && !m.availability.ok && (
          <p className="flex items-start gap-2 text-sm rounded-xl bg-amber-50 text-amber-900 px-3 py-2" role="note">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{m.availability.messageAr}
          </p>
        )}

        {m.settings.length > 0 && (
          <form className="space-y-3 border-t border-divider pt-3" onSubmit={(e) => { e.preventDefault(); setNotice(''); const changed = Object.fromEntries(m.settings.filter((s) => values[s.key] !== s.value).map((s) => [s.key, values[s.key]])); mutation.mutate({ config: changed }); }}>
            <div className="grid sm:grid-cols-2 gap-3">
              {m.settings.map((s) => (
                <label key={s.key} className="text-sm space-y-1 block">
                  <span className="block text-text-primary">{s.labelAr}</span>
                  {s.kind === 'bool' ? (
                    <span className="flex items-center gap-2">
                      <input type="checkbox" checked={Boolean(values[s.key])} onChange={(e) => setValues({ ...values, [s.key]: e.target.checked })} aria-label={s.labelAr} />
                      {values[s.key] ? 'مسموح' : 'غير مسموح'}
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <input type="number" min={s.min ?? undefined} max={s.max ?? undefined} className={`${field} w-28`} aria-label={s.labelAr}
                        value={Number.isFinite(values[s.key] as number) ? (values[s.key] as number) : ''} onChange={(e) => setValues({ ...values, [s.key]: Math.floor(Number(e.target.value)) })} />
                      {s.unitAr}
                    </span>
                  )}
                  <span className="block text-xs text-text-secondary">
                    {s.kind === 'int' && <>بين {toArabicDigits(s.min ?? 0)} و{toArabicDigits(s.max ?? 0)} · </>}
                    الافتراضي: {s.kind === 'bool' ? (s.default ? 'مسموح' : 'غير مسموح') : toArabicDigits(Number(s.default))}
                    {s.helpAr && <> · {s.helpAr}</>}
                  </span>
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" loading={mutation.isPending} disabled={!dirty || !valid}>حفظ الإعدادات</Button>
              {m.settings.some((s) => s.custom) && (
                <Button type="button" size="sm" variant="ghost" disabled={mutation.isPending}
                  onClick={() => { setNotice(''); mutation.mutate({ reset: m.settings.filter((s) => s.custom).map((s) => s.key) }); }}>
                  إعادة إلى الافتراضي
                </Button>
              )}
              {dirty && !valid && <span role="alert" className="text-sm text-red-800">تحققي من القيم: لكل إعداد حدّ أدنى وأقصى.</span>}
            </div>
          </form>
        )}
        {notice && <p role="status" className="text-sm text-text-primary">{notice}</p>}
        {mutation.isError && <p role="alert" className="text-sm text-red-800">{errorMessage(mutation.error, 'تعذّر الحفظ.')}</p>}
      </CardContent>
    </Card>
  );
}

/** « وتتوقف معها: …» — the modules that go off with this one. */
function dependents(m: ModuleView, all: Map<ModuleKey, ModuleView>): string {
  const names = [...all.values()].filter((x) => x.dependsOn.includes(m.key) && x.requested).map((x) => `«${x.labelAr}»`);
  return names.length ? ` ويتوقف معها ${names.join(' و')}` : '';
}
