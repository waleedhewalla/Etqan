import { LegalLayout } from '@/components/LegalLayout';

export default function AccessibilityPage() {
  return (
    <LegalLayout title="إتاحة الوصول">
      <p>إتقان ملتزمة بإتاحة الوصول وفق WCAG 2.2 كما هو مذكور في شارات الثقة على الصفحة الرئيسية.</p>
      <p>المنصة عربية أولاً واتجاهها من اليمين إلى اليسار. حجم الخط الأدنى للنص 16px على الشاشات الصغيرة، وأهداف اللمس لا تقل عن 44×44 بكسل.</p>
      <p>وضع الخط الميسر (للعسر القرائي) جزء من نظام الخطوط المعتمد في إتقان. إن واجهت عائقاً في الوصول، تواصلي عبر support@itqan.link.</p>
    </LegalLayout>
  );
}
