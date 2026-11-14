import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';

/**
 * Where the browser reaches the API. Set at build time for a deployment. Left empty in development, the browser
 * calls this site's own `/v1`, which Next forwards to the API (see next.config.js): that works from any address
 * the site is opened at, not only http://localhost.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

export const TOKEN_KEY = 'itqan_token';
export const REFRESH_KEY = 'itqan_refresh_token';
export const USER_KEY = 'itqan_user';

// ── Response types (mirror apps/core routes) ──

export type Role =
  | 'student' | 'lecturer' | 'muhaffiza' | 'advisor' | 'dean' | 'sheikh_reviewer'
  | 'committee_member' | 'sama_committee_member' | 'operator' | 'superadmin' | 'mahram' | 'alumna';

export interface ApiUser {
  id: string;
  role: Role;
  tenantId: string;
  displayNameAr: string;
  displayNameEn: string | null;
  email: string | null;
  whatsappE164: string | null;
}

export interface SessionResponse {
  token: string;
  refreshToken: string;
  user: ApiUser;
  isNewUser?: boolean;
}

export interface MeResponse {
  user: ApiUser;
  tenant: { id: string; nameAr: string; slug: string };
  sections: { id: string; nameAr: string }[];
  consents: ConsentPurpose[];
}

export type ConsentPurpose =
  | 'voice_recording' | 'analytics' | 'mahram_access' | 'whatsapp_notifications' | 'peer_comparison' | 'data_export' | 'ai_processing';

export type Rating = 'again' | 'hard' | 'good' | 'easy';

export interface QueueCard {
  id: string;
  ayahRef: string;
  state: string;
  dueAt: string | null;
}

export interface QueueItem {
  card: QueueCard;
  reason: 'manzil' | 'sabqi' | 'sabaq';
  estimatedMinutes: number;
  rationale: string;
}

export interface Gatekeeper {
  locked: boolean;
  currentMastery: number;
  threshold: number;
  deficitCards: number;
  message: string;
}

export interface Streak {
  currentStreak: number;
  longestStreak: number;
  freezesRemaining: number;
  lastActiveDate?: string | null;
}

export interface Assignment {
  id: string;
  type: 'sabaq' | 'sabqi' | 'manzil';
  startRef: string;
  endRef: string;
  dueDate: string | null;
  notes: string | null;
}

export interface QueueResponse {
  date: string;
  gatekeeper: Gatekeeper;
  queue: {
    manzil: { count: number; items: QueueItem[] };
    sabqi: { count: number; items: QueueItem[] };
    sabaq: { count: number; items: QueueItem[]; locked: boolean; perDay?: number; learnedToday?: number };
  };
  totalItems: number;
  estimatedMinutes: number;
  streak: Streak;
  assignments: Assignment[];
  /** Set when this is the copy saved on the device because the server could not be reached. */
  offlineSavedAt?: string;
}

export interface EarnedBadge { id: string; nameAr: string; icon: string; tier: 'bronze' | 'silver' | 'gold' | 'diamond' }

export interface BatchReviewResult { clientId: string; status: 'applied' | 'duplicate' | 'stale' | 'too_old' | 'invalid_time' | 'not_found' }

export interface RateBatchResponse {
  results: BatchReviewResult[];
  applied: number;
  streak: Streak | null;
  newBadges: EarnedBadge[];
}

export interface RateResponse {
  card: { id: string; dueAt: string; state: string };
  streak: Streak;
  /** Badges this rating just earned. */
  newBadges?: EarnedBadge[];
}

export interface ClusterAyah { ref: string; text: string | null }

export interface Cluster {
  id: string;
  ayahRefs: string[];
  source: 'kirmani' | 'ansari' | 'sakhawi' | 'other';
  tawjihAr: string | null;
  approvalStatus: 'draft' | 'pending_review' | 'approved' | 'rejected';
  tenantId: string | null;
  createdBy: string | null;
  /** The verses in mushaf order; `text` is null when the Quran text is not loaded. */
  ayat: ClusterAyah[];
}

export interface Drill {
  id: string;
  clusterId: string;
  drillType: 'cloze' | 'timed-choice';
  targetRef: string | null;
  question: string;
  options: string[];
}

