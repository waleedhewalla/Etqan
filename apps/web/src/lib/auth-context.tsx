'use client';

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api, clearSession, homeFor, saveSession, TOKEN_KEY, USER_KEY, type ApiUser, type Role, type SessionResponse } from './api';

interface AuthContextType {
  user: ApiUser | null;
  role: Role | null;
  isLoading: boolean;
  login: (session: SessionResponse) => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function readStoredUser(): ApiUser | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const raw = localStorage.getItem(USER_KEY);
    return token && raw ? (JSON.parse(raw) as ApiUser) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setUser(readStoredUser());
    setIsLoading(false);
  }, []);

  const login = useCallback((session: SessionResponse) => {
    saveSession(session);
    setUser(session.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Signing out locally is enough if the server can't be reached.
    }
    clearSession();
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const res = await api.getMe();
    localStorage.setItem(USER_KEY, JSON.stringify(res.data.user));
    setUser(res.data.user);
  }, []);

  return (
    <AuthContext.Provider value={{ user, role: user?.role ?? null, isLoading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}

/**
 * Sends signed-out visitors to the login page and people with the wrong role
 * to their own home. Returns the user once it is allowed to render.
 */
export function useRequireRole(allowed: Role[], loginPath = '/auth/login') {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const ok = Boolean(user && allowed.includes(user.role));

  useEffect(() => {
    if (isLoading) return;
    if (!user) router.replace(loginPath);
    else if (!allowed.includes(user.role)) router.replace(homeFor(user.role));
  }, [isLoading, user, loginPath]);

  return { user: ok ? user : null, ready: !isLoading && ok };
}
