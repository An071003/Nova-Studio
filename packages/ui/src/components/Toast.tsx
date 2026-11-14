'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../lib/cn.js';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
}

export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  durationMs?: number;
}

interface ToastContextValue {
  pushToast: (input: ToastInput) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const toneClasses: Record<ToastTone, string> = {
  info: 'border-[var(--border-strong)] bg-[var(--bg-elevated)]',
  success: 'border-[var(--success)]/50 bg-[var(--bg-elevated)]',
  warning: 'border-[var(--warning)]/50 bg-[var(--bg-elevated)]',
  danger: 'border-[var(--danger)]/60 bg-[var(--bg-elevated)]',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const pushToast = useCallback(
    ({ title, description, tone = 'info', durationMs = 4000 }: ToastInput) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setItems((prev) => [...prev, { id, title, description, tone }]);
      if (durationMs > 0) {
        setTimeout(() => {
          dismissToast(id);
        }, durationMs);
      }
    },
    [dismissToast],
  );

  return (
    <ToastContext.Provider value={{ pushToast, dismissToast }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none"
      >
        {items.map((item) => (
          <div
            key={item.id}
            role={item.tone === 'danger' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex items-start justify-between gap-3 p-3 rounded-[var(--radius-panel)] border shadow-lg text-[var(--text-primary)]',
              toneClasses[item.tone],
            )}
          >
            <div className="flex flex-col gap-0.5 min-w-0">
              <p className="text-[13px] font-medium m-0">{item.title}</p>
              {item.description ? (
                <p className="text-[12px] text-[var(--text-secondary)] m-0">{item.description}</p>
              ) : null}
            </div>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismissToast(item.id)}
              className="inline-flex items-center justify-center w-6 h-6 rounded-[var(--radius-control)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}
