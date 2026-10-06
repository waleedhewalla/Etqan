'use client';

import { useState } from 'react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@itqan/ui';
import { GraduationCap, Lock, Volume2, BookOpen, CheckCircle2 } from 'lucide-react';

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

// Tajweed Interactive Learning Objects (RLOs)
const tajweedRLOs = [
  {
    id: 'ghunnah',
    nameAr: 'الغنّة',
    transliteration: 'Ghunnah',
    category: 'noon_sakinah' as const,
    color: '#2D6A4F',
    descriptionAr: 'صوت أغنّ يخرج من الخيشوم بمقدار حركتين عند النون المشددة والميم المشددة',
    exampleText: 'إِنَّ ٱللَّهَ وَمَلَـٰٓئِكَتَهُۥ يُصَلُّونَ عَلَى ٱلنَّبِىِّ',
    exampleRef: 'الأحزاب: ٥٦',
    mastery: 85,
  },
  {
    id: 'madd-jaiz',
    nameAr: 'المد الجائز المنفصل',
    transliteration: 'Madd Jā\'iz Munfaṣil',
    category: 'madd' as const,
    color: '#6B4C9A',
    descriptionAr: 'مدّ بمقدار ٤ أو ٥ حركات عند التقاء حرف المد بهمزة في كلمة أخرى',
    exampleText: 'يَـٰٓأَيُّهَا ٱلنَّاسُ ٱتَّقُوا۟ رَبَّكُمُ',
    exampleRef: 'النساء: ١',
    mastery: 72,
  },
  {
    id: 'qalqalah',
    nameAr: 'القلقلة',
    transliteration: 'Qalqalah',
    category: 'qalqalah' as const,
    color: '#C05621',
    descriptionAr: 'اضطراب صوت الحرف الساكن حتى يُسمع له نبرة قوية. حروفها: ق ط ب ج د',
    exampleText: 'قُلْ أَعُوذُ بِرَبِّ ٱلْفَلَقِ',
    exampleRef: 'الفلق: ١',
    mastery: 90,
  },
  {
    id: 'idgham-ghunnah',
    nameAr: 'الإدغام بغنّة',
    transliteration: 'Idghām bi Ghunnah',
    category: 'noon_sakinah' as const,
    color: '#1A7F64',
    descriptionAr: 'إدغام النون الساكنة أو التنوين في أحد حروف (ينمو) مع غنّة بمقدار حركتين',
    exampleText: 'مِن مَّآءٍ مَّهِينٍ',
    exampleRef: 'المرسلات: ٢٠',
    mastery: 68,
  },
  {
    id: 'ikhfa',
    nameAr: 'الإخفاء الحقيقي',
    transliteration: 'Ikhfā\' Ḥaqīqī',
    category: 'noon_sakinah' as const,
    color: '#2E86AB',
    descriptionAr: 'إخفاء النون الساكنة أو التنوين عند ١٥ حرفاً مع غنّة. بين الإظهار والإدغام',
    exampleText: 'مِنْ قَبْلِ أَن تَأْتِيَهُمُ',
    exampleRef: 'يونس: ٩٧',
    mastery: 55,
  },
  {
    id: 'iqlab',
    nameAr: 'الإقلاب',
    transliteration: 'Iqlāb',
    category: 'noon_sakinah' as const,
    color: '#D4A843',
    descriptionAr: 'قلب النون الساكنة أو التنوين ميماً مخفاة عند الباء مع غنّة بمقدار حركتين',
    exampleText: 'سَمِيعٌۢ بَصِيرٌ',
    exampleRef: 'الإسراء: ١',
    mastery: 78,
  },
  {
    id: 'izhar',
    nameAr: 'الإظهار الحلقي',
    transliteration: 'Iẓhār Ḥalqī',
    category: 'noon_sakinah' as const,
    color: '#6C757D',
    descriptionAr: 'إظهار النون الساكنة أو التنوين بدون غنّة عند أحد حروف الحلق الستة: ء هـ ع ح غ خ',
    exampleText: 'مِنْ خَيْرٍ',
    exampleRef: 'البقرة: ١٩٧',
    mastery: 92,
  },
  {
    id: 'madd-lazim',
    nameAr: 'المد اللازم',
    transliteration: 'Madd Lāzim',
    category: 'madd' as const,
    color: '#8B2252',
    descriptionAr: 'مدّ بمقدار ٦ حركات وجوباً عند التقاء حرف المد بسكون أصلي في كلمة واحدة',
    exampleText: 'الٓمٓ • الٓمٓصٓ',
    exampleRef: 'البقرة: ١',
    mastery: 60,
  },
];

export function CurriculumTracks({ onOpenMushaf }: { onOpenMushaf?: () => void }) {
  const [tab, setTab] = useState('tajweed');
  const [expandedRLO, setExpandedRLO] = useState<string | null>(null);
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

      {/* Tajweed Interactive Learning Objects */}
      {tab === 'tajweed' && (
        <div className="space-y-4">
          <div>
            <h3 className="font-heading text-xl font-bold text-brand-primary mb-1 flex items-center gap-2">
              <BookOpen className="w-5 h-5" />
              مكتبة أحكام التجويد التفاعلية
            </h3>
            <p className="text-text-secondary text-sm mb-4">
              تعلّمي أحكام التلاوة مع الأمثلة القرآنية والتسجيلات الصوتية
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {tajweedRLOs.map((rlo) => (
              <Card
                key={rlo.id}
                className={`cursor-pointer transition-all duration-200 hover:shadow-md ${
                  expandedRLO === rlo.id ? 'ring-2 ring-brand-primary/30' : ''
                }`}
                onClick={() => setExpandedRLO(expandedRLO === rlo.id ? null : rlo.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: rlo.color }}
                      />
                      <div>
                        <h4 className="font-heading font-bold text-text-primary">{rlo.nameAr}</h4>
                        <p className="text-xs text-text-muted">{rlo.transliteration}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-12 h-1.5 rounded-full bg-surface-canvas overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${rlo.mastery}%`,
                            backgroundColor: rlo.mastery >= 80 ? '#2D6A4F' : rlo.mastery >= 60 ? '#D4A843' : '#C05621',
                          }}
                        />
                      </div>
                      <span className="text-xs text-text-muted">{rlo.mastery}%</span>
                    </div>
                  </div>

                  {expandedRLO === rlo.id && (
                    <div className="mt-3 space-y-3 animate-fade-in">
                      <p className="text-sm text-text-secondary">{rlo.descriptionAr}</p>
                      <div className="p-3 rounded-lg bg-surface-canvas border border-divider">
                        <p className="text-xs text-text-muted mb-1">مثال قرآني — {rlo.exampleRef}</p>
                        <p className="font-quran text-lg text-text-primary leading-loose">{rlo.exampleText}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={(e) => { e.stopPropagation(); }}
                        >
                          <Volume2 className="w-4 h-4 ml-1" />
                          استمع للمثال الصوتي
                        </Button>
                        {rlo.mastery >= 80 && (
                          <span className="flex items-center gap-1 text-xs text-state-positive">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            مُتقن
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Hifz tracks (original content) */}
      {tab === 'hifz' && (
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
      )}

      {/* Mutashabihat tab */}
      {tab === 'mutashabihat' && (
        <div className="text-center py-8">
          <p className="text-text-secondary">سيتم فتح هذا المحتوى عند وصول آيات متشابهة في خطتك</p>
          <Button variant="secondary" className="mt-3" onClick={onOpenMushaf}>العودة إلى المصحف</Button>
        </div>
      )}
    </section>
  );
}
