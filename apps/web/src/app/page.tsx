'use client';

import Link from 'next/link';
import { Button } from '@itqan/ui';
import { BookOpen, Users, Shield, Award, CheckCircle } from 'lucide-react';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { IconTile } from '@/components/IconTile';
import { StepConnector } from '@/components/StepConnector';
import { FeedbackForm } from '@/components/FeedbackForm';

const features = [
  {
    icon: BookOpen,
    title: 'المصحف التفاعلي',
    description: 'عرض مصحف المدينة النبوية بخط عثماني حفص، مع وضع الاستذكار النشط ووضع التلاوة العمياء',
  },
  {
    icon: Users,
    title: 'متابعة المعلمة',
    description: 'طابور مراجعة للتسميع، ملاحظات منظمة، تدخلات موجهة، وتقارير أسبوعية',
  },
  {
    icon: Shield,
    title: 'حوكمة علمية',
    description: 'محتوى معتمد من شيخ مراجع، لا محتوى مولد بالذكاء الاصطناعي، تدقيق كامل',
  },
  {
    icon: Award,
    title: 'شهادات معتمدة',
    description: 'شهادات إتمام معتمدة من المؤسسة، قابلة للتحقق، ليست إجازة رواية',
  },
];

const trustBadges = [
  { label: 'اعتماد عمادة كلية الأزهر للبنات', verified: true },
  { label: 'نموذج وقف تعليمي - لا تجاري', verified: true },
  { label: 'حماية البيانات الشخصية (PDPL)', verified: true },
  { label: 'محتوى معتمد من لجنة علمية', verified: true },
  { label: 'إتاحة للوصول (WCAG 2.2)', verified: true },
];