export interface DrillResult { drillId: string; wasCorrect: boolean; correctAnswer: string; rescheduled: boolean }

export interface AtRiskStudent {
  studentId: string;
  displayNameAr: string;
  halaqat: string[];
  level: 'medium' | 'high';
  reasons: ('inactive' | 'attendance')[];
  /** Whole days since her last review; null = she has never reviewed. */
  inactiveDays: number | null;
  /** Share of marked days attended over the last 30 days; null = nothing marked. */
  attendanceRate: number | null;
  masteryPercent: number;
  lastActiveAt: string | null;
}

export interface AdminOverview {
  institution: {
    id: string; nameAr: string; slug: string; domain: string | null; active: boolean;
    plan: {
      tier: 'free' | 'madrasa_basic' | 'madrasa_pro' | 'enterprise'; maxStudents: number; maxHalaqat: number;
      /** Features in effect (the tier's plus any added; none once expired). */
      features: string[]; validUntil: string | null;
      status: {
        enforcement: 'warn' | 'block'; expired: boolean;
        students: { used: number; limit: number; state: 'ok' | 'near' | 'full' | 'over' };
        halaqat: { used: number; limit: number; state: 'ok' | 'near' | 'full' | 'over' };
      };
    };
  };
  usage: { students: number; halaqat: number };
  activity: { reviewsThisWeek: number; reviewsLastWeek: number; activeThisWeek: number; activeToday: number; avgMastery: number };
  atRisk: { high: number; medium: number; students: AtRiskStudent[]; truncated: boolean };
}

export interface PilotWeek {
  start: string; end: string;
  /** The week is still running. */
  partial: boolean;
  enrolled: number; active: number;
  /** Revised on `regularDays` or more days. */
  regular: number; reviews: number;
  recitations: { submitted: number; reviewed: number; medianHoursToReview: number | null };
  guardians: { linked: number; opened: number };
}

export interface PilotReport {
  regularDays: number;
  weeks: PilotWeek[];
  retention: { cohort: number; retained: number; fromWeek: string; toWeek: string } | null;
}

export interface BadgeProgress extends EarnedBadge {
  descriptionAr: string;
  category: string;
  earned: boolean;
  earnedAt: string | null;
  progress: { current: number; target: number };
}

export interface StatsResponse {
  total: number;
  mastered: number;
  review: number;
  new: number;
  dueNow: number;
  todayReviews: number;
  streak: Streak;
}

export interface Section {
  id: string;
  nameAr: string;
  joinCode?: string;
  teacherId?: string | null;
  maxStudents?: number;
}

export interface StudentSummary {
  studentId: string;
  displayNameAr: string;
  masteryPercent: number;
  cardsTotal: number;
  cardsDue: number;
  reviewsToday: number;
  lastActiveAt: string | null;
  inactiveDays: number | null;
  attendanceRate: number | null;
  currentStreak: number;
  atRisk: boolean;
  riskReasons: ('inactive' | 'attendance')[];
}

export interface SectionStudentsResponse {
  sectionId: string;
  students: StudentSummary[];
  summary: { totalStudents: number; activeToday: number; atRisk: number; avgMastery: number };
}

export interface SectionReport {
  totalStudents: number;
  tasmiSubmissions: number;
  pendingReviews: number;
  avgTasmiScore: number | null;
}

export interface AttendanceDay {
  sectionId: string;
  date: string;
  records: { studentId: string; displayNameAr: string; present: boolean | null; notes: string | null }[];
}

export interface AttendanceSaveResponse {
  saved: number;
  alerts: { sent: number; skipped: number; failed: number; noGuardian: number };
}

/** One word the automatic check wants the teacher to look at. */
export interface FlaggedWord {
  id: string;
  ayahRef: string;
  /** 0-based position of the word in its ayah (for `added`, the word it follows). */
  position: number;
  type: 'missing' | 'wrong' | 'added';
  expected?: string;
  heard?: string;
  disputed?: boolean;
  decision?: 'confirmed' | 'dismissed';
}

export type AiStatus = 'pending' | 'processing' | 'done' | 'unclear' | 'skipped' | 'failed';

