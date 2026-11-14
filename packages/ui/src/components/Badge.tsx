import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export type BadgeVariant = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  children: ReactNode;
}

const variantClasses: Record<BadgeVariant, string> = {
  neutral: 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border)]',
  accent: 'bg-[var(--accent)]/15 text-[var(--text-primary)] border-[var(--accent)]/40',
  success: 'bg-[var(--success)]/15 text-[var(--success)] border-[var(--success)]/40',
  warning: 'bg-[var(--warning)]/15 text-[var(--warning)] border-[var(--warning)]/40',
  danger: 'bg-[var(--danger)]/15 text-[var(--danger)] border-[var(--danger)]/40',
};

export function Badge({
  variant = 'neutral',
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 text-[12px] font-medium rounded-[var(--radius-control)] border',
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