const whyItems = [
  { icon: Users, title: 'نخبة من المعلمات', text: 'متابعة المعلمة: طابور مراجعة للتسميع، ملاحظات منظمة، تدخلات موجهة، وتقارير أسبوعية.' },
  { icon: Shield, title: 'حوكمة علمية صارمة', text: 'محتوى معتمد من شيخ مراجع، لا محتوى مولد بالذكاء الاصطناعي، تدقيق كامل.' },
  { icon: Award, title: 'شهادات قابلة للتحقق', text: 'شهادات إتمام معتمدة من المؤسسة، قابلة للتحقق، ليست إجازة رواية.' },
  { icon: BookOpen, title: 'خطة يومية مرنة', text: 'خطة يومية مخصصة: جديد، ترسيخ، ومراجعة طويلة المدى — مع إمكانية التعافي الرحيم.' },
  { icon: CheckCircle, title: 'خصوصية صوتية', text: 'صوت فقط - لا كاميرا إلزامية. تسجيل التسميع يُحذف وفق الموافقات.' },
  { icon: Shield, title: 'دخول بدعوة فقط', text: 'لا تسجيل بدون دعوة. كود الشعبة من معلمتك هو مدخل المنصة.' },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-surface-canvas">
      <SiteHeader />

      <main className="flex-1 pt-14">
        <section className="relative py-8 md:py-12 overflow-hidden">
          <div className="container-main">
            <div className="grid lg:grid-cols-2 gap-8 items-center">
              <div className="text-center md:text-right">
                <div className="inline-flex items-center gap-2 bg-brand-primary/10 text-brand-primary px-4 py-2 rounded-full text-sm font-medium mb-4">
                  نسخة تجريبية لكلية الأزهر للبنات - العاشر من رمضان
                </div>
                <h1 className="font-heading text-4xl md:text-5xl lg:text-6xl font-bold text-text-primary leading-tight mb-4">
                  إتقان ـ حافظي على تقدمك، خطوة بعد خطوة
                </h1>
                <p className="text-lg md:text-xl text-text-secondary mb-5 max-w-xl mx-auto md:mx-0 font-normal">
                  منصة تربط تعلم الطالبة بمتابعة المقرر ودعم هيئة التدريس،
                  بحوكمة علمية صارمة ونموذج وقف تعليمي لا يهدف للربح
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center md:justify-start gap-3 mb-6">
                  <Link href="/auth/join">
                    <Button size="xl">ابدئي رحلتك الآن</Button>
                  </Link>
                  <Link href="#how-it-works">
                    <Button variant="outline" size="xl">شاهدي كيف تعمل</Button>
                  </Link>
                </div>
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-x-8 gap-y-3 text-sm text-text-secondary">
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-state-positive" />
                    لا تسجيل بدون دعوة
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-state-positive" />
                    صوت فقط - لا كاميرا إلزامية
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-state-positive" />
                    تعمل دون إنترنت
                  </span>
                </div>
              </div>

              <div className="relative">
                <div className="aspect-square max-w-md mx-auto">
                  <div className="relative w-full h-full bg-surface-elevated rounded-3xl border border-divider shadow-elevated overflow-hidden">
                    <div className="relative z-10 p-5 flex flex-col items-center justify-center h-full">
                      <div className="font-quran text-4xl md:text-5xl text-brand-primary mb-4 text-center leading-loose">
                        بسم الله الرحمن الرحيم
                      </div>
                      <div className="w-full max-w-xs mx-auto space-y-3">
                        <div className="bg-surface-canvas rounded-2xl border border-divider p-4 text-center">
                          <div className="text-sm text-text-secondary mb-1">اليوم: سورة البقرة ٢٠٠-٢١٥</div>
                          <div className="font-quran text-2xl text-text-primary">وَاذْكُرُوا اللَّهَ كَذِكْرِكُمْ آبَاءَكُمْ</div>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="primary" className="flex-1">ابدئي الجلسة</Button>
                          <Button variant="ghost" className="flex-1">مراجعة</Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="pb-4">
          <div className="container-main">
            <div className="grid md:grid-cols-2 gap-4">
              <article className="surface-card p-5 text-center">
                <div className="flex justify-center mb-3">
                  <IconTile icon={BookOpen} size="lg" />
                </div>
                <h3 className="font-heading text-2xl font-bold text-brand-primary mb-2">انضمي كطالبة</h3>
                <p className="text-text-secondary font-normal mb-4">
                  كود الدعوة من معلمتك هو كل ما تحتاجينه. لا تسجيل عام، ولا اشتراك مدفوع.
                </p>
                <Link href="/auth/join">
                  <Button variant="outline">الدخول بكود الشعبة</Button>
                </Link>
              </article>
              <article className="surface-card p-5 text-center">
                <div className="flex justify-center mb-3">
                  <IconTile icon={Users} glyph="rings" size="lg" />
                </div>
                <h3 className="font-heading text-2xl font-bold text-brand-primary mb-2">دخول هيئة التدريس</h3>
                <p className="text-text-secondary font-normal mb-4">
                  لوحة متابعة الشعبة، مراجعة التسميع، والتدخلات الموجهة — للأستاذات المعتمدات.
                </p>
                <Link href="/auth/login/faculty">
                  <Button>دخول المعلمات</Button>
                </Link>
              </article>
            </div>
          </div>
        </section>

        <div id="how-it-works">
          <StepConnector
            heading="حلقة التعلم المستمر"
            subheading="تعلم → قيس → ادعم → حسّن .. دورة مستمرة لا تتوقف عند الاختبار"
            numbered={false}
            steps={[
              { title: 'تعلم', description: 'خطة يومية مخصصة: جديد، ترسيخ، ومراجعة طويلة المدى', glyph: 'cluster' },
              { title: 'قيس', description: 'تسميع غير متزامن، تقييم ذاتي، واختبارات تكوينية أسبوعية', glyph: 'petals' },
              { title: 'ادعم', description: 'تنبيهات مبكرة، خطط تعافي، رسائل تدخل مخصصة', glyph: 'mosaic' },
              { title: 'حسّن', description: 'تقارير للأستاذة، مراجعة لجنة، أدلة جودة قابلة للتتبع', glyph: 'rings' },
            ]}
          />
        </div>

        <div className="bg-surface-elevated/60">
          <StepConnector
            heading="كيفية استخدام إتقان؟"
            numbered
            steps={[
              { title: 'انضمي بدعوة', description: 'أدخلي كود الشعبة ورقم الواتساب', glyph: 'cluster' },
              { title: 'تحققي من حسابك', description: 'رمز OTP ثم الاسم والموافقات', glyph: 'petals' },
              { title: 'ابدئي خطة اليوم', description: 'جديد، ترسيخ، ومراجعة طويلة المدى', glyph: 'mosaic' },
              { title: 'تسميع ومتابعة', description: 'طابور المعلمة وتدخلات موجهة', glyph: 'rings' },
              { title: 'شهادات معتمدة', description: 'إتمام قابل للتحقق من المؤسسة', glyph: 'grid' },
            ]}
          />
        </div>

        <section id="features" className="py-8 md:py-10">
          <div className="container-main">
            <div className="text-center mb-8">
              <h2 className="font-heading text-3xl md:text-4xl font-bold text-text-primary mb-4">
                مميزات مصممة لحفظ القرآن
              </h2>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
              {features.map((feature) => (
                <div key={feature.title} className="p-5 bg-surface-elevated rounded-2xl border border-divider shadow-sm">
                  <IconTile icon={feature.icon} className="mb-3" />
                  <h3 className="font-heading text-lg font-bold text-text-primary mb-2">{feature.title}</h3>
                  <p className="text-text-secondary text-sm font-normal">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-8 md:py-10 bg-brand-primary text-surface-canvas">
          <div className="container-main">
            <h2 className="font-heading text-3xl md:text-4xl font-bold text-center mb-6 text-brand-accent">
              لماذا إتقان؟
            </h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
              {whyItems.map((item) => (
                <article key={item.title} className="rounded-2xl border border-brand-accent/25 p-5">
                  <div className="flex justify-end mb-3">
                    <span className="w-12 h-12 rounded-xl bg-brand-accent/15 text-brand-accent flex items-center justify-center">
                      <item.icon className="w-6 h-6" />
                    </span>
                  </div>
                  <h3 className="font-heading text-xl font-bold text-brand-accent mb-2 text-right">{item.title}</h3>
                  <p className="text-surface-canvas/80 font-normal text-sm leading-relaxed text-right">{item.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="py-8 md:py-10">
          <div className="container-main max-w-4xl text-center space-y-5">
            <div>
              <h2 className="font-heading text-3xl font-bold text-brand-primary mb-3">رؤيتنا</h2>
              <p className="text-lg text-text-primary font-normal">حافظي على تقدمك، خطوة بعد خطوة</p>
            </div>
            <div>
              <h2 className="font-heading text-3xl font-bold text-brand-accent mb-3">قيمنا</h2>
              <p className="text-lg text-text-primary font-normal">الحوكمة العلمية، والوقف التعليمي، والإتاحة، وحماية البيانات</p>
            </div>
            <div>
              <h2 className="font-heading text-3xl font-bold text-state-attention mb-3">رسالتنا</h2>
              <p className="text-lg text-text-primary font-normal leading-relaxed">
                منصة تربط تعلم الطالبة بمتابعة المقرر ودعم هيئة التدريس، بحوكمة علمية صارمة ونموذج وقف تعليمي لا يهدف للربح
              </p>
            </div>
            <div>
              <h2 className="font-heading text-3xl font-bold text-state-info mb-3">أهدافنا</h2>
              <div className="text-text-primary font-normal space-y-2">
                <p>خطة يومية واضحة ومتابعة إتقان بأربعة أبعاد</p>
                <p>تغذية راجعة فورية على الأخطاء مع تلاوة مرجعية</p>
                <p>تعافٍ رحيم دون سلسلة مكسورة، وتقارير جاهزة للأستاذة</p>
              </div>
            </div>
          </div>
        </section>

        <section id="trust" className="py-8 md:py-10 bg-surface-elevated/60">
          <div className="container-main">
            <div className="text-center mb-6">
              <h2 className="font-heading text-3xl md:text-4xl font-bold text-text-primary mb-4">
                ثقة مؤسسة، أمان تام
              </h2>
              <p className="text-text-secondary max-w-2xl mx-auto font-normal">
                كل قرار تقني يخضع لرقابة علمية، وكل بيانات محمية بأعلى المعايير
              </p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
              {trustBadges.map((badge) => (
                <div key={badge.label} className="flex items-center gap-3 p-4 bg-surface-elevated rounded-2xl border border-divider">
                  <IconTile icon={CheckCircle} size="sm" />
                  <span className="text-text-primary font-medium">{badge.label}</span>
                </div>
              ))}
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="p-4 bg-surface-elevated rounded-2xl border border-divider">
                <h3 className="font-heading text-xl font-bold text-text-primary mb-4 flex items-center gap-2">
                  <IconTile icon={BookOpen} size="sm" />
                  رحلة الطالبة
                </h3>
                <div className="space-y-3 text-sm text-text-secondary font-normal">
                  <p>• خطة يومية واضحة: &quot;اليوم: 3 آيات جديدة + ١٢ مراجعة&quot;</p>
                  <p>• وضع الاستذكار النشط: إخفاء أواخر الآيات للتسميع الذاتي</p>
                  <p>• تغذية راجعة فورية: علامات على الأخطاء (خفي/جلي) مع تلاوة مرجعية</p>
                  <p>• تعافي رحيم: &quot;فاتتك جلسة أمس؟ استأنفي بخطة ٧ دقائق - لا سلسلة مكسورة&quot;</p>
                </div>
              </div>
              <div className="p-4 bg-surface-elevated rounded-2xl border border-divider">
                <h3 className="font-heading text-xl font-bold text-text-primary mb-4 flex items-center gap-2">
                  <IconTile icon={Users} size="sm" />
                  مساحة المعلمة
                </h3>
                <div className="space-y-3 text-sm text-text-secondary font-normal">
                  <p>• لوحة صحة الشعبة: توزيع ARI، أول ٥ حالات، متشابِهات ضعيفة</p>
                  <p>• تفتيش طالبة: إتقان ٤ أبعاد، تاريخ طلاقة، حالات، تواصل</p>
                  <p>• تدخل بنقرة: قوالب رسائل معدة، حجز موعد تلقائي، إحالة لمستشار</p>
                  <p>• تقارير جاهزة: PDF للاجتماعات، مقارنة مع شعبة ضابطة</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="py-8 md:py-10 bg-brand-primary">
          <div className="container-main">
            <h2 className="font-heading text-3xl font-bold text-center text-surface-canvas mb-6">آراء من داخل المسار</h2>
            <div className="grid md:grid-cols-2 gap-4 mb-6">
              <blockquote className="rounded-2xl border border-brand-accent/20 p-4 text-surface-canvas">
                <p className="font-heading text-lg mb-3">&quot;خطة يومية واضحة: اليوم 3 آيات جديدة + ١٢ مراجعة&quot;</p>
                <footer className="text-brand-accent text-sm">من رحلة الطالبة في إتقان</footer>
              </blockquote>
              <blockquote className="rounded-2xl border border-brand-accent/20 p-4 text-surface-canvas">
                <p className="font-heading text-lg mb-3">&quot;لوحة صحة الشعبة: توزيع ARI، أول ٥ حالات، وتقارير جاهزة&quot;</p>
                <footer className="text-brand-accent text-sm">من مساحة المعلمة في إتقان</footer>
              </blockquote>
            </div>
            <FeedbackForm />
          </div>
        </section>

        <section className="py-8 md:py-10">
          <div className="container-main">
            <div className="max-w-3xl mx-auto text-center p-6 md:p-10 bg-brand-primary rounded-3xl">
              <h2 className="font-heading text-3xl md:text-4xl font-bold text-white mb-3">
                جاهزة للبدء؟
              </h2>
              <p className="text-surface-canvas/90 text-lg mb-5 max-w-xl mx-auto font-normal">
                انضمي لبرنامج تجريبي في كلية الأزهر للبنات بالعاشر من رمضان.
                كود الدعوة من معلمتك هو كل ما تحتاجينه.
              </p>
              <Link href="/auth/join">
                <Button size="xl" className="bg-white text-brand-primary hover:bg-surface-canvas">
                  ادخلي كود الدعوة
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
