'use client';

import { useState } from 'react';
import { Badge, Button } from '@itqan/ui';
import { GraduationCap, Lock } from 'lucide-react';

const tracks = [
  {
    id: 'beginner',
    level: 'المبتدئين',
    title: 'الأحكام الأساسية لتلاوة القرآن الكريم',
    units: 'خطة اليوم: جديد + مراجعة',
    source: 'من مهام اليوم في لوحة الطالبة',
  },
  {
    id: 'intermediate',
    level: 'المتوسطين',
    title: 'الترسيخ والإتقان في السور المقررة',
    units: 'استذكار نشط ووضع التلاوة العمياء',
    source: 'من أوضاع المصحف التفاعلي',
  },
  {
    id: 'advanced',
    level: 'المتقدمين',
    title: 'إتقان الأبعاد الأربعة والمتشابهات',
    units: 'مقارنة الآيات المتشابهة والتسميع',
    source: 'من تبويب المتشابهات والكفايات',
  },
];

export function CurriculumTracks({ onOpenMushaf }: { onOpenMushaf?: () => void }) {
  const [tab, setTab] = useState('tajweed');
  const tabs = [
    { id: 'tajweed', label: 'التجويد وأحكام التلاوة' },
    { id: 'hifz', label: 'الحفظ والمراجعة' },
    { id: 'mutashabihat', label: 'المتشابهات' },
  ];

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-heading text-2xl font-bold text-brand-accent">المناهج التعليمية</h2>
        <p className="text-sm text-text-secondary">اختر للمتعلمة</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-full text-sm cursor-pointer min-h-[44px] transition-colors ${
              tab === t.id
                ? 'bg-brand-primary/10 text-brand-primary border border-brand-primary/20'
                : 'text-text-secondary hover:bg-surface-elevated'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div>
        <h3 className="font-heading text-xl font-bold text-brand-primary mb-2">مسارات الحفظ المعتمدة في إتقان</h3>
        <p className="text-text-secondary text-sm font-normal mb-4">
          هذه البطاقات تعرض المحتوى الحالي للمنصة (المصحف، الاستذكار، المتشابهات، والشهادات المعتمدة) دون إضافة مقررات خارج الخطة.
        </p>
        <div className="space-y-3">
          {tracks.map((track) => (
            <button
              key={track.id}
              type="button"
              onClick={onOpenMushaf}
              className="w-full surface-card px-5 py-4 flex items-center justify-between gap-4 text-right cursor-pointer hover:border-brand-primary/40 transition-colors"
            >
              <Badge variant="info" size="sm">{track.units}</Badge>
              <div className="flex-1">
                <p className="font-medium text-text-primary">{track.title}</p>
                <p className="text-xs text-text-secondary mt-1">{track.source}</p>
              </div>
              <span className="flex items-center gap-2 text-brand-primary font-medium">
                <GraduationCap className="w-4 h-4" />
                {track.level}
              </span>
            </button>
          ))}
          <div className="w-full surface-card px-5 py-4 flex items-center justify-between gap-4 text-text-secondary">
            <Badge variant="gold" size="sm">مقفلة حتى إكمال المسار</Badge>
            <p className="flex-1 font-medium">الشهادات المعتمدة من المؤسسة — قابلة للتحقق، ليست إجازة رواية</p>
            <span className="flex items-center gap-2">
              <Lock className="w-4 h-4" />
              الشهادة النهائية
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
