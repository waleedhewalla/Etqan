'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BrandMark } from '@/components/BrandMark';
import { Button, Input, Card, CardContent, CardHeader, CardTitle, CardDescription } from '@itqan/ui';
import { Mail, Loader2, Shield, CheckCircle, AlertCircle } from 'lucide-react';
import { api, errorMessage, homeFor } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

type Mode = 'request' | 'sent' | 'verifying';

export default function FacultyLoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('request');
  const verified = useRef(false);

  // Opening the emailed link lands here with ?token=…; exchange it once.
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token || verified.current) return;
    verified.current = true;
    setMode('verifying');

    api.verifyMagicLink(token)
      .then((res) => {
        login(res.data);
        router.replace(homeFor(res.data.user.role));
      })
      .catch((err) => {
        setMode('request');
        setError(err?.response?.status === 401
          ? 'انتهت صلاحية رابط الدخول أو استُخدم من قبل. اطلبي رابطاً جديداً.'
          : errorMessage(err));
        window.history.replaceState(null, '', window.location.pathname);
      });
  }, [login, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.magicLink(email.trim());
      setMode('sent');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-canvas flex items-start justify-center py-8 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-5">
          <Link href="/" className="inline-flex justify-center mb-3 cursor-pointer" aria-label="إتقان">
            <BrandMark size="lg" />
          </Link>
          <h1 className="font-heading text-2xl font-bold text-text-primary">دخول هيئة التدريس</h1>
          <p className="text-text-secondary mt-2">لوحة متابعة الشعبة، مراجعة التسميع، والتدخلات الموجهة</p>
        </div>

        <div className="mb-4 flex items-center justify-center gap-2 text-xs text-text-secondary">
          <Shield className="w-4 h-4 text-brand-primary" />
          <span>الدخول برابط آمن يُرسل إلى بريدك المؤسسي</span>
        </div>

        <Card className="overflow-hidden">
          <CardHeader className="text-center pb-2">
            <CardTitle className="font-heading text-xl">
              {mode === 'sent' ? 'تفقّدي بريدك' : mode === 'verifying' ? 'جارٍ تسجيل الدخول' : 'رابط الدخول'}
            </CardTitle>
            <CardDescription className="text-text-secondary">
              {mode === 'sent'
                ? `إن كان ${email} مسجلاً لدينا، فستصلك رسالة فيها رابط دخول صالح لمدة ١٥ دقيقة.`
                : mode === 'verifying'
                  ? 'نتحقق من الرابط…'
                  : 'أدخلي بريدك الإلكتروني المسجّل لنرسل لك رابط دخول.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm flex items-center gap-2" role="alert">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {mode === 'verifying' && (
              <div className="flex justify-center py-6">
                <Loader2 className="w-8 h-8 animate-spin text-brand-primary" aria-label="جارٍ التحقق" />
              </div>
            )}

            {mode === 'sent' && (
              <div className="space-y-4 text-center">
                <CheckCircle className="w-10 h-10 text-brand-primary mx-auto" />
                <Button variant="ghost" className="w-full" onClick={() => setMode('request')}>
                  إرسال الرابط إلى بريد آخر
                </Button>
              </div>
            )}

            {mode === 'request' && (
              <form onSubmit={handleSubmit} className="space-y-4">
                <Input
                  id="faculty-email"
                  label="البريد الإلكتروني المؤسسي"
                  type="email"
                  placeholder="faculty@azhar.edu.eg"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  leftIcon={<Mail className="w-5 h-5" />}
                  required
                  autoComplete="email"
                  disabled={loading}
                  dir="ltr"
                />
                <Button type="submit" className="w-full" size="lg" loading={loading}>
                  أرسلي رابط الدخول
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <div className="mt-4 text-center text-sm text-text-secondary space-y-1">
          <p>
            طالبة أو ولي أمر؟{' '}
            <Link href="/auth/login" className="text-brand-primary hover:underline font-medium">الدخول برقم الواتساب</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
