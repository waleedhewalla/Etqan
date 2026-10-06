'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@itqan/ui';
import {
  BookOpen, Users, Shield, Award, CheckCircle,
  Sparkles, Star, ArrowLeft, Mic, BarChart3, GraduationCap,
} from 'lucide-react';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { IconTile } from '@/components/IconTile';
import { FeedbackForm } from '@/components/FeedbackForm';

function GeometricPattern({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g opacity="0.15" stroke="currentColor" strokeWidth="0.5">
        <polygon points="100,10 190,60 190,140 100,190 10,140 10,60" />
        <polygon points="100,30 170,70 170,130 100,170 30,130 30,70" />
        <polygon points="100,50 150,80 150,120 100,150 50,120 50,80" />
        <line x1="100" y1="10" x2="100" y2="190" />
        <line x1="10" y1="60" x2="190" y2="140" />
        <line x1="190" y1="60" x2="10" y2="140" />
        <circle cx="100" cy="100" r="40" />
        <circle cx="100" cy="100" r="60" />
        <circle cx="100" cy="100" r="80" />
      </g>
    </svg>
  );
}

function StarDecoration({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" fill="none">
      <g opacity="0.2" stroke="currentColor" strokeWidth="0.75">
        <polygon points="50,5 61,35 95,35 68,57 79,90 50,70 21,90 32,57 5,35 39,35" />
        <circle cx="50" cy="50" r="20" />
      </g>
    </svg>
  );
}

const features = [
  {
    icon: BookOpen,
    title: 'المصحف التفاعلي',
    description: 'خط عثماني حفص مع وضع الاستذكار النشط والتلاوة العمياء',
    gradient: 'from-emerald-500/10 to-teal-500/10',
  },
  {
    icon: Mic,
    title: 'تسميع ذكي',
    description: 'تسجيل صوتي مع تحليل فوري للأخطاء الخفية والجلية',
    gradient: 'from-amber-500/10 to-orange-500/10',
  },
  {
    icon: BarChart3,
    title: 'متابعة بأربعة أبعاد',
    description: 'إتقان صوتي، دلالي، موضعي، واستقرار — رؤية شاملة لتقدمك',
    gradient: 'from-blue-500/10 to-indigo-500/10',
  },
  {
    icon: Users,
    title: 'متابعة المعلمة',
    description: 'طابور تسميع، ملاحظات منظمة، تدخلات موجهة، وتقارير أسبوعية',
    gradient: 'from-purple-500/10 to-pink-500/10',
  },
  {
    icon: Shield,
    title: 'حوكمة علمية صارمة',
    description: 'محتوى معتمد من شيخ مراجع — لا محتوى مولد بالذكاء الاصطناعي',
    gradient: 'from-emerald-500/10 to-green-500/10',
  },
  {
    icon: Award,
    title: 'شهادات معتمدة',
    description: 'شهادات إتمام قابلة للتحقق ومعتمدة من المؤسسة',
    gradient: 'from-amber-500/10 to-yellow-500/10',
  },
];

const stats = [
  { value: '٦٢٣٦', label: 'آية قرآنية', icon: BookOpen },
  { value: '١١٤', label: 'سورة كريمة', icon: Star },
  { value: '٤', label: 'أبعاد إتقان', icon: Sparkles },
  { value: '١٢', label: 'دورًا في المنصة', icon: GraduationCap },
];

const steps = [
  { num: '١', title: 'انضمي بدعوة', desc: 'أدخلي كود الشعبة من معلمتك ورقم الواتساب', icon: Users },
  { num: '٢', title: 'ابدئي خطة اليوم', desc: 'جديد، ترسيخ، ومراجعة طويلة المدى — مخصصة لك', icon: BookOpen },
  { num: '٣', title: 'تسميع ومتابعة', desc: 'سجّلي تلاوتك واحصلي على تغذية راجعة فورية', icon: Mic },
  { num: '٤', title: 'تقدّمي بثقة', desc: 'شهادات معتمدة وتقارير جاهزة عند الإتمام', icon: Award },
];

