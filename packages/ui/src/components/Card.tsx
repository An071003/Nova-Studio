import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'bg-[var(--bg-panel)] border border-[var(--border)] rounded-[var(--radius-panel)]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
