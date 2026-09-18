import Link from 'next/link';
import { BrandMark } from './BrandMark';

export function SiteFooter() {
  return (
    <footer className="bg-brand-primary text-surface-canvas">
      <div className="container-main py-7">
        <div className="grid md:grid-cols-4 gap-6 mb-5">
          <div>
            <div className="mb-4">
              <BrandMark inverse />
            </div>
            <p className="text-surface-canvas/80 text-sm font-normal leading-relaxed">
              منصة حفظ القرآن الكريم والتلاوة والمتابعة الأكاديمية بنموذج وقف تعليمي
            </p>
          </div>
          <div>
            <h4 className="font-heading font-bold mb-4">روابط سريعة</h4>
            <nav className="space-y-2">
              <Link href="/auth/join" className="text-surface-canvas/80 hover:text-brand-accent transition-colors text-sm block cursor-pointer">انضمي كطالبة</Link>
              <Link href="/auth/login/faculty" className="text-surface-canvas/80 hover:text-brand-accent transition-colors text-sm block cursor-pointer">دخول هيئة التدريس</Link>
              <Link href="/#features" className="text-surface-canvas/80 hover:text-brand-accent transition-colors text-sm block cursor-pointer">المميزات</Link>
              <Link href="/#trust" className="text-surface-canvas/80 hover:text-brand-accent transition-colors text-sm block cursor-pointer">الثقة والأمان</Link>
            </nav>
          </div>
          <div>
            <h4 className="font-heading font-bold mb-4">سياسات</h4>
            <nav className="space-y-2">
              <Link href="/privacy" className="text-surface-canvas/80 hover:text-brand-accent transition-colors text-sm block cursor-pointer">سياسة الخصوصية</Link>
              <Link href="/terms" className="text-surface-canvas/80 hover:text-brand-accent transition-colors text-sm block cursor-pointer">شروط الاستخدام</Link>
              <Link href="/data-deletion" className="text-surface-canvas/80 hover:text-brand-accent transition-colors text-sm block cursor-pointer">حذف البيانات</Link>
              <Link href="/accessibility" className="text-surface-canvas/80 hover:text-brand-accent transition-colors text-sm block cursor-pointer">إتاحة الوصول</Link>
            </nav>
          </div>
          <div>
            <h4 className="font-heading font-bold mb-4">تواصل</h4>
            <address className="text-surface-canvas/80 text-sm not-italic space-y-2 font-normal">
              <p>كلية الأزهر للبنات - العاشر من رمضان</p>
              <p>بريد إلكتروني: support@itqan.link</p>
              <p>هاتف: +20 XX XXXX XXXX</p>
            </address>
          </div>
        </div>
        <div className="pt-5 border-t border-surface-canvas/15 flex flex-col md:flex-row items-center justify-between gap-3 text-sm text-surface-canvas/70">
          <p>© 2026 إتقان. جميع الحقوق محفوظة كوقف تعليمي.</p>
          <p>نسخة تجريبية 0.1.0 - غير معتمدة للإنتاج</p>
        </div>
      </div>
    </footer>
  );
}
