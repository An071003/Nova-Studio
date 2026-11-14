'use client';

import { forwardRef, useId, type SelectHTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { id, label, error, className, children, ...props },
  ref,
) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const errorId = `${selectId}-error`;

  return (
    <div className="flex flex-col gap-1.5 w-full">
      {label ? (
        <label
          htmlFor={selectId}
          className="text-[13px] font-medium text-[var(--text-primary)] select-none"
        >
          {label}
        </label>
      ) : null}
      <select
        ref={ref}
        id={selectId}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          'w-full h-9 px-3 rounded-[var(--radius-control)] bg-[var(--bg-app)] text-[var(--text-primary)] border border-[var(--border)] transition-colors duration-150 hover:border-[var(--border-strong)] focus:border-[var(--accent-2)] disabled:opacity-50 disabled:cursor-not-allowed',
          error ? 'border-[var(--danger)]' : null,
          className,
        )}
        {...props}
      >
        {children}
      </select>
      {error ? (
        <p id={errorId} className="text-[12px] text-[var(--danger)]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
});
