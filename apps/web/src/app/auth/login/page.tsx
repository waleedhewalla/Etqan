'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Input, OTPInput, Card, CardContent, CardHeader, CardTitle, CardDescription } from '@itqan/ui';
import { AlertCircle, Phone } from 'lucide-react';
import { BrandMark } from '@/components/BrandMark';
import { api, errorMessage, homeFor, normalizePhone } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

/** WhatsApp sign-in for students and guardians who already have an account. */
export default function LoginPage() {
  const router = useRouter();
  const { user, isLoading, login } = useAuth();
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (!isLoading && user) router.replace(homeFor(user.role));
  }, [isLoading, user, router]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const whatsapp = normalizePhone(phone);

  const sendCode = async () => {
    setError(null);
    setLoading(true);
    try {
      await api.requestOtp(whatsapp);
      setStep('code');
      setResendIn(60);
    } catch (err) {
      setError(errorMessage(err, 'تعذّر إرسال الرمز. تأكدي من رقم الواتساب.'));
    } finally {
      setLoading(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length !== 4) {
      setError('أدخلي الرمز كاملاً');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await api.verifyOtp(whatsapp, otp);
      login(res.data);
      router.replace(homeFor(res.data.user.role));
    } catch (err) {
      setError(errorMessage(err, 'رمز غير صحيح، حاولي مرة أخرى'));
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-canvas flex items-start justify-center py-8 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-5">
          <Link href="/" className="inline-flex justify-center mb-3" aria-label="إتقان">
            <BrandMark size="lg" />
          </Link>
          <h1 className="font-heading text-2xl font-bold text-text-primary">تسجيل الدخول</h1>
          <p className="text-text-secondary mt-2">للطالبات وأولياء الأمور برقم الواتساب</p>
        </div>

        <Card>
          <CardHeader className="text-center pb-2">
            <CardTitle className="font-heading text-xl">
              {step === 'phone' ? 'رقم الواتساب' : 'رمز التحقق'}
            </CardTitle>
            <CardDescription className="text-text-secondary">
              {step === 'phone'
                ? 'سنرسل رمزاً من ٤ أرقام إلى واتساب'
                : <>أرسلنا الرمز إلى <span dir="ltr">{whatsapp}</span></>}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm flex items-center gap-2" role="alert">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {step === 'phone' ? (
              <form onSubmit={(e) => { e.preventDefault(); sendCode(); }} className="space-y-4">
                <Input
                  id="login-phone"
                  label="رقم الواتساب"
                  type="tel"
                  placeholder="010 1234 5678"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  leftIcon={<Phone className="w-5 h-5" />}
                  required
                  autoComplete="tel"
                  dir="ltr"
                />
                <Button type="submit" className="w-full" size="lg" loading={loading}>
                  أرسلي الرمز
                </Button>
              </form>
            ) : (
              <form onSubmit={verify} className="space-y-4">
                <OTPInput length={4} value={otp} onChange={setOtp} autoFocus disabled={loading} />
                <Button type="submit" className="w-full" size="lg" loading={loading}>
                  دخول
                </Button>
                <div className="flex justify-between text-sm">
                  <button type="button" className="text-text-secondary hover:text-brand-primary" onClick={() => { setStep('phone'); setOtp(''); }}>
                    تغيير الرقم
                  </button>
                  <button
                    type="button"
                    className="text-brand-primary disabled:text-text-muted"
                    disabled={resendIn > 0 || loading}
                    onClick={sendCode}
                  >
                    {resendIn > 0 ? `إعادة الإرسال بعد ${resendIn} ث` : 'إعادة إرسال الرمز'}
                  </button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>

        <div className="mt-4 text-center text-sm text-text-secondary space-y-1">
          <p>
            طالبة جديدة؟{' '}
            <Link href="/auth/join" className="text-brand-primary hover:underline font-medium">انضمّي بكود الشعبة</Link>
          </p>
          <p>
            من هيئة التدريس؟{' '}
            <Link href="/auth/login/faculty" className="text-brand-primary hover:underline font-medium">الدخول بالبريد</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
