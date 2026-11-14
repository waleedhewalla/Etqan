'use client';

import { SUPPORT_EMAIL } from '@/lib/site';
import { useRouter } from 'next/navigation';
import { Button, Card, CardContent } from '@itqan/ui';
import { useAuth } from '@/lib/auth-context';
import { MyData } from '@/components/MyData';

const ROLE_LABELS: Record<string, string> = {
  student: 'حساب طالبة',
  mahram: 'حساب ولي أمر',
};

export function AccountPanel() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const name = user?.displayNameAr || 'طالبة إتقان';
  const email = user?.email || '—';
  const phone = user?.whatsappE164 || '—';

  const handleLogout = async () => {
    await logout();
    router.replace('/');
  };

  return (
    <section className="space-y-4">
      <h2 className="font-heading text-2xl font-bold text-brand-accent text-left md:text-right">حسابي الشخصي</h2>
      <Card>
        <CardContent>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-brand-primary text-surface-canvas flex items-center justify-center font-heading text-xl font-bold">
                {name.slice(0, 1)}
              </div>
              <div>
                <p className="font-heading text-lg font-bold text-text-primary">{name}</p>
                <p className="text-sm text-text-secondary">{email}</p>
                <p className="text-xs text-brand-primary mt-1">
                  {ROLE_LABELS[user?.role ?? 'student'] ?? 'حساب هيئة تدريس'}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      <div>
        <p className="text-sm text-text-muted mb-2 text-left md:text-right">بيانات حسابي</p>
        <Card>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="surface-card px-4 py-3 text-sm">
                <span className="text-text-secondary">الاسم:</span>
                <span className="ms-2 font-medium">{name}</span>
              </label>
              <label className="surface-card px-4 py-3 text-sm">
                <span className="text-text-secondary">رقم الهاتف:</span>
                <span className="ms-2 font-medium" dir="ltr">{phone}</span>
              </label>
            </div>
            <div className="flex items-center justify-between gap-3 text-sm text-text-secondary flex-wrap">
              <p>نوع الجهاز: متصفح الويب</p>
              <Button variant="secondary" size="sm" onClick={handleLogout}>
                تسجيل الخروج
              </Button>
            </div>
            <p className="text-sm text-text-secondary">
              لتعديل بياناتك أو لأي مساعدة راسلينا على <a className="text-brand-primary underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
            </p>
          </CardContent>
        </Card>
      </div>
      <MyData />
    </section>
  );
}
