import { LegalLayout } from '@/components/LegalLayout';

const LINK = 'text-brand-primary underline underline-offset-2 hover:text-brand-accent';

export const metadata = { title: 'المصادر والشكر — إتقان' };

export default function CreditsPage() {
  return (
    <LegalLayout title="المصادر والشكر">
      <h2 className="font-heading text-xl font-bold text-text-primary">نص القرآن الكريم</h2>
      <p>
        نص القرآن الكريم المعروض في إتقان (رواية حفص عن عاصم، بالرسم العثماني) مأخوذ من مجموعة{' '}
        <a className={LINK} href="https://github.com/risan/quran-json" target="_blank" rel="noopener noreferrer" dir="ltr">quran-json</a>{' '}
        التي أعدّها <span dir="ltr">Risan Bagja Pradana</span>، وهي منشورة بترخيص{' '}
        <a className={LINK} href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer" dir="ltr">CC BY-SA 4.0</a>.
        وتذكر المجموعة أن النص مأخوذ من «موسوعة القرآن الكريم»{' '}
        (<a className={LINK} href="https://quranenc.com" target="_blank" rel="noopener noreferrer" dir="ltr">quranenc.com</a>).
      </p>
      <p>
        نعرض النص كما ورد في المجموعة دون تغيير. ونحتفظ داخلياً بنسخة منه بلا علامات التشكيل لأغراض المطابقة بين التلاوة والنص فقط، ولا تُعرض للمستخدمات.
      </p>
      <h2 className="font-heading text-xl font-bold text-text-primary">الأخطاء</h2>
      <p>
        إن وجدتِ خطأً في نص أي آية فأبلغينا على support@itqan.link لنصحّحه بالرجوع إلى مصدر معتمد.
      </p>
    </LegalLayout>
  );
}
