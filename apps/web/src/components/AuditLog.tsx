'use client';

import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@itqan/ui';
import { ScrollText } from 'lucide-react';
import { api, queryKeys, type AuditEntry } from '@/lib/api';
import { ACTOR_LABEL, actionLabel } from '@/lib/admin-labels';
import { LoadError, Spinner } from '@/components/LoadState';

const field = 'rounded-xl border border-divider bg-surface-elevated px-3 py-2 text-sm';
const when = (iso: string) => new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
const RESOURCE: Record<string, string> = { user: 'مستخدم', section: 'حلقة', tenant: 'المؤسسة', hifz_program: 'برنامج حفظ', session: 'جلسة', tasmi_submission: 'تسميع' };

/** What an entry carries besides who and what: short facts, never identifiers a person cannot read. */
function facts(e: AuditEntry): string[] {
  const d = e.details ?? {};
  const out: string[] = [];
  if (typeof d.role === 'string') out.push(`النوع: ${d.role}`);
  if (Array.isArray(d.fields)) out.push(`الحقول: ${(d.fields as string[]).join('، ')}`);
  if (typeof d.rows === 'number') out.push(`عدد الصفوف: ${d.rows}`);
  if (typeof d.created === 'number') out.push(`أُضيف: ${d.created}`);
  if (typeof d.periods === 'number') out.push(`الفترات: ${d.periods}`);
  return out;
}

/** The institution's audit log: who did what, newest first. */
export function AuditLog() {
  const [action, setAction] = useState('');
  const filter = { action: action || undefined };
  const log = useInfiniteQuery({
    queryKey: queryKeys.adminAudit(filter),
    queryFn: ({ pageParam }) => api.getAuditLog({ ...filter, before: pageParam, limit: 50 }).then((r) => r.data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });
  const entries = log.data?.pages.flatMap((p) => p.entries) ?? [];
  const actions = log.data?.pages[0]?.actions ?? [];

  return (
    <Card data-testid="audit-log">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ScrollText className="w-5 h-5 text-brand-primary" />سجل العمليات</CardTitle>
        <CardDescription>من فعل ماذا ومتى في مؤسستكِ، من الأحدث. لا يُعدَّل ولا يُحذف.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="text-sm inline-block">
          <span className="block text-text-secondary mb-1">العملية</span>
          <select className={field} value={action} aria-label="العملية" onChange={(e) => setAction(e.target.value)}>
            <option value="">كل العمليات</option>
            {actions.map((a) => <option key={a} value={a}>{actionLabel(a)}</option>)}
          </select>
        </label>
        {log.isLoading ? <Spinner /> : log.isError ? <LoadError onRetry={() => log.refetch()} /> : entries.length === 0 ? (
          <p className="text-sm text-text-secondary">لا عمليات مسجّلة بعد.</p>
        ) : (
          <ul className="divide-y divide-divider text-sm" data-testid="audit-entries">
            {entries.map((e) => (
              <li key={e.id} className="py-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div>
                  <p className="font-medium text-text-primary">{actionLabel(e.action)}</p>
                  <p className="text-xs text-text-secondary">
                    {e.actorName ? `${e.actorName} (${ACTOR_LABEL(e.actorRole)})` : ACTOR_LABEL(null)}
                    {' · '}{RESOURCE[e.resource] ?? e.resource}
                    {facts(e).map((f) => ` · ${f}`).join('')}
                  </p>
                </div>
                <time dateTime={e.at} className="text-xs text-text-secondary whitespace-nowrap">{when(e.at)}</time>
              </li>
            ))}
          </ul>
        )}
        {log.hasNextPage && <Button variant="outline" loading={log.isFetchingNextPage} onClick={() => log.fetchNextPage()}>عرض الأقدم</Button>}
      </CardContent>
    </Card>
  );
}
