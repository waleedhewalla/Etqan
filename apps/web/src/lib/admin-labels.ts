import type { AdminRole } from '@/lib/api';

export const ROLE_LABEL: Record<AdminRole, string> = {
  student: 'طالبة', mahram: 'ولي أمر', lecturer: 'معلمة', muhaffiza: 'محفّظة', sheikh_reviewer: 'شيخة مراجِعة', advisor: 'مرشدة', dean: 'عميدة',
  alumna: 'خريجة', committee_member: 'عضو لجنة', sama_committee_member: 'عضو لجنة السماع',
};

/** Roles an admin can create, in the order the form offers them. A dean is added by the platform operator only. */
export const CREATABLE: { role: 'student' | 'mahram' | 'lecturer' | 'muhaffiza' | 'sheikh_reviewer' | 'advisor' | 'dean'; operatorOnly?: boolean }[] = [
  { role: 'student' }, { role: 'mahram' }, { role: 'lecturer' }, { role: 'muhaffiza' }, { role: 'sheikh_reviewer' }, { role: 'advisor' },
  { role: 'dean', operatorOnly: true },
];
export const isStaffRole = (role: string) => ['lecturer', 'muhaffiza', 'sheikh_reviewer', 'advisor', 'dean'].includes(role);

/** The audit log's action codes, in words. An action with no entry here is shown as its code. */
export const ACTION_LABEL: Record<string, string> = {
  'user.created': 'إضافة مستخدم',
  'user.updated': 'تعديل بيانات مستخدم',
  'user.stopped': 'إيقاف حساب',
  'user.restored': 'إعادة تفعيل حساب',
  'user.halaqa.joined': 'إضافة طالبة إلى حلقة',
  'user.halaqa.left': 'إخراج طالبة من حلقة',
  'users.bulk_added': 'إضافة طالبات دفعة واحدة',
  'guardian.linked': 'ربط ولي أمر',
  'guardian.unlinked': 'فك ربط ولي أمر',
  'staff.added': 'إضافة معلمة',
  'staff.stopped': 'إيقاف دخول معلمة',
  'staff.restored': 'إعادة دخول معلمة',
  'halaqa.added': 'فتح حلقة',
  'halaqa.reassigned': 'إسناد حلقة إلى معلمة أخرى',
  'halaqa.closed': 'إغلاق حلقة',
  'halaqa.reopened': 'إعادة فتح حلقة',
  'halaqa.program.set': 'إسناد برنامج حفظ إلى حلقة',
  'halaqa.program.cleared': 'فكّ برنامج الحفظ عن حلقة',
  'program.created': 'إنشاء برنامج حفظ',
  'program.updated': 'تعديل إعدادات برنامج',
  'program.periods.saved': 'حفظ فترات برنامج',
  'program.deleted': 'حذف برنامج',
  'program.applied': 'إضافة مقرّر الفترة إلى خطط الطالبات',
  'section.join': 'انضمام طالبة إلى حلقة',
  signup: 'تسجيل طالبة جديدة',
  login: 'تسجيل دخول',
  'otp.requested': 'طلب رمز دخول',
  'session.ended': 'إنهاء درس مباشر',
  'session.recording.started': 'بدء تسجيل درس',
  'session.recording.finished': 'انتهاء تسجيل درس',
  'session.recording.viewed': 'مشاهدة تسجيل درس',
  'session.recording.deleted': 'حذف تسجيل درس',
  'session.recording.expired': 'انتهاء مدة حفظ تسجيل درس',
  'lesson.created': 'تسجيل آيات للحفظ',
  'tasmi.audio.expire': 'حذف تسجيل تسميع تلقائياً',
};

export const actionLabel = (action: string) => ACTION_LABEL[action] ?? action;

export const ACTOR_LABEL = (role: string | null) => (role ? (ROLE_LABEL as Record<string, string>)[role] ?? role : 'النظام');
