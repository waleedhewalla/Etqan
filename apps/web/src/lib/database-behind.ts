/** The server says its database is behind the code (`code: DATABASE_OUT_OF_DATE`). */
export const DATABASE_BEHIND_EVENT = 'itqan:database-behind';

/** A developer is told the command; everyone else is told whom to ask. */
export const databaseBehindText = () => (process.env.NODE_ENV === 'development'
  ? 'قاعدة بيانات الخادم أقدم من البرنامج، فلا تُحمَّل بعض الشاشات. شغّل الأمر pnpm db:migrate ثم أعد تشغيل الخادم.'
  : 'تعذّر تحميل بعض الشاشات لأن تحديثاً في الخادم لم يكتمل. يرجى إبلاغ مشغّل المنصة.');