export interface TasmiSubmission {
  id: string;
  studentId: string;
  studentName?: string;
  sectionId: string | null;
  startRef: string;
  endRef: string;
  /** Whether a recording is stored (it may have been deleted by the student). */
  hasAudio: boolean;
  durationMs: number | null;
  submittedAt: string;
  reviewVerdict: 'approved' | 'redo' | 'flagged' | null;
  reviewWeightedTotal: number | null;
  /** The teacher's text reply. */
  reviewNotes: string | null;
  /** Whether the teacher left a recorded reply (it is removed after a month). */
  hasReplyAudio?: boolean;
  replyDurationMs?: number | null;
  replyAt?: string | null;
  /** null = no automatic check was made (switched off, or the student did not agree). */
  aiStatus: AiStatus | null;
  aiHifzAccuracy: number | null;
  aiReadyForApproval: boolean | null;
  aiFlaggedErrors: FlaggedWord[];
  /** Pending list only: flags the student says are wrong. */
  disputedCount?: number;
}

export type MonthlyGrade = 'excellent' | 'very_good' | 'good' | 'pass' | 'weak';
export type MonthlyIssue =
  | { kind: 'no_recitations' }
  | { kind: 'redo'; count: number; ranges: { startRef: string; endRef: string }[] }
  | { kind: 'mistakes'; count: number; byType: { missing: number; wrong: number; added: number }; ayat: string[] }
  | { kind: 'weak_skill'; skill: 'hifz' | 'tajweed' | 'fluency'; average: number }
  | { kind: 'absence'; count: number; dates: string[] };

/** A student's month: what went wrong, the total appraisal of her recitations, and the degree that follows. */
export interface MonthlyRecord {
  month: string;
  student: { id: string; displayNameAr: string };
  recitations: { submitted: number; counted: number; approved: number; redo: number; awaiting: number };
  /** Average of the weighted totals of recitations with a final verdict; null when there are none. */
  totalAppraisal: { average: number | null; hifz: number | null; tajweed: number | null; fluency: number | null };
  degree: { score: number | null; outOf: number; grade: MonthlyGrade | null };
  issues: MonthlyIssue[];
  attendance: { present: number; absent: number };
  /** The teacher's written appraisal for the month. */
  appraisal: { note: string; teacherName: string | null; updatedAt: string } | null;
  items: {
    id: string; startRef: string; endRef: string; submittedAt: string;
    verdict: 'approved' | 'redo' | 'flagged' | null; total: number | null; notes: string | null; hasVoiceReply: boolean;
  }[];
}

export interface TasmiReviewInput {
  hifzScore: number;
  tajweedScore: number;
  fluencyScore: number;
  verdict: 'approved' | 'redo' | 'flagged';
  notes?: string;
  /** The teacher's call on each automatic flag, by flag id. */
  flagDecisions?: Record<string, 'confirmed' | 'dismissed'>;
}

export interface SetupStaff { id: string; displayNameAr: string; email: string | null; role: string; active: boolean; halaqat: number }
export interface SetupHalaqa {
  id: string; nameAr: string; joinCode: string; maxStudents: number; students: number; active: boolean;
  teacherId: string | null; teacherName: string | null; teacherActive: boolean | null;
}
export interface InstitutionSetup { staff: SetupStaff[]; halaqat: SetupHalaqa[] }

export type PlanStatus = 'memorized' | 'new';
export interface PlanRange { startRef: string; endRef: string; count: number; status: PlanStatus }
export interface HifzPlan { total: number; memorized: number; new: number; newPerDay: number; ranges: PlanRange[] }

export interface Guardian {
  id: string;
  displayNameAr: string;
  whatsappE164: string | null;
}

export interface WeeklyReport {
  student: { id: string; displayNameAr: string };
  sections: { id: string; nameAr: string }[];
  week: { start: string; end: string };
  attendance: { present: number; absent: number; days: { date: string; present: boolean; notes: string | null }[] };
  revision: { reviews: number; correctPercent: number | null; activeDays: string[] };
  progress: { masteryPercent: number; cardsTotal: number; cardsDue: number };
  streak: { current: number; longest: number };
  tasmi: {
    id: string; startRef: string; endRef: string; submittedAt: string;
    verdict: 'approved' | 'redo' | 'flagged' | null; score: number | null; notes: string | null;
  }[];
  assignments: {
    id: string; type: 'sabaq' | 'sabqi' | 'manzil'; startRef: string; endRef: string;
    dueDate: string | null; completedAt: string | null; score: number | null;
  }[];
}

