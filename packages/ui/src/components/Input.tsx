'use client';

import { forwardRef, useId, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '../lib/cn.js';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

const baseInputClassName =
  'w-full h-10 px-3 rounded-[var(--radius-control)] bg-[var(--bg-app)] text-[var(--text-primary)] border border-[var(--border)] placeholder:text-[var(--text-secondary)]/70 transition-colors duration-150 hover:border-[var(--border-strong)] focus:border-[var(--accent-2)] disabled:opacity-50 disabled:cursor-not-allowed';

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { id, label, error, hint, className, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;

  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1.5 w-full">
      {label ? (
        <label
          htmlFor={inputId}
          className="text-[13px] font-medium text-[var(--text-primary)] select-none"
        >
          {label}
        </label>
      ) : null}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
        className={cn(
          baseInputClassName,
          error ? 'border-[var(--danger)] focus:border-[var(--danger)]' : null,
          className,
        )}
        {...props}
      />
      {hint ? (
        <p id={hintId} className="text-[12px] text-[var(--text-secondary)]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-[12px] text-[var(--danger)]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
});

export interface PasswordInputProps extends Omit<InputProps, 'type'> {
  toggleLabelShow?: string;
  toggleLabelHide?: string;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput(
    {
      id,
      label,
      error,
      hint,
      className,
      toggleLabelShow = 'Show password',
      toggleLabelHide = 'Hide password',
      ...props
    },
    ref,
  ) {
    const [visible, setVisible] = useState(false);
    const autoId = useId();
    const inputId = id ?? autoId;
    const errorId = `${inputId}-error`;
    const hintId = `${inputId}-hint`;

    const describedBy =
      [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label ? (
          <label
            htmlFor={inputId}
            className="text-[13px] font-medium text-[var(--text-primary)] select-none"
          >
            {label}
          </label>
        ) : null}
        <div className="relative flex items-center">
          <input
            ref={ref}
            id={inputId}
            type={visible ? 'text' : 'password'}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={describedBy}
            className={cn(
              baseInputClassName,
              'pr-10',
              error ? 'border-[var(--danger)] focus:border-[var(--danger)]' : null,
              className,
            )}
            {...props}
          />
          <button
            type="button"
            aria-pressed={visible}
            aria-label={visible ? toggleLabelHide : toggleLabelShow}
            onClick={() => setVisible((prev) => !prev)}
            className="absolute right-2 inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-control)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
          >
            {visible ? (
              <EyeOff className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Eye className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        </div>
        {hint ? (
          <p id={hintId} className="text-[12px] text-[var(--text-secondary)]">
            {hint}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} className="text-[12px] text-[var(--danger)]" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  },
);
