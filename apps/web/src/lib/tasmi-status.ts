import type { TasmiSubmission } from '@/lib/api';

/** Where a recitation stands, in the words both the student and the teacher see. */
export const TASMI_STATUS: Record<TasmiSubmission['status'], { label: string; tone: string }> = {
  submitted: { label: 'أُرسل', tone: 'bg-surface-canvas text-text-secondary' },
  under_review: { label: 'قيد المراجعة', tone: 'bg-blue-50 text-blue-900' },
  feedback_given: { label: 'وصل ردّ المعلمة', tone: 'bg-blue-50 text-blue-900' },
  revision_requested: { label: 'أعيدي التسجيل', tone: 'bg-amber-50 text-amber-900' },
  revised: { label: 'أُعيد التسجيل', tone: 'bg-surface-canvas text-text-secondary' },
  referred: { label: 'عند الشيخة للمراجعة', tone: 'bg-red-50 text-red-800' },
  final_graded: { label: 'الدرجة النهائية', tone: 'bg-green-50 text-green-800' },
};

const ORDINAL = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة'];
/** "المحاولة الثانية" for a repeat; nothing for a first recording. */
export const attemptLabel = (attempt: number) => (attempt > 1 ? `المحاولة ${ORDINAL[attempt - 1] ?? attempt}` : '');