export interface AyahText {
  ref: string;
  sura: number;
  ayah: number;
  suraNameAr: string;
  textUthmani: string;
  wordCount: number;
}

export interface AyatResponse {
  ayat: AyahText[];
  /** False when some of the requested verses are not loaded on the server yet. */
  complete: boolean;
}

export interface AppNotification {
  id: string;
  titleAr: string;
  bodyAr: string;
  readAt: string | null;
  sentAt: string;
}

/** Arabic error text from an API error, with a fallback. */
export function errorMessage(err: unknown, fallback = 'حدث خطأ، حاولي مرة أخرى') {
  const e = err as AxiosError<{ detail?: string; message?: string; code?: string }>;
  const code = e?.response?.data?.code;
  if (code === 'CONSENT_REQUIRED') return 'نحتاج موافقتكِ على تسجيل الصوت أولاً.';
  if (e?.response?.status === 413) return 'التسجيل كبير جداً. سجّلي مقطعاً أقصر.';
  if (e?.response?.status === 415) return 'تعذّر قبول هذا التسجيل. جرّبي متصفحاً آخر.';
  if (code === 'PLAN_LIMIT_REACHED') return 'بلغت المؤسسة حدّ ترخيصها (الطالبات أو الحلقات) أو انتهى ترخيصها. تواصلي مع إدارة المؤسسة.';
  if (code === 'PLAN_FEATURE_NOT_INCLUDED') return 'هذه الميزة غير مشمولة في ترخيص مؤسستكم.';
  if (code === 'ACCOUNT_NOT_FOUND') return 'لا يوجد حساب بهذا الرقم. اطلبي رمز الحلقة من معلمتك.';
  if (e?.response?.status === 429) return 'محاولات كثيرة. انتظري قليلاً ثم حاولي مرة أخرى.';
  if (!e?.response) return 'تعذّر الاتصال بالخادم. تحققي من الإنترنت.';
  // The site answered but the API behind it did not (not running, or restarting): its own errors are JSON.
  if (e.response.status >= 500 && typeof e.response.data !== 'object') {
    return process.env.NODE_ENV === 'development'
      ? 'خادم البيانات (API) لا يعمل. شغّليه بالأمر pnpm dev من مجلد المشروع، ثم أعيدي المحاولة.'
      : 'الخادم لا يستجيب الآن. حاولي بعد قليل.';
  }
  return fallback;
}

