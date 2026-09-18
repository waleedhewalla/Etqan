'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BrandMark } from '@/components/BrandMark';
import { Button, Input, Card, CardContent, CardHeader, CardTitle, CardDescription } from '@itqan/ui';
import { Mail, Lock, Eye, EyeOff, Loader2, Shield, UserCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

export default function FacultyLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'password' | 'magic-link'>('password');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    
    try {
      if (mode === 'password') {
        // In real app, this would be a proper login endpoint
        // For now, simulate with magic link verification
        throw new Error('استخدمي رابط الدخول السحري');
      } else {
        await api.magicLink(email);
        toast.success('أُرسل رابط الدخول إلى بريدك الإلكتروني');
        setMode('password'); // Reset
      }
    } catch (err: any) {
      if (err.message !== 'استخدمي رابط الدخول السحري') {
        setError(err.response?.data?.detail || err.message || 'حدث خطأ، حاول مرة أخرى');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleMagicLinkVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    // In real app, this would verify the token from URL params
    // For demo, we'll simulate
    setLoading(true);
    try {
      const token = new URLSearchParams(window.location.search).get('token');
      if (token) {
        const res = await api.verifyMagicLink(token);
        localStorage.setItem('itqan_token', res.data.accessToken);
        localStorage.setItem('itqan_user', JSON.stringify(res.data.user));
        router.push('/dashboard/teacher');
      } else {
        setError('رابط الدخول غير صحيح أو منتهي الصلاحية');
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || 'رابط الدخول غير صحيح');
    } finally {
      setLoading(false);
    }
  };

  // Check for magic link token in URL
  if (typeof window !== 'undefined') {
    const token = new URLSearchParams(window.location.search).get('token');
    if (token && mode === 'password') {
      handleMagicLinkVerify(new Event('submit'));
    }
  }

  return (
    <div className="min-h-screen bg-surface-canvas flex items-start justify-center py-8 px-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-5">
          <Link href="/" className="inline-flex justify-center mb-3 cursor-pointer" aria-label="إتقان">
            <BrandMark size="lg" />
          </Link>
          <h1 className="font-heading text-2xl font-bold text-text-primary">دخول هيئة التدريس</h1>
          <p className="text-text-secondary mt-2">لوحة متابعة الشعبة، مراجعة التسميع، والتدخلات الموجهة</p>
        </div>

        {/* Trust Badge */}
        <div className="mb-4 flex items-center justify-center gap-2 text-xs text-text-secondary">
          <Shield className="w-4 h-4 text-brand-primary" />
          <span>معتمد من عمادة كلية الأزهر للبنات</span>
        </div>

        {/* Login Card */}
        <Card className="overflow-hidden">
          <CardHeader className="text-center pb-2">
            <CardTitle className="font-heading text-xl">{mode === 'password' ? 'البريد الإلكتروني وكلمة المرور' : 'رابط الدخول السحري'}</CardTitle>
            <CardDescription className="text-text-secondary">
              {mode === 'password' 
                ? 'أدخلي بياناتك للدخول' 
                : 'أدخلي بريدك الإلكتروني لإرسال رابط دخول آمن'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm flex items-center gap-2" role="alert">
                <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 001.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="البريد الإلكتروني المؤسسي"
                type="email"
                placeholder="faculty@azhar.edu.eg"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                leftIcon={<Mail className="w-5 h-5" />}
                required
                autoComplete="email"
                disabled={loading}
              />

              {mode === 'password' && (
                <div className="relative">
                  <Input
                    label="كلمة المرور"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    leftIcon={<Lock className="w-5 h-5" />}
                    required
                    autoComplete="current-password"
                    disabled={loading}
                  />
                  <button
                    type="button"
                    className="absolute left-3 top-[38px] text-text-muted hover:text-text-primary"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              )}

              <Button type="submit" className="w-full" size="lg" loading={loading}>
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                  mode === 'password' ? 'دخولي' : 'أرسلي رابط الدخول'
                )}
              </Button>
            </form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-divider" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-surface-elevated text-text-muted">أو</span>
              </div>
            </div>

            <Button
              variant="ghost"
              className="w-full"
              onClick={() => setMode(mode === 'password' ? 'magic-link' : 'password')}
            >
              {mode === 'password' ? (
                <>
                  <Mail className="w-4 h-4 mr-2" />
                  أرسلي لي رابط دخول سحري
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4 mr-2" />
                  استخدمي البريد وكلمة المرور
                </>
              )}
            </Button>

            <div className="pt-2">
              <div className="flex items-center justify-center gap-2 text-sm text-text-secondary">
                <UserCheck className="w-4 h-4 text-brand-primary" />
                <span>الدخول عبر SSO المؤسسي (قريباً)</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="mt-4 text-center text-sm text-text-secondary">
          <p>هل نسيت كلمة المرور؟ <button className="text-brand-primary hover:underline font-medium">أعيدي تعيينها</button></p>
          <p className="mt-1">مشكلات في الدخول؟ <button className="text-brand-primary hover:underline font-medium">تواصلي مع الدعم</button></p>
        </div>
      </div>
    </div>
  );
}