const trustBadges = [
  { label: 'اعتماد كلية الأزهر للبنات', icon: GraduationCap },
  { label: 'نموذج وقف تعليمي غير ربحي', icon: Star },
  { label: 'حماية البيانات الشخصية', icon: Shield },
  { label: 'محتوى معتمد من لجنة علمية', icon: CheckCircle },
  { label: 'صوت فقط — لا كاميرا إلزامية', icon: Mic },
  { label: 'دخول بدعوة فقط — لا تسجيل عام', icon: Users },
];

function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.add('not-visible');
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.remove('not-visible');
          observer.unobserve(el);
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return ref;
}

function RevealSection({ children, className = '', delay = '' }: {
  children: React.ReactNode;
  className?: string;
  delay?: string;
}) {
  const ref = useReveal();
  return (
    <div ref={ref} className={`reveal ${delay} ${className}`}>
      {children}
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-surface-canvas">
      <SiteHeader />

      <main className="flex-1">
        {/* ===== HERO ===== */}
        <section className="hero-gradient min-h-[88vh] flex items-center relative">
          {/* Decorative geometric patterns (static for performance) */}
          <GeometricPattern className="absolute top-10 right-10 w-48 h-48 text-brand-accent opacity-60" />
          <GeometricPattern className="absolute bottom-32 left-10 w-36 h-36 text-white opacity-40" />
          <StarDecoration className="absolute top-1/4 left-1/4 w-20 h-20 text-brand-accent" />
          <StarDecoration className="absolute bottom-1/3 right-1/4 w-16 h-16 text-white" />

          <div className="container-main relative z-10 pt-20 pb-12 md:pt-24 md:pb-20">
            <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
              {/* Text side */}
              <div className="text-center lg:text-right order-2 lg:order-1">
                <div
                  className="animate-hero-text inline-flex items-center gap-2 glass-card text-white/90 px-5 py-2.5 rounded-full text-sm font-medium mb-6"
                  style={{ animationDelay: '200ms', opacity: 0 }}
                >
                  <Sparkles className="w-4 h-4 text-brand-accent" />
                  نسخة تجريبية لكلية الأزهر للبنات — العاشر من رمضان
                </div>

                <h1
                  className="animate-hero-text font-heading text-4xl md:text-5xl lg:text-[3.5rem] xl:text-[4rem] font-bold text-white leading-[1.3] mb-6 text-balance hero-glow"
                  style={{ animationDelay: '400ms', opacity: 0 }}
                >
                  رحلتك في حفظ القرآن
                  <span className="block text-brand-accent mt-2">تبدأ من هنا</span>
                </h1>

                <p
                  className="animate-hero-text text-lg md:text-xl text-white/75 mb-8 max-w-lg mx-auto lg:mx-0 leading-relaxed"
                  style={{ animationDelay: '600ms', opacity: 0 }}
                >
                  منصة ذكية تجمع بين التكرار المتباعد وإشراف المعلمة ــ
                  بحوكمة علمية صارمة ونموذج وقف تعليمي لا يهدف للربح
                </p>

                <div
                  className="animate-hero-text flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4 mb-8"
                  style={{ animationDelay: '800ms', opacity: 0 }}
                >
                  <Link href="/auth/join">
                    <Button size="xl" className="bg-brand-accent text-brand-primary hover:bg-brand-accent/90 font-bold px-8 py-4 text-lg shadow-lg shadow-brand-accent/20 transition-all hover:shadow-xl hover:shadow-brand-accent/30 hover:-translate-y-0.5">
                      ابدئي رحلتك الآن
                      <ArrowLeft className="w-5 h-5 mr-2 rtl:rotate-180" />
                    </Button>
                  </Link>
                  <Link href="#how-it-works">
                    <Button variant="outline" size="xl" className="border-white/30 text-white hover:bg-white/10 px-8 py-4 text-lg">
                      شاهدي كيف تعمل
                    </Button>
                  </Link>
                </div>

                <div
                  className="animate-hero-text flex flex-wrap items-center justify-center lg:justify-start gap-x-6 gap-y-2 text-sm text-white/60"
                  style={{ animationDelay: '1000ms', opacity: 0 }}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-brand-accent/70" />
                    لا تسجيل بدون دعوة
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-brand-accent/70" />
                    صوت فقط — لا كاميرا
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-brand-accent/70" />
                    تعمل دون إنترنت
                  </span>
                </div>
              </div>

              {/* Quran image + overlay card */}
              <div className="order-1 lg:order-2 flex justify-center">
                <div
                  className="animate-hero-card relative w-full max-w-md"
                  style={{ animationDelay: '500ms', opacity: 0 }}
                >
                  {/* Quran image */}
                  <div className="relative rounded-3xl overflow-hidden mushaf-card-glow">
                    <Image
                      src="/images/quran-hero.jpg"
                      alt="القرآن الكريم مفتوح"
                      width={1260}
                      height={750}
                      className="w-full h-auto object-cover"
                      priority
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
                    <div className="absolute inset-0 rounded-3xl pointer-events-none" />
                  </div>

                  {/* Floating mini card */}
                  <div className="absolute -bottom-4 left-4 right-4 glass-card-light rounded-2xl p-4 shadow-xl">
                    <div className="font-quran text-xl text-brand-primary text-center leading-loose mb-2">
                      بسم الله الرحمن الرحيم
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-text-muted">٣ جديدة + ١٢ مراجعة</span>
                      <div className="h-1.5 w-20 bg-divider/50 rounded-full overflow-hidden">
                        <div className="h-full w-[40%] bg-gradient-to-l from-brand-accent to-state-positive rounded-full" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ===== STATS BAR ===== */}
        <section className="relative -mt-16 z-20 pb-6">
          <div className="container-main">
            <RevealSection>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                {stats.map((stat) => (
                  <div key={stat.label} className="stat-card rounded-2xl p-5 text-center glass-card-light">
                    <stat.icon className="w-6 h-6 text-brand-accent mx-auto mb-2" />
                    <div className="font-heading text-3xl md:text-4xl font-bold text-brand-primary mb-1">
                      {stat.value}
                    </div>
                    <div className="text-sm text-text-secondary">{stat.label}</div>
                  </div>
                ))}
              </div>
            </RevealSection>
          </div>
        </section>

        {/* ===== DUAL CTA ===== */}
        <section className="py-6 md:py-10">
          <div className="container-main">
            <div className="grid md:grid-cols-2 gap-5">
              <RevealSection>
                <article className="feature-card glass-card-light rounded-3xl p-6 text-center group cursor-pointer">
                  <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-brand-primary to-state-positive flex items-center justify-center transition-transform group-hover:scale-110">
                    <BookOpen className="w-7 h-7 text-white" />
                  </div>
                  <h3 className="font-heading text-2xl font-bold text-brand-primary mb-2">انضمي كطالبة</h3>
                  <p className="text-text-secondary mb-4 leading-relaxed">
                    كود الدعوة من معلمتك هو كل ما تحتاجينه.<br />
                    لا تسجيل عام، ولا اشتراك مدفوع.
                  </p>
                  <Link href="/auth/join">
                    <Button variant="outline" size="lg">الدخول بكود الشعبة</Button>
                  </Link>
                </article>
              </RevealSection>
              <RevealSection delay="reveal-delay-2">
                <article className="feature-card glass-card-light rounded-3xl p-6 text-center group cursor-pointer">
                  <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-brand-accent to-state-attention flex items-center justify-center transition-transform group-hover:scale-110">
                    <Users className="w-7 h-7 text-white" />
                  </div>
                  <h3 className="font-heading text-2xl font-bold text-brand-primary mb-2">دخول هيئة التدريس</h3>
                  <p className="text-text-secondary mb-4 leading-relaxed">
                    لوحة متابعة الشعبة، مراجعة التسميع،<br />
                    والتدخلات الموجهة — للأستاذات المعتمدات.
                  </p>
                  <Link href="/auth/login/faculty">
                    <Button size="lg">دخول المعلمات</Button>
                  </Link>
                </article>
              </RevealSection>
            </div>
          </div>
        </section>

        {/* ===== HOW IT WORKS ===== */}
        <section id="how-it-works" className="py-10 md:py-14 bg-brand-primary relative overflow-hidden">
          <GeometricPattern className="absolute top-0 left-0 w-64 h-64 text-white opacity-[0.04]" />
          <GeometricPattern className="absolute bottom-0 right-0 w-48 h-48 text-brand-accent opacity-[0.06]" />

          <div className="container-main relative z-10">
            <RevealSection>
              <div className="text-center mb-8">
                <h2 className="font-heading text-3xl md:text-4xl font-bold text-white mb-2">
                  كيف تعمل إتقان؟
                </h2>
                <p className="text-white/60 text-lg max-w-xl mx-auto">
                  أربع خطوات بسيطة تفصلك عن بداية رحلة حفظ منظمة ومتابَعة
                </p>
              </div>
            </RevealSection>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {steps.map((step, i) => (
                <RevealSection key={step.title} delay={`reveal-delay-${i + 1}` as any}>
                  <div className="glass-card rounded-2xl p-5 text-center group hover:-translate-y-1 transition-all duration-300">
                    <div className="w-11 h-11 mx-auto mb-3 rounded-xl bg-brand-accent/20 text-brand-accent flex items-center justify-center font-heading text-2xl font-bold">
                      {step.num}
                    </div>
                    <step.icon className="w-7 h-7 text-white/50 mx-auto mb-2" />
                    <h3 className="font-heading text-lg font-bold text-white mb-2">{step.title}</h3>
                    <p className="text-white/60 text-sm leading-relaxed">{step.desc}</p>
                  </div>
                </RevealSection>
              ))}
            </div>
          </div>
        </section>

        {/* ===== FEATURES ===== */}
        <section id="features" className="py-10 md:py-14">
          <div className="container-main">
            <RevealSection>
              <div className="text-center mb-8">
                <h2 className="font-heading text-3xl md:text-4xl font-bold text-text-primary mb-2 text-balance">
                  مميزات مصممة لحفظ القرآن
                </h2>
                <p className="text-text-secondary text-lg max-w-xl mx-auto">
                  كل أداة بُنيت لتخدم هدفًا واحدًا: أن تحفظي بإتقان وتثبتي بيقين
                </p>
              </div>
            </RevealSection>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
              {features.map((feature, i) => (
                <RevealSection key={feature.title} delay={`reveal-delay-${(i % 3) + 1}` as any}>
                  <div className={`feature-card rounded-2xl p-5 bg-gradient-to-br ${feature.gradient} border border-divider/50 glass-card-light`}>
                    <div className="w-11 h-11 rounded-xl bg-brand-primary flex items-center justify-center mb-3">
                      <feature.icon className="w-6 h-6 text-white" />
                    </div>
                    <h3 className="font-heading text-xl font-bold text-text-primary mb-2">{feature.title}</h3>
                    <p className="text-text-secondary text-sm leading-relaxed">{feature.description}</p>
                  </div>
                </RevealSection>
              ))}
            </div>
          </div>
        </section>

        {/* ===== STUDENT + TEACHER JOURNEY ===== */}
        <section className="py-10 md:py-14 bg-surface-elevated/60">
          <div className="container-main">
            <RevealSection>
              <div className="text-center mb-8">
                <h2 className="font-heading text-3xl md:text-4xl font-bold text-text-primary mb-2">
                  تجربة مصممة لكل دور
                </h2>
              </div>
            </RevealSection>

            <div className="grid md:grid-cols-2 gap-5">
              <RevealSection>
                <div className="feature-card glass-card-light rounded-3xl p-5 md:p-7 h-full">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-brand-primary to-state-positive flex items-center justify-center">
                      <BookOpen className="w-5 h-5 text-white" />
                    </div>
                    <h3 className="font-heading text-2xl font-bold text-brand-primary">رحلة الطالبة</h3>
                  </div>
                  <div className="space-y-3">
                    {[
                      { title: 'خطة يومية واضحة', desc: '"اليوم: ٣ آيات جديدة + ١٢ مراجعة"' },
                      { title: 'استذكار نشط', desc: 'إخفاء أواخر الآيات للتسميع الذاتي' },
                      { title: 'تغذية راجعة فورية', desc: 'علامات على الأخطاء مع تلاوة مرجعية' },
                      { title: 'تعافٍ رحيم', desc: '"فاتتك جلسة؟ استأنفي بخطة ٧ دقائق"' },
                    ].map((item) => (
                      <div key={item.title} className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-state-positive/10 flex items-center justify-center shrink-0 mt-0.5">
                          <CheckCircle className="w-3.5 h-3.5 text-state-positive" />
                        </div>
                        <div>
                          <span className="font-bold text-text-primary text-sm">{item.title}</span>
                          <span className="text-text-secondary text-sm"> — {item.desc}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </RevealSection>

              <RevealSection delay="reveal-delay-2">
                <div className="feature-card glass-card-light rounded-3xl p-5 md:p-7 h-full">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-brand-accent to-state-attention flex items-center justify-center">
                      <Users className="w-5 h-5 text-white" />
                    </div>
                    <h3 className="font-heading text-2xl font-bold text-brand-primary">مساحة المعلمة</h3>
                  </div>
                  <div className="space-y-3">
                    {[
                      { title: 'لوحة صحة الشعبة', desc: 'توزيع ARI، أول ٥ حالات، متشابهات ضعيفة' },
                      { title: 'تفتيش طالبة', desc: 'إتقان ٤ أبعاد، تاريخ طلاقة، حالات' },
                      { title: 'تدخل بنقرة', desc: 'قوالب رسائل معدة، حجز موعد، إحالة' },
                      { title: 'تقارير جاهزة', desc: 'PDF للاجتماعات، مقارنة مع شعبة ضابطة' },
                    ].map((item) => (
                      <div key={item.title} className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-brand-accent/10 flex items-center justify-center shrink-0 mt-0.5">
                          <CheckCircle className="w-3.5 h-3.5 text-brand-accent" />
                        </div>
                        <div>
                          <span className="font-bold text-text-primary text-sm">{item.title}</span>
                          <span className="text-text-secondary text-sm"> — {item.desc}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </RevealSection>
            </div>
          </div>
        </section>

        {/* ===== TRUST ===== */}
        <section id="trust" className="py-10 md:py-14">
          <div className="container-main">
            <RevealSection>
              <div className="text-center mb-8">
                <h2 className="font-heading text-3xl md:text-4xl font-bold text-text-primary mb-2">
                  ثقة مؤسسة، أمان تام
                </h2>
                <p className="text-text-secondary text-lg max-w-2xl mx-auto">
                  كل قرار تقني يخضع لرقابة علمية، وكل بيانات محمية بأعلى المعايير
                </p>
              </div>
            </RevealSection>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {trustBadges.map((badge, i) => (
                <RevealSection key={badge.label} delay={`reveal-delay-${(i % 3) + 1}` as any}>
                  <div className="feature-card flex items-center gap-3 p-4 glass-card-light rounded-2xl">
                    <div className="w-11 h-11 rounded-xl bg-state-positive/10 flex items-center justify-center shrink-0">
                      <badge.icon className="w-5 h-5 text-state-positive" />
                    </div>
                    <span className="text-text-primary font-medium text-sm">{badge.label}</span>
                  </div>
                </RevealSection>
              ))}
            </div>
          </div>
        </section>

        {/* ===== VISION ===== */}
        <section className="py-10 md:py-14 bg-surface-elevated/60">
          <div className="container-main">
            <RevealSection>
              <div className="max-w-3xl mx-auto text-center space-y-6">
                <div>
                  <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-brand-primary/10 flex items-center justify-center">
                    <Star className="w-6 h-6 text-brand-primary" />
                  </div>
                  <h2 className="font-heading text-3xl font-bold text-brand-primary mb-3">رؤيتنا</h2>
                  <p className="text-lg text-text-primary">حافظي على تقدمك، خطوة بعد خطوة</p>
                </div>
                <div className="h-px bg-gradient-to-l from-transparent via-divider to-transparent" />
                <div>
                  <h2 className="font-heading text-3xl font-bold text-brand-accent mb-3">رسالتنا</h2>
                  <p className="text-lg text-text-primary leading-relaxed">
                    منصة تربط تعلم الطالبة بمتابعة المقرر ودعم هيئة التدريس،
                    بحوكمة علمية صارمة ونموذج وقف تعليمي لا يهدف للربح
                  </p>
                </div>
                <div className="h-px bg-gradient-to-l from-transparent via-divider to-transparent" />
                <div className="grid sm:grid-cols-3 gap-4 text-center">
                  <div className="p-4">
                    <div className="font-heading text-lg font-bold text-state-positive mb-1">خطة مخصصة</div>
                    <p className="text-sm text-text-secondary">متابعة إتقان بأربعة أبعاد</p>
                  </div>
                  <div className="p-4">
                    <div className="font-heading text-lg font-bold text-state-positive mb-1">تغذية فورية</div>
                    <p className="text-sm text-text-secondary">تلاوة مرجعية على الأخطاء</p>
                  </div>
                  <div className="p-4">
                    <div className="font-heading text-lg font-bold text-state-positive mb-1">تعافٍ رحيم</div>
                    <p className="text-sm text-text-secondary">بدون سلسلة مكسورة</p>
                  </div>
                </div>
              </div>
            </RevealSection>
          </div>
        </section>

        {/* ===== TESTIMONIALS ===== */}
        <section className="py-10 md:py-14 bg-brand-primary relative overflow-hidden">
          <GeometricPattern className="absolute top-0 right-0 w-40 h-40 text-brand-accent opacity-[0.05]" />
          <div className="container-main relative z-10">
            <RevealSection>
              <h2 className="font-heading text-3xl font-bold text-center text-white mb-6">آراء من داخل المسار</h2>
              <div className="grid md:grid-cols-2 gap-4 mb-6">
                <blockquote className="glass-card rounded-2xl p-5">
                  <p className="font-heading text-lg text-white mb-3 leading-relaxed">
                    &quot;لأول مرة أحس إن عندي خطة واضحة كل يوم — ٣ آيات جديدة و١٢ مراجعة، ومش محتاجة أفكر في إيه اللي بعد كده.&quot;
                  </p>
                  <footer className="text-brand-accent text-sm flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-brand-accent/20 flex items-center justify-center">
                      <GraduationCap className="w-4 h-4" />
                    </div>
                    طالبة في الفرقة الثانية
                  </footer>
                </blockquote>
                <blockquote className="glass-card rounded-2xl p-5">
                  <p className="font-heading text-lg text-white mb-3 leading-relaxed">
                    &quot;لوحة الشعبة وفّرت عليّا ساعات — بشوف أول ٥ حالات محتاجة تدخل ومش محتاجة أقلب كشوف.&quot;
                  </p>
                  <footer className="text-brand-accent text-sm flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-brand-accent/20 flex items-center justify-center">
                      <Users className="w-4 h-4" />
                    </div>
                    محفّظة — هيئة تدريس
                  </footer>
                </blockquote>
              </div>
            </RevealSection>
            <RevealSection>
              <FeedbackForm />
            </RevealSection>
          </div>
        </section>

        {/* ===== FINAL CTA ===== */}
        <section className="py-10 md:py-14">
          <div className="container-main">
            <RevealSection>
              <div className="max-w-3xl mx-auto text-center p-7 md:p-10 bg-gradient-to-br from-brand-primary via-brand-primary to-[#2D6A4F] rounded-3xl relative overflow-hidden">
                <GeometricPattern className="absolute top-0 left-0 w-32 h-32 text-white opacity-[0.06]" />
                <StarDecoration className="absolute bottom-4 right-4 w-20 h-20 text-brand-accent opacity-20" />
                <div className="relative z-10">
                  <Sparkles className="w-10 h-10 text-brand-accent mx-auto mb-3" />
                  <h2 className="font-heading text-3xl md:text-4xl font-bold text-white mb-3">
                    جاهزة للبدء؟
                  </h2>
                  <p className="text-white/80 text-lg mb-5 max-w-lg mx-auto leading-relaxed">
                    انضمي لبرنامج تجريبي في كلية الأزهر للبنات بالعاشر من رمضان.
                    كود الدعوة من معلمتك هو كل ما تحتاجينه.
                  </p>
                  <Link href="/auth/join">
                    <Button size="xl" className="bg-brand-accent text-brand-primary hover:bg-brand-accent/90 font-bold px-8 py-4 text-lg shadow-lg">
                      ادخلي كود الدعوة
                    </Button>
                  </Link>
                </div>
              </div>
            </RevealSection>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
