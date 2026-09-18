'use client';

import { useState } from 'react';
import { Button } from '@itqan/ui';

export function FeedbackForm() {
  const [name, setName] = useState('');
  const [role, setRole] = useState('طالبة');
  const [rating, setRating] = useState('ممتاز');
  const [opinion, setOpinion] = useState('');
  const [captcha, setCaptcha] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !opinion.trim()) {
      setError('الاسم ونص الرأي مطلوبان');
      return;
    }
    const normalized = captcha.replace(/\s/g, '');
    if (normalized !== 'إتقان' && normalized !== 'اتقان') {
      setError('أدخلي رمز التحقق كما يظهر: إتقان');
      return;
    }
    setSent(true);
  };

  const fieldClass =
    'w-full rounded-lg border border-white/10 bg-[#132E24] text-surface-canvas placeholder:text-surface-canvas/40 py-2.5 px-4 min-h-[44px]';
  const labelClass = 'block text-sm font-medium mb-1.5 text-surface-canvas';

  if (sent) {
    return (
      <div className="rounded-2xl border border-brand-accent/30 bg-brand-primary p-5 text-surface-canvas text-center">
        <p className="font-heading text-2xl font-bold mb-2">شكراً لمشاركتك</p>
        <p className="font-normal text-surface-canvas/80">تم حفظ رأيك في هذه الجلسة. لن يُنشر دون مراجعة.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-brand-accent/20 bg-brand-primary p-5 md:p-6 text-surface-canvas space-y-4">
      <h3 className="font-heading text-2xl font-bold text-right">شاركنا تجربتك ورأيك</h3>
      {error && (
        <p className="text-sm bg-black/20 rounded-xl px-3 py-2" role="alert">
          {error}
        </p>
      )}
      <div className="grid md:grid-cols-2 gap-4">
        <label className="block">
          <span className={labelClass}>الاسم الكامل *</span>
          <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="block">
          <span className={labelClass}>الصفة / الجهة</span>
          <select value={role} onChange={(e) => setRole(e.target.value)} className={`${fieldClass} cursor-pointer`}>
            <option>طالبة</option>
            <option>معلمة / محفّظة</option>
            <option>هيئة تدريس</option>
          </select>
        </label>
      </div>
      <label className="block">
        <span className={labelClass}>التقييم</span>
        <select value={rating} onChange={(e) => setRating(e.target.value)} className={`${fieldClass} cursor-pointer`}>
          <option>ممتاز</option>
          <option>جيد جداً</option>
          <option>جيد</option>
          <option>يحتاج تحسين</option>
        </select>
      </label>
      <label className="block">
        <span className={labelClass}>نص الرأي *</span>
        <textarea
          className={`${fieldClass} min-h-[120px] resize-y`}
          value={opinion}
          onChange={(e) => setOpinion(e.target.value)}
          placeholder="اكتبي رأيك هنا..."
          required
        />
      </label>
      <div>
        <p className="text-sm mb-1.5">كود التحقق البشري *</p>
        <div className="flex flex-wrap items-center gap-3">
          <span className="px-4 py-2 rounded-xl bg-brand-accent/20 text-brand-accent font-heading tracking-[0.35em]">إ ت ق ن</span>
          <input
            className={`${fieldClass} max-w-xs`}
            value={captcha}
            onChange={(e) => setCaptcha(e.target.value)}
            placeholder="أدخلي الرموز"
            aria-label="كود التحقق"
          />
        </div>
      </div>
      <Button type="submit" className="bg-brand-accent text-brand-primary hover:bg-brand-accent/90">
        إرسال التقييم
      </Button>
    </form>
  );
}