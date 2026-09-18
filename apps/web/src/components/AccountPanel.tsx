'use client';

import { Button, Card, CardContent } from '@itqan/ui';
import { useAuth } from '@/lib/auth-context';

export function AccountPanel() {
  const { user } = useAuth();
  const name = user?.displayNameAr || 'طالبة إتقان';
  const email = user?.email || '—';
  const phone = user?.whatsappE164 || '—';
  const lastActive = user?.lastActiveAt
    ? new Date(user.lastActiveAt).toLocaleString('ar-EG')
    : 'هذه الجلسة';

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
                  {user?.role === 'student' || !user ? 'حساب طالبة — كلية الأزهر للبنات' : 'حساب هيئة تدريس — كلية الأزهر للبنات'}
                </p>
              </div>
            </div>
            <Button variant="primary" size="sm" disabled>
              تعديل
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex items-center justify-between gap-4 flex-wrap">
          <div className="text-sm text-text-secondary">
            <p className="font-medium text-text-primary">مصر</p>
            <p>Egypt</p>
            <p>Africa / Cairo</p>
          </div>
          <Button variant="primary" size="sm" disabled>
            تعديل
          </Button>
        </CardContent>
      </Card>
      <div>
        <p className="text-sm text-text-muted mb-2 text-left md:text-right">التعديل على حسابي</p>
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
            <div className="flex items-start justify-between gap-3 text-sm text-text-secondary">
              <div>
                <p>تاريخ الدخول: {lastActive}</p>
                <p className="mt-1">نوع الجهاز: متصفح الويب</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
