'use client';

import { Button } from '@itqan/ui';
import { BookOpen, RefreshCw } from 'lucide-react';
import { IconTile } from './IconTile';

export function SessionTypePicker({
  onNew,
  onReview,
}: {
  onNew?: () => void;
  onReview?: () => void;
}) {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <article className="surface-card p-5 text-center">
        <div className="flex justify-center mb-3">
          <IconTile icon={BookOpen} size="lg" />
        </div>
        <h3 className="font-heading text-2xl font-bold text-brand-primary mb-2">حفظ جديد من المصحف</h3>
        <p className="text-text-secondary font-normal mb-3">
          ابدئي من خطة اليوم: آيات جديدة، ثم ترسيخ. قراءة المستحفظ ووضع الاستذكار النشط.
        </p>
        <div className="flex flex-wrap justify-center gap-2 mb-4 text-xs text-brand-primary">
          <span className="px-3 py-1 rounded-full bg-brand-primary/10">كل السور المقررة</span>
          <span className="px-3 py-1 rounded-full bg-brand-primary/10">استذكار نشط</span>
          <span className="px-3 py-1 rounded-full bg-brand-primary/10">تلاوة عمياء</span>
        </div>
        <Button onClick={onNew}>ابدئي</Button>
      </article>
      <article className="surface-card p-5 text-center">
        <div className="flex justify-center mb-3">
          <IconTile icon={RefreshCw} glyph="rings" size="lg" />
        </div>
        <h3 className="font-heading text-2xl font-bold text-brand-primary mb-2">مراجعة وترسيخ</h3>
        <p className="text-text-secondary font-normal mb-3">
          مراجعة طويلة المدى، متشابهات مستحقة، وتعافي رحيم إن فاتتك جلسة أمس.
        </p>
        <div className="flex flex-wrap justify-center gap-2 mb-4 text-xs text-brand-primary">
          <span className="px-3 py-1 rounded-full bg-brand-primary/10">مراجعة اليوم</span>
          <span className="px-3 py-1 rounded-full bg-brand-primary/10">متشابهات</span>
          <span className="px-3 py-1 rounded-full bg-brand-primary/10">خطة تعويض</span>
        </div>
        <Button variant="outline" onClick={onReview}>ابدئي</Button>
      </article>
    </div>
  );
}