/**
 * Normalises an Egyptian or international number to E.164.
 * "010 1234 5678" → "+201012345678"; "+20 10 …" kept as is.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('0')) return `+20${digits.slice(1)}`;
  return `+${digits}`;
}

class ApiClient {
  private client: AxiosInstance;
  private refreshing: Promise<string | null> | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: `${API_URL}/v1`,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });

    this.client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
      const token = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
      if (token && config.headers) config.headers.Authorization = `Bearer ${token}`;
      return config;
    });

    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
        const isAuthCall = original?.url?.startsWith('/auth/');
        if (error.response?.status === 401 && original && !original._retry && !isAuthCall) {
          original._retry = true;
          const token = await this.refreshAccessToken();
          if (token) {
            original.headers.Authorization = `Bearer ${token}`;
            return this.client(original);
          }
          clearSession();
          if (typeof window !== 'undefined') window.location.href = '/auth/login';
        }
        return Promise.reject(error);
      },
    );
  }

  /** One refresh at a time, shared by all requests that got a 401. */
  private refreshAccessToken(): Promise<string | null> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        const refreshToken = localStorage.getItem(REFRESH_KEY);
        if (!refreshToken) return null;
        try {
          const res = await axios.post<SessionResponse>(`${API_URL}/v1/auth/refresh`, { refreshToken });
          saveSession(res.data);
          return res.data.token;
        } catch {
          return null;
        } finally {
          setTimeout(() => { this.refreshing = null; }, 0);
        }
      })();
    }
    return this.refreshing;
  }

  // Auth
  requestOtp(whatsapp: string, joinCode?: string) {
    return this.client.post<{ expiresIn: number; devCode?: string }>('/auth/otp/request', { whatsapp, joinCode });
  }

  verifyOtp(whatsapp: string, code: string, joinCode?: string) {
    return this.client.post<SessionResponse>('/auth/otp/verify', { whatsapp, code, joinCode });
  }

  magicLink(email: string) {
    return this.client.post<{ devLink?: string }>('/auth/magic-link', { email });
  }

  verifyMagicLink(token: string) {
    return this.client.post<SessionResponse>('/auth/magic-link/verify', { token });
  }

  getMe() {
    return this.client.get<MeResponse>('/auth/me');
  }

  updateProfile(data: { displayNameAr: string }) {
    return this.client.patch<{ user: ApiUser }>('/auth/me', data);
  }

  setConsents(granted: ConsentPurpose[]) {
    return this.client.put('/auth/me/consents', { granted });
  }

  logout() {
    return this.client.post('/auth/logout');
  }

  // Sections
  lookupSection(code: string) {
    return this.client.get<{ nameAr: string; tenantNameAr: string }>(`/sections/lookup/${encodeURIComponent(code)}`);
  }

  getSections() {
    return this.client.get<Section[]>('/sections');
  }

  joinSection(code: string) {
    return this.client.post<{ section: { id: string; nameAr: string } }>('/sections/join', { code });
  }

  getSectionStudents(sectionId: string) {
    return this.client.get<SectionStudentsResponse>(`/sections/${sectionId}/students`);
  }

  getSectionReport(sectionId: string) {
    return this.client.get<SectionReport>(`/reports/section/${sectionId}`);
  }

  getAttendance(sectionId: string, date: string) {
    return this.client.get<AttendanceDay>(`/sections/${sectionId}/attendance`, { params: { date } });
  }

  saveAttendance(sectionId: string, date: string, records: { studentId: string; present: boolean; notes?: string }[]) {
    return this.client.put<AttendanceSaveResponse>(`/sections/${sectionId}/attendance`, { date, records });
  }

  getPlan(sectionId: string, studentId: string) {
    return this.client.get<HifzPlan>(`/sections/${sectionId}/students/${studentId}/plan`);
  }

  addToPlan(sectionId: string, studentId: string, data: { startRef: string; endRef: string; status: PlanStatus }) {
    return this.client.post<{ added: number; skipped: number; plan: HifzPlan }>(`/sections/${sectionId}/students/${studentId}/plan`, data);
  }

  setPlanPace(sectionId: string, studentId: string, newPerDay: number) {
    return this.client.put<HifzPlan>(`/sections/${sectionId}/students/${studentId}/plan/pace`, { newPerDay });
  }

  removeFromPlan(sectionId: string, studentId: string, data: { startRef: string; endRef: string }) {
    return this.client.delete<{ removed: number; kept: number; plan: HifzPlan }>(`/sections/${sectionId}/students/${studentId}/plan`, { data });
  }

  getGuardians(sectionId: string, studentId: string) {
    return this.client.get<Guardian[]>(`/sections/${sectionId}/students/${studentId}/guardians`);
  }

  addGuardian(sectionId: string, studentId: string, data: { displayNameAr: string; whatsapp: string }) {
    return this.client.post<{ guardian: Guardian }>(`/sections/${sectionId}/students/${studentId}/guardians`, data);
  }

  // Student revision
  getQueue() {
    return this.client.get<QueueResponse>('/scheduler/queue');
  }

  rateCard(cardId: string, rating: Rating, timeTakenMs?: number) {
    return this.client.post<RateResponse>('/scheduler/rate', { cardId, rating, timeTakenMs });
  }

  // Look-alike verses
  getMyClusters() {
    return this.client.get<Cluster[]>('/mutashabihat/mine');
  }

  getClusters(status?: Cluster['approvalStatus']) {
    return this.client.get<Cluster[]>('/mutashabihat/clusters', { params: { status } });
  }

  createCluster(data: { ayahRefs: string[]; source: Cluster['source']; tawjihAr?: string }) {
    return this.client.post<Cluster>('/mutashabihat/clusters', data);
  }

  reviewCluster(id: string, decision: 'approved' | 'rejected') {
    return this.client.post<Cluster>(`/mutashabihat/clusters/${id}/review`, { decision });
  }

  deleteCluster(id: string) {
    return this.client.delete(`/mutashabihat/clusters/${id}`);
  }

  generateDrill(clusterId: string, drillType: Drill['drillType'], targetRef?: string) {
    return this.client.post<Drill>('/mutashabihat/drills/generate', { clusterId, drillType, targetRef });
  }

  answerDrill(id: string, answer: string) {
    return this.client.post<DrillResult>(`/mutashabihat/drills/${id}/answer`, { answer });
  }

  /** Reviews done offline, sent oldest first; each one carries when it happened. */
  rateBatch(reviews: { clientId: string; cardId: string; rating: Rating; timeTakenMs: number; reviewedAt: string }[]) {
    return this.client.post<RateBatchResponse>('/scheduler/rate-batch', { reviews });
  }

  // Administration
  getAdminOverview(tenantId?: string) {
    return this.client.get<AdminOverview>('/admin/overview', { params: { tenantId } });
  }

  getSetup() {
    return this.client.get<InstitutionSetup>('/admin/setup');
  }

  addStaff(data: { displayNameAr: string; email: string }) {
    return this.client.post<SetupStaff & { invitation: 'sent' | 'skipped' | 'failed' }>('/admin/staff', data);
  }

  editStaff(id: string, data: { displayNameAr?: string; active?: boolean }) {
    return this.client.patch<SetupStaff>(`/admin/staff/${id}`, data);
  }

  addHalaqa(data: { nameAr: string; teacherId: string }) {
    return this.client.post<SetupHalaqa>('/admin/halaqat', data);
  }

  editHalaqa(id: string, data: { nameAr?: string; teacherId?: string; maxStudents?: number; active?: boolean }) {
    return this.client.patch<SetupHalaqa>(`/admin/halaqat/${id}`, data);
  }

  getPilotReport(tenantId?: string, weeks = 4) {
    return this.client.get<PilotReport>('/admin/pilot', { params: { tenantId, weeks } });
  }

  getAdminTenants() {
    return this.client.get<{ id: string; nameAr: string; slug: string; planTier: string; active: boolean }[]>('/admin/tenants');
  }

  getBadges() {
    return this.client.get<BadgeProgress[]>('/badges');
  }

  getStats() {
    return this.client.get<StatsResponse>('/scheduler/stats');
  }

  // Tasmi'
  /** Sends a recording: multipart with startRef, endRef, sectionId, durationMs and the `audio` file. */
  uploadTasmi(form: FormData) {
    return this.client.post<TasmiSubmission>('/tasmi', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  }

  getMyTasmi() {
    return this.client.get<TasmiSubmission[]>('/tasmi');
  }

  /** A short-lived URL (path on the API) the browser can play. */
  getTasmiAudioLink(id: string) {
    return this.client.get<{ url: string }>(`/tasmi/${id}/audio-link`);
  }

  /** The teacher's reply to a recording: text, a recorded voice message, or both. */
  replyToTasmi(id: string, reply: { text?: string; audio?: Blob; durationMs?: number }) {
    const form = new FormData();
    if (reply.text) form.append('text', reply.text);
    if (reply.durationMs !== undefined) form.append('durationMs', String(Math.round(reply.durationMs)));
    if (reply.audio) form.append('audio', reply.audio, 'reply');
    return this.client.post<TasmiSubmission>(`/tasmi/${id}/reply`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
  }

  getTasmiReplyAudioLink(id: string) {
    return this.client.get<{ url: string }>(`/tasmi/${id}/reply-audio-link`);
  }

  disputeFlag(id: string, flagId: string) {
    return this.client.post<TasmiSubmission>(`/tasmi/${id}/flags/${flagId}/dispute`);
  }

  getVoiceStatus() {
    return this.client.get<{ available: boolean; provider: string | null; included: boolean; enabled: boolean }>('/voice/status');
  }

  setAiChecking(enabled: boolean) {
    return this.client.put<{ enabled: boolean }>('/voice/institution', { enabled });
  }

  deleteTasmiAudio(id: string) {
    return this.client.delete(`/tasmi/${id}/audio`);
  }

  getPendingTasmi(sectionId?: string) {
    return this.client.get<TasmiSubmission[]>('/tasmi/pending', { params: { sectionId } });
  }

  reviewTasmi(id: string, data: TasmiReviewInput) {
    return this.client.post<TasmiSubmission>(`/tasmi/${id}/review`, data);
  }

  // Reports
  getWeeklyReport(studentId: string, week?: string) {
    return this.client.get<WeeklyReport>(`/reports/student/${studentId}/weekly`, { params: { week } });
  }

  getMonthlyRecord(studentId: string, month?: string) {
    return this.client.get<MonthlyRecord>(`/reports/student/${studentId}/monthly`, { params: { month } });
  }

  saveMonthlyAppraisal(studentId: string, month: string, note: string) {
    return this.client.put<MonthlyRecord>(`/reports/student/${studentId}/monthly/appraisal`, { month, note });
  }

  getGuardianStudents() {
    return this.client.get<{ students: WeeklyReport[] }>('/guardian/students');
  }

  // Quran text
  getAyat(refs: string[]) {
    return this.client.get<AyatResponse>('/ayat', { params: { refs: refs.join(',') } });
  }

  getAyatRange(start: string, end: string) {
    return this.client.get<AyatResponse>('/ayat/range', { params: { start, end } });
  }

  // Notifications
  getNotifications() {
    return this.client.get<AppNotification[]>('/notifications');
  }
}

export function saveSession(session: { token: string; refreshToken: string; user?: ApiUser }) {
  localStorage.setItem(TOKEN_KEY, session.token);
  localStorage.setItem(REFRESH_KEY, session.refreshToken);
  if (session.user) localStorage.setItem(USER_KEY, JSON.stringify(session.user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}

/** Where each role lands after signing in. */
export function homeFor(role: Role | undefined | null) {
  if (role === 'student' || role === 'alumna') return '/dashboard';
  if (role === 'mahram') return '/guardian';
  if (role === 'dean' || role === 'advisor' || role === 'operator' || role === 'superadmin') return '/admin';
  return '/dashboard/teacher';
}

export const api = new ApiClient();

export const queryKeys = {
  me: ['auth', 'me'] as const,
  sections: ['sections'] as const,
  queue: ['scheduler', 'queue'] as const,
  stats: ['scheduler', 'stats'] as const,
  sectionStudents: (id: string) => ['sections', id, 'students'] as const,
  sectionReport: (id: string) => ['sections', id, 'report'] as const,
  attendance: (id: string, date: string) => ['sections', id, 'attendance', date] as const,
  guardians: (sectionId: string, studentId: string) => ['sections', sectionId, 'guardians', studentId] as const,
  plan: (sectionId: string, studentId: string) => ['sections', sectionId, 'plan', studentId] as const,
  monthly: (studentId: string, month: string) => ['reports', 'monthly', studentId, month] as const,
  myTasmi: ['tasmi', 'mine'] as const,
  voiceStatus: ['voice', 'status'] as const,
  badges: ['badges'] as const,
  adminOverview: (tenantId?: string) => ['admin', 'overview', tenantId ?? 'own'] as const,
  adminTenants: ['admin', 'tenants'] as const,
  adminSetup: ['admin', 'setup'] as const,
  pilot: (tenantId?: string) => ['admin', 'pilot', tenantId ?? 'own'] as const,
  myClusters: ['mutashabihat', 'mine'] as const,
  clusters: (status: string) => ['mutashabihat', 'clusters', status] as const,
  pendingTasmi: (sectionId?: string) => ['tasmi', 'pending', sectionId] as const,
  guardianStudents: ['guardian', 'students'] as const,
  ayat: (source: string) => ['ayat', source] as const,
  notifications: ['notifications'] as const,
} as const;
