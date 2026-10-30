import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

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
  | 'voice_recording' | 'analytics' | 'mahram_access' | 'whatsapp_notifications' | 'peer_comparison' | 'data_export';

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
    sabaq: { count: number; items: QueueItem[]; locked: boolean };
  };
  totalItems: number;
  estimatedMinutes: number;
  streak: Streak;
  assignments: Assignment[];
}

export interface RateResponse {
  card: { id: string; dueAt: string; state: string };
  streak: Streak;
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

export interface TasmiSubmission {
  id: string;
  studentId: string;
  studentName?: string;
  sectionId: string | null;
  startRef: string;
  endRef: string;
  audioUrl: string;
  durationMs: number | null;
  submittedAt: string;
  reviewVerdict: 'approved' | 'redo' | 'flagged' | null;
  reviewWeightedTotal: number | null;
}

export interface TasmiReviewInput {
  hifzScore: number;
  tajweedScore: number;
  fluencyScore: number;
  verdict: 'approved' | 'redo' | 'flagged';
  notes?: string;
}

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
  if (code === 'ACCOUNT_NOT_FOUND') return 'لا يوجد حساب بهذا الرقم. اطلبي كود الشعبة من معلمتك.';
  if (e?.response?.status === 429) return 'محاولات كثيرة. انتظري قليلاً ثم حاولي مرة أخرى.';
  if (!e?.response) return 'تعذّر الاتصال بالخادم. تحققي من الإنترنت.';
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
    return this.client.post<{ expiresIn: number }>('/auth/otp/request', { whatsapp, joinCode });
  }

  verifyOtp(whatsapp: string, code: string, joinCode?: string) {
    return this.client.post<SessionResponse>('/auth/otp/verify', { whatsapp, code, joinCode });
  }

  magicLink(email: string) {
    return this.client.post('/auth/magic-link', { email });
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

  getStats() {
    return this.client.get<StatsResponse>('/scheduler/stats');
  }

  // Tasmi'
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

  getGuardianStudents() {
    return this.client.get<{ students: WeeklyReport[] }>('/guardian/students');
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
  // Admins use the teacher dashboard (it lists every halaqa in their institution)
  // until the admin console is connected to real data.
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
  pendingTasmi: (sectionId?: string) => ['tasmi', 'pending', sectionId] as const,
  guardianStudents: ['guardian', 'students'] as const,
  notifications: ['notifications'] as const,
} as const;
