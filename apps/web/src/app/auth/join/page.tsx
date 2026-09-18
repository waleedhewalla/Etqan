'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Input, OTPInput, Card, CardContent, CardHeader, CardTitle, CardDescription } from '@itqan/ui';
import { ArrowRight, CheckCircle, AlertCircle, Loader2, Mail, Phone, Eye, EyeOff, Shield, User } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { BrandMark } from '@/components/BrandMark';

export default function JoinPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [sectionCode, setSectionCode] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [notificationPref, setNotificationPref] = useState<'whatsapp' | 'inapp'>('whatsapp');
  const [consents, setConsents] = useState({
    dataProcessing: false,
    voiceRecording: false,
    analytics: false,
    mahramAccess: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otpSent, setOtpSent] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);

  const handleStep1Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    
    try {
      // Validate section code exists
      const res = await api.getSection(sectionCode);
      if (!res.data) throw new Error('كود الشعبة غير صحيح');
      
      // Send OTP
      await api.requestOtp(phone);
      setOtpSent(true);
      setResendTimer(60);
      setStep(2);
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'حدث خطأ، حاول مرة أخرى');
    } finally {
      setLoading(false);
    }
  };

  const handleStep2Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length !== 4) {
      setError('أدخل الرمز كاملاً');
      return;
    }
    
    setError(null);
    setLoading(true);
    
    try {
      const res = await api.verifyOtp(phone, otp);
      const { accessToken, user } = res.data;
      localStorage.setItem('itqan_token', accessToken);
      localStorage.setItem('itqan_user', JSON.stringify(user));
      setStep(3);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'رمز غير صحيح، حاول مرة أخرى');
    } finally {
      setLoading(false);
    }
  };

  const handleStep3Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    
    try {
      const token = localStorage.getItem('itqan_token');
      await api.getMe(); // Verify token works
      setStep(4);
    } catch (err) {
      setError('حدث خطأ في التحقق');
    } finally {
      setLoading(false);
    }
  };

  const handleStep4Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consents.dataProcessing) {
      setError('يجب الموافقة على معالجة البيانات');
      return;
    }
    
    setError(null);
    setLoading(true);
    
    try {
      // Save preferences
      const token = localStorage.getItem('itqan_token');
      // In real app, call API to save preferences
      
      setStep(5);
    } catch (err) {
      setError('حدث خطأ');
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = () => {
    router.push('/dashboard');
    router.refresh();
  };

  // Resend timer
  useEffect(() => {
    if (resendTimer > 0) {
      const timer = setInterval(() => {
        setResendTimer(prev => prev - 1);
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [resendTimer]);

  const steps = [
    { num: 1, label: 'كود الشعبة', desc: 'الهاتف + الكود' },
    { num: 2, label: 'التحقق', desc: 'رمز OTP' },
    { num: 3, label: 'الملف الشخصي', desc: 'الاسم والصورة' },
    { num: 4, label: 'الموافقة', desc: 'الخصوصية' },
    { num: 5, label: 'انتهيت', desc: 'أول جلسة' },
  ];

  return (
    <div className="min-h-screen bg-surface-canvas flex items-start justify-center py-8 px-4">
      <div className="w-full max-w-md">
        <Link href="/" className="flex justify-center mb-5 cursor-pointer" aria-label="إتقان">
          <BrandMark />
        </Link>
        {/* Progress Stepper */}
        <div className="mb-5">
          <div className="relative">
            <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-divider -translate-y-1/2" />
            <div className="relative flex justify-between">
              {steps.map((s, i) => (
                <div key={s.num} className="relative z-10">
                  <div className={`
                    w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-2 transition-all
                    ${i + 1 < step ? 'bg-state-positive text-white border-state-positive' :
                      i + 1 === step ? 'bg-brand-primary text-white border-brand-primary ring-4 ring-brand-primary/20' :
                      'bg-surface-elevated text-text-muted border-divider'
                    }
                  `}>
                    {i + 1 < step ? (
                      <CheckCircle className="w-5 h-5 mx-auto" />
                    ) : (
                      <span className="font-bold">{s.num}</span>
                    )}
                  </div>
                  <p className={`text-xs font-medium ${i + 1 <= step ? 'text-text-primary' : 'text-text-muted'}`}>
                    {s.label}
                  </p>
                  <p className="text-[10px] text-text-muted mt-0.5">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Trust Badge */}
        <div className="mb-4 flex items-center justify-center gap-2 text-xs text-text-secondary">
          <Shield className="w-4 h-4 text-brand-primary" />
          <span>معتمد من عمادة كلية الأزهر للبنات</span>
        </div>

        {/* Form Card */}
        <Card className="overflow-hidden">
          <CardHeader className="text-center pb-2">
            <CardTitle className="font-heading text-2xl">مرحباً بك في إتقان</CardTitle>
            <CardDescription className="text-text-secondary">
              {step === 1 && 'أدخلي كود الشعبة ورقم الهاتف للبدء'}
              {step === 2 && 'أدخلي رمز التحقق المرسل لواتساب'}
              {step === 3 && 'أكملي بياناتك الشخصية'}
              {step === 4 && 'راجعي الموافقات وابدئي'}
              {step === 5 && 'أنت جاهزة! اضغطي للبدء'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm flex items-center gap-2" role="alert">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Step 1: Section Code + Phone */}
            {step === 1 && (
              <form onSubmit={handleStep1Submit} className="space-y-4">
                <Input
                  label="كود الشعبة"
                  placeholder="مثال: AZH-2026-001"
                  value={sectionCode}
                  onChange={(e) => setSectionCode(e.target.value.toUpperCase())}
                  leftIcon={<User className="w-5 h-5" />}
                  required
                  autoComplete="off"
                  maxLength={20}
                />
                <Input
                  label="رقم الواتساب"
                  type="tel"
                  placeholder="+20 1XX XXX XXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  leftIcon={<Phone className="w-5 h-5" />}
                  required
                  autoComplete="tel"
                />
                <Button type="submit" className="w-full" size="lg" loading={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                    <>أرسلي رمز التحقق <ArrowRight className="w-4 h-4" /></>
                  )}
                </Button>
              </form>
            )}

            {/* Step 2: OTP */}
            {step === 2 && (
              <form onSubmit={handleStep2Submit} className="space-y-4">
                <div className="text-center text-sm text-text-secondary mb-2">
                  أُرسل الرمز إلى <span className="font-medium">{phone}</span>
                </div>
                <OTPInput
                  length={4}
                  value={otp}
                  onChange={setOtp}
                  autoFocus
                  disabled={loading}
                />
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">
                    لم تصلي الرمز؟{' '}
                    <button
                      type="button"
                      disabled={resendTimer > 0 || loading}
                      onClick={async () => {
                        try {
                          await api.requestOtp(phone);
                          setResendTimer(60);
                          toast.success('أُعيد إرسال الرمز');
                        } catch {
                          toast.error('فشل الإرسال');
                        }
                      }}
                      className={`
                        text-brand-primary hover:underline font-medium transition-colors
                        ${resendTimer > 0 ? 'opacity-50 cursor-not-allowed' : ''}
                      `}
                    >
                      {resendTimer > 0 ? `أعيدي الإرسال خلال ${resendTimer}ث` : 'أعيدي إرسال الرمز'}
                    </button>
                  </span>
                  <button
                    type="button"
                    onClick={() => { setStep(1); setError(null); }}
                    className="text-text-muted hover:text-text-secondary"
                  >
                    تغيير الرقم
                  </button>
                </div>
                <Button type="submit" className="w-full" size="lg" loading={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                    <>تحققي <ArrowRight className="w-4 h-4" /></>
                  )}
                </Button>
              </form>
            )}

            {/* Step 3: Profile */}
            {step === 3 && (
              <form onSubmit={handleStep3Submit} className="space-y-4">
                <Input
                  label="الاسم المعروض"
                  placeholder="فاطمة أحمد"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  leftIcon={<User className="w-5 h-5" />}
                  required
                  autoComplete="name"
                />
                <div className="text-center">
                  <label className="block text-sm font-medium text-text-primary mb-2">
                    الصورة الشخصية (اختياري)
                  </label>
                  <div className="relative w-24 h-24 mx-auto">
                    {avatar ? (
                      <img src={avatar} alt="" className="w-full h-full rounded-full object-cover" />
                    ) : (
                      <div className="w-full h-full rounded-full bg-neutral-100 flex items-center justify-center text-3xl font-bold text-brand-primary">
                        {name.slice(0, 2) || '؟'}
                      </div>
                    )}
                    <label className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-brand-primary flex items-center justify-center cursor-pointer text-white hover:bg-brand-primary/90 transition-colors">
                      <input type="file" accept="image/*" className="sr-only" onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = () => setAvatar(reader.result as string);
                          reader.readAsDataURL(file);
                        }
                      }} />
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.2A2 2 0 0110.074 3h3.852a2 2 0 011.664.89l.812 1.2A2 2 0 0118.074 5H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </label>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">
                    تفضيل الإشعارات
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="relative">
                      <input
                        type="radio"
                        name="notif"
                        value="whatsapp"
                        checked={notificationPref === 'whatsapp'}
                        onChange={() => setNotificationPref('whatsapp')}
                        className="sr-only"
                      />
                      <div className={`p-4 rounded-lg border-2 cursor-pointer transition-colors text-center ${
                        notificationPref === 'whatsapp'
                          ? 'border-brand-primary bg-brand-primary/5'
                          : 'border-divider hover:border-brand-primary/50'
                      }`}>
                        <Mail className="w-5 h-5 mx-auto mb-1 text-brand-primary" />
                        <div className="font-medium text-sm">الواتساب</div>
                      </div>
                    </label>
                    <label className="relative">
                      <input
                        type="radio"
                        name="notif"
                        value="inapp"
                        checked={notificationPref === 'inapp'}
                        onChange={() => setNotificationPref('inapp')}
                        className="sr-only"
                      />
                      <div className={`p-4 rounded-lg border-2 cursor-pointer transition-colors text-center ${
                        notificationPref === 'inapp'
                          ? 'border-brand-primary bg-brand-primary/5'
                          : 'border-divider hover:border-brand-primary/50'
                      }`}>
                        <span className="w-5 h-5 mx-auto mb-1 inline-block bg-brand-primary/10 rounded-full flex items-center justify-center">
                          <span className="w-2 h-2 rounded-full bg-brand-primary" />
                        </span>
                        <div className="font-medium text-sm">داخل التطبيق فقط</div>
                      </div>
                    </label>
                  </div>
                </div>
                <Button type="submit" className="w-full" size="lg" loading={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                    <>متابعة <ArrowRight className="w-4 h-4" /></>
                  )}
                </Button>
              </form>
            )}

            {/* Step 4: Consents */}
            {step === 4 && (
              <form onSubmit={handleStep4Submit} className="space-y-4">
                <div className="p-3 rounded-lg bg-brand-primary/5 border border-brand-primary/20 text-sm text-brand-primary">
                  <p className="font-medium mb-1">خصوصيتك مهمة</p>
                  <p className="text-brand-primary/80">
                    نطلب موافقتك الصريحة لكل غرض. يمكنك سحب الموافقة لاحقاً من الإعدادات.
                  </p>
                </div>
                
                {[
                  { key: 'dataProcessing', title: 'معالجة البيانات الشخصية', desc: 'للحساب، التقدم، والتقارير الأكاديمية', required: true },
                  { key: 'voiceRecording', title: 'تسجيل الصوت للتسميع', desc: 'يُحذف تلقائياً خلال ٢٤ ساعة', required: false },
                  { key: 'analytics', title: 'تحليلات التعلم المجهولة', desc: 'لتحسين المنصة، لا بيانات شخصية', required: false },
                  { key: 'mahramAccess', title: 'رؤية المحرم (اختياري)', desc: 'ملخص تقدم فقط، بدون تفاصيل', required: false },
                ].map((item) => (
                  <label key={item.key} className="flex items-start gap-3 p-4 rounded-lg border border-divider hover:border-brand-primary/50 transition-colors cursor-pointer">
                    <input
                      type="checkbox"
                      checked={consents[item.key as keyof typeof consents]}
                      onChange={(e) => setConsents(prev => ({ ...prev, [item.key]: e.target.checked }))}
                      disabled={item.required}
                      className="mt-1 w-5 h-5 rounded border-divider text-brand-primary focus:ring-2 focus:ring-brand-primary"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-text-primary">{item.title}</span>
                        {item.required && <span className="text-xs px-2 py-0.5 rounded bg-brand-primary/10 text-brand-primary">إلزامي</span>}
                      </div>
                      <p className="text-sm text-text-secondary mt-0.5">{item.desc}</p>
                    </div>
                  </label>
                ))}
                
                <Button type="submit" className="w-full" size="lg" loading={loading} disabled={!consents.dataProcessing}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                    <>ابدئي أول جلسة <ArrowRight className="w-4 h-4" /></>
                  )}
                </Button>
              </form>
            )}

            {/* Step 5: Complete */}
            {step === 5 && (
              <div className="text-center py-4 space-y-4">
                <div className="w-20 h-20 rounded-full bg-state-positive/10 flex items-center justify-center mx-auto">
                  <CheckCircle className="w-10 h-10 text-state-positive" />
                </div>
                <div>
                  <h3 className="font-heading text-2xl font-bold text-text-primary">أنت جاهزة!</h3>
                  <p className="text-text-secondary mt-2">ملفك الشخصي مكتمل، الموافقات مسجلة، خطة اليوم في انتظارك</p>
                </div>
                <Button onClick={handleComplete} className="w-full" size="xl">
                  <ArrowRight className="w-5 h-5" />
                  ابدئي أول جلسة
                </Button>
              </div>
            )}

            {/* Back button for steps 2-4 */}
            {step > 1 && step < 5 && (
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => { setStep(prev => prev - 1); setError(null); }}
              >
                رجوع
              </Button>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-text-muted mt-4">
          بالدخول، أنت توافقين على <Link href="/terms" className="underline hover:text-brand-primary">الشروط</Link> و
          <Link href="/privacy" className="underline hover:text-brand-primary">سياسة الخصوصية</Link>
        </p>
      </div>
    </div>
  );
}