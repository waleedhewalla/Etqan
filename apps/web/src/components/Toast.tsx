'use client';

import { createContext, useContext, useState, ReactNode } from 'react';
import { Toast, ToastProvider as UIToastProvider } from '@itqan/ui';

interface ToastMessage {
  id: string;
  variant: 'info' | 'success' | 'warning' | 'error' | 'mahram-notification';
  title?: string;
  description?: string;
  action?: React.ReactNode;
  duration?: number;
}

interface ToastContextType {
  toast: (message: Omit<ToastMessage, 'id'>) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const toast = (message: Omit<ToastMessage, 'id'>) => {
    const id = Math.random().toString(36).slice(2, 9);
    const newToast = { ...message, id };
    setToasts(prev => [...prev, newToast]);
    
    if (message.duration !== 0) {
      setTimeout(() => {
        dismiss(id);
      }, message.duration || 5000);
    }
    
    return id;
  };

  const dismiss = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <UIToastProvider>
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[320px] sm:w-[380px]" dir="ltr">
          {toasts.map(t => (
            <Toast
              key={t.id}
              variant={t.variant}
              title={t.title}
              description={t.description}
              action={t.action}
              onDismiss={() => dismiss(t.id)}
            />
          ))}
        </div>
      </UIToastProvider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

// Convenience methods
export const toast = {
  info: (title: string, description?: string) => 
    ({ title, description, variant: 'info' as const }),
  success: (title: string, description?: string) => 
    ({ title, description, variant: 'success' as const }),
  warning: (title: string, description?: string) => 
    ({ title, description, variant: 'warning' as const }),
  error: (title: string, description?: string) => 
    ({ title, description, variant: 'error' as const }),
  mahram: (title: string, description?: string) => 
    ({ title, description, variant: 'mahram-notification' as const }),
};