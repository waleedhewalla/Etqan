import { config } from '../config';
import { sendEmail } from './email';

/** Tells a new member of staff how to sign in: by a link sent to the email they type on the faculty page. */
export async function inviteStaff(email: string, displayNameAr: string, role: string) {
  const what = role === 'dean' ? 'عميدةً' : role === 'advisor' ? 'مرشدةً' : 'معلمةً';
  return sendEmail({
    to: email,
    subject: 'أُضيفتِ إلى إتقان',
    text: `السلام عليكم ${displayNameAr}،\n\nأُضيف حسابك ${what} في إتقان. للدخول افتحي الصفحة التالية واكتبي بريدك هذا، وسيصلك رابط الدخول:\n${config.FRONTEND_URL}/auth/login/faculty`,
  });
}
