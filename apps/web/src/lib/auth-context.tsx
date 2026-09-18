'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User, Role } from '@itqan/types';

interface AuthContextType {
  user: User | null;
  role: Role | null;
  token: string | null;
  isLoading: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Initialize auth from localStorage
    const storedToken = localStorage.getItem('itqan_token');
    const storedUser = localStorage.getItem('itqan_user');
    
    if (storedToken && storedUser) {
      try {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
      } catch {
        localStorage.removeItem('itqan_token');
        localStorage.removeItem('itqan_user');
      }
    }
    setIsLoading(false);
  }, []);

  const login = (newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('itqan_token', newToken);
    localStorage.setItem('itqan_user', JSON.stringify(newUser));
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('itqan_token');
    localStorage.removeItem('itqan_user');
  };

  const refreshUser = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const userData = await res.json();
        setUser(userData);
        localStorage.setItem('itqan_user', JSON.stringify(userData));
      } else {
        logout();
      }
    } catch {
      logout();
    }
  };

  return (
    <AuthContext.Provider value={{ user, role: user?.role || null, token, isLoading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}