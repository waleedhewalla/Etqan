import { config } from '../config';
import { sendEmail } from './email';

/** Tells a new member of staff how to sign in: by a link sent to the email they type on the faculty page. An admin is addressed in the masculine, the others in the feminine. */
export async function inviteStaff(email: string, displayNameAr: string, role: string) {
  const admin = role === 'admin';
  const what = admin ? 'مسؤولاً' : role === 'advisor' ? 'مرشدةً' : 'معلمةً';
  const link = `${config.FRONTEND_URL}/auth/login/faculty`;
  return sendEmail({
    to: email,
    subject: admin ? 'أُضيفتَ إلى إتقان' : 'أُضيفتِ إلى إتقان',
    text: admin
      ? `السلام عليكم ${displayNameAr}،\n\nأُضيف حسابك ${what} في إتقان. للدخول افتح الصفحة التالية واكتب بريدك هذا، وسيصلك رابط الدخول:\n${link}`
      : `السلام عليكم ${displayNameAr}،\n\nأُضيف حسابك ${what} في إتقان. للدخول افتحي الصفحة التالية واكتبي بريدك هذا، وسيصلك رابط الدخول:\n${link}`,
  });
}
