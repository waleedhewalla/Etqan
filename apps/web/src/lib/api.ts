import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { useAuth } from './auth-context';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: `${API_URL}/v1`,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    // Request interceptor - add auth token
    this.client.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        const token = localStorage.getItem('itqan_token');
        if (token && config.headers) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        // Add idempotency key for mutations
        if (['post', 'put', 'patch', 'delete'].includes(config.method || '')) {
          config.headers['Idempotency-Key'] = crypto.randomUUID();
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor - handle errors
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;
          
          // Try to refresh token
          try {
            const refreshToken = localStorage.getItem('itqan_refresh_token');
            if (refreshToken) {
              const res = await axios.post(`${API_URL}/v1/auth/refresh`, { refreshToken });
              const { accessToken, refreshToken: newRefreshToken } = res.data;
              
              localStorage.setItem('itqan_token', accessToken);
              localStorage.setItem('itqan_refresh_token', newRefreshToken);
              
              originalRequest.headers.Authorization = `Bearer ${accessToken}`;
              return this.client(originalRequest);
            }
          } catch {
            // Refresh failed - logout
            localStorage.removeItem('itqan_token');
            localStorage.removeItem('itqan_refresh_token');
            localStorage.removeItem('itqan_user');
            window.location.href = '/auth/login';
          }
        }

        // Format error response
        if (error.response?.data) {
          const data = error.response.data as any;
          error.message = data.detail || data.title || error.message;
        }

        return Promise.reject(error);
      }
    );
  }

  // Auth
  async requestOtp(whatsapp: string) {
    return this.client.post('/auth/otp/request', { whatsapp });
  }

  async verifyOtp(whatsapp: string, code: string) {
    return this.client.post('/auth/otp/verify', { whatsapp, code });
  }

  async magicLink(email: string) {
    return this.client.post('/auth/magic-link', { email });
  }

  async verifyMagicLink(token: string) {
    return this.client.post('/auth/magic-link/verify', { token });
  }

  async getMe() {
    return this.client.get('/users/me');
  }

  // Sections
  async getSections() {
    return this.client.get('/sections');
  }

  async getSection(id: string) {
    return this.client.get(`/sections/${id}`);
  }

  async joinSection(code: string) {
    return this.client.post('/sections/join', { code });
  }

  // Learning
  async getTodayQueue() {
    return this.client.get('/learning/today');
  }

  async startSession() {
    return this.client.post('/sessions');
  }

  async getSession(id: string) {
    return this.client.get(`/sessions/${id}`);
  }

  async rateItem(sessionId: string, itemId: string, rating: string) {
    return this.client.post(`/sessions/${sessionId}/items/${itemId}/rate`, { rating });
  }

  async completeSession(sessionId: string) {
    return this.client.post(`/sessions/${sessionId}/complete`);
  }

  // Voice
  async submitRecitation(sessionId: string, audioBlob: Blob, ayahRef: string, retain = false) {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recitation.webm');
    formData.append('ayah_ref', ayahRef);
    formData.append('retain', retain.toString());
    
    return this.client.post(`/sessions/${sessionId}/recite`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  }

  // Tasmi'
  async submitTasmi(data: { ayahRange: string; purpose: string; audioBlob: Blob }) {
    const formData = new FormData();
    formData.append('audio', data.audioBlob, 'tasmi.webm');
    formData.append('ayah_range', data.ayahRange);
    formData.append('purpose', data.purpose);
    
    return this.client.post('/tasmi/submissions', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  }

  async getTasmiQueue() {
    return this.client.get('/tasmi/queue');
  }

  async reviewTasmi(id: string, data: any) {
    return this.client.post(`/tasmi/${id}/assessment`, data);
  }

  // Progress
  async getProgress(studentId?: string) {
    return this.client.get('/progress', { params: { student_id: studentId } });
  }

  async getMilestones(studentId?: string) {
    return this.client.get('/milestones', { params: { student_id: studentId } });
  }

  // Mutashabihat
  async getMutashabihat(ayah?: string) {
    return this.client.get('/mutashabihat', { params: { ayah } });
  }

  async getCluster(id: string) {
    return this.client.get(`/mutashabihat/${id}`);
  }

  // Mushaf
  async getAyat(refs: string) {
    return this.client.get('/ayat', { params: { refs } });
  }

  async getRecitations(ayahRef: string, reciter?: string) {
    return this.client.get(`/ayat/${ayahRef}/recitations`, { params: { reciter } });
  }

  // Teacher endpoints
  async getSectionHealth(sectionId: string) {
    return this.client.get(`/sections/${sectionId}/health`);
  }

  async getStudentProfile(sectionId: string, studentId: string) {
    return this.client.get(`/sections/${sectionId}/students/${studentId}`);
  }

  async sendIntervention(sectionId: string, data: any) {
    return this.client.post(`/sections/${sectionId}/messages`, data);
  }

  async exportSectionReport(sectionId: string) {
    return this.client.get(`/sections/${sectionId}/report`, { responseType: 'blob' });
  }

  // Admin
  async getDashboard() {
    return this.client.get('/admin/dashboard');
  }

  async getAuditLog(params: any) {
    return this.client.get('/admin/audit', { params });
  }
}

export const api = new ApiClient();

// React Query hooks
export function useApi() {
  return api;
}

// Typed query keys
export const queryKeys = {
  auth: {
    me: ['auth', 'me'] as const,
  },
  sections: {
    all: ['sections'] as const,
    detail: (id: string) => ['sections', id] as const,
    health: (id: string) => ['sections', id, 'health'] as const,
    students: (id: string) => ['sections', id, 'students'] as const,
    student: (sectionId: string, studentId: string) => ['sections', sectionId, 'students', studentId] as const,
  },
  learning: {
    today: ['learning', 'today'] as const,
    session: (id: string) => ['sessions', id] as const,
    progress: (studentId?: string) => ['progress', studentId] as const,
    milestones: (studentId?: string) => ['milestones', studentId] as const,
  },
  tasmi: {
    queue: ['tasmi', 'queue'] as const,
    detail: (id: string) => ['tasmi', id] as const,
  },
  mutashabihat: {
    all: ['mutashabihat'] as const,
    byAyah: (ayah: string) => ['mutashabihat', 'ayah', ayah] as const,
    cluster: (id: string) => ['mutashabihat', id] as const,
  },
  mushaf: {
    ayat: (refs: string) => ['ayat', refs] as const,
    recitations: (ayahRef: string, reciter?: string) => ['ayat', ayahRef, 'recitations', reciter] as const,
  },
  teacher: {
    dashboard: ['teacher', 'dashboard'] as const,
    sectionHealth: (id: string) => ['teacher', 'sections', id, 'health'] as const,
    studentProfile: (sectionId: string, studentId: string) => ['teacher', 'sections', sectionId, 'students', studentId] as const,
  },
  admin: {
    dashboard: ['admin', 'dashboard'] as const,
    audit: (params: any) => ['admin', 'audit', params] as const,
  },
} as const;