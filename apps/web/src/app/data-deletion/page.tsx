import { SUPPORT_EMAIL, SUPPORT_PHONE } from '@/lib/site';
import { LegalLayout } from '@/components/LegalLayout';

export default function DataDeletionPage() {
  return (
    <LegalLayout title="حذف البيانات">
      <p>يمكنك طلب حذف بياناتك الشخصية المرتبطة بالحساب والتقدم والتقارير الأكاديمية.</p>
      <p>تسجيلات الصوت للتسميع تُحذف تلقائياً بعد ٢٤ ساعة من مراجعة المعلمة لها، وإن لم تُراجَع فبعد ٣٠ يوماً من إرسالها. ويمكن للطالبة حذف تسجيلها في أي وقت من تبويب «التسميع»، وتبقى الدرجة وملاحظات المعلمة. سحب الموافقات متاح من الإعدادات بعد الانضمام.</p>
      <p>أرسلي طلب الحذف إلى <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> من رقم الواتساب أو البريد المسجّل في حسابك، مع بيان أن الطلب يخص حذف البيانات. نردّ خلال سبعة أيام عمل.{SUPPORT_PHONE && <> هاتف التواصل: <span dir="ltr">{SUPPORT_PHONE}</span>.</>}</p>
    </LegalLayout>
  );
}
