'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LoginSchema } from '@nova/shared';
import { Button, Card, Input, PasswordInput } from '@nova/ui';
import { NovaLogo } from '../../components/NovaLogo';
import { NovaApiError, apiClient } from '../../lib/api';

interface LoginFieldErrors {
  email?: string;
  password?: string;
}

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState<{ email: boolean; password: boolean }>({
    email: false,
    password: false,
  });
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => apiClient.login({ email: email.trim().toLowerCase(), password }),
    onSuccess: (data) => {
      queryClient.clear();
      apiClient.setAccessToken(data.accessToken);
      router.push('/dashboard');
    },
    onError: (err) => {
      if (err instanceof NovaApiError) {
        setFormError(err.message);
      } else {
        setFormError('Unable to sign in. Please try again.');
      }
    },
  });

  function validateField(field: keyof LoginFieldErrors, value: string): string | undefined {
    if (field === 'email') {
      const parsed = LoginSchema.shape.email.safeParse(value);
      return parsed.success ? undefined : 'Enter a valid email address.';
    }
    const parsed = LoginSchema.shape.password.safeParse(value);
    return parsed.success ? undefined : 'Password is required.';
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const parsed = LoginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const nextErrors: LoginFieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === 'email' && !nextErrors.email) {
          nextErrors.email = 'Enter a valid email address.';
        } else if (key === 'password' && !nextErrors.password) {
          nextErrors.password = 'Password is required.';
        }
      }
      setFieldErrors(nextErrors);
      setTouched({ email: true, password: true });
      return;
    }
    mutation.mutate();
  }

  return (
    <main className="min-h-screen nova-auth-bg flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-8 shadow-2xl">
        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-2">
            <NovaLogo />
            <h1 className="text-[20px] font-semibold text-[var(--text-primary)] mt-2 mb-0">
              Sign in to your studio
            </h1>
            <p className="text-[13px] text-[var(--text-secondary)] m-0">
              Collaborate in real time with your creative team.
            </p>
          </header>

          {formError ? (
            <div
              role="alert"
              className="px-3 py-2.5 rounded-[var(--radius-control)] border border-[var(--danger)]/50 bg-[var(--danger)]/10 text-[13px] text-[var(--danger)]"
            >
              {formError}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            <Input
              id="login-email"
              name="email"
              type="email"
              label="Email"
              placeholder="designer@nova.dev"
              autoComplete="email"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              error={fieldErrors.email}
              onChange={(e) => {
                const val = e.target.value;
                setEmail(val);
                if (fieldErrors.email) {
                  setFieldErrors((prev) => ({ ...prev, email: undefined }));
                }
                if (formError) setFormError(null);
              }}
              onBlur={() => {
                if (email.length > 0 || touched.email) {
                  setTouched((prev) => ({ ...prev, email: true }));
                  setFieldErrors((prev) => ({ ...prev, email: validateField('email', email) }));
                }
              }}
              required
            />

            <PasswordInput
              id="login-password"
              name="password"
              label="Password"
              placeholder="Enter your password"
              autoComplete="current-password"
              value={password}
              error={fieldErrors.password}
              onChange={(e) => {
                const val = e.target.value;
                setPassword(val);
                if (fieldErrors.password) {
                  setFieldErrors((prev) => ({ ...prev, password: undefined }));
                }
                if (formError) setFormError(null);
              }}
              onBlur={() => {
                if (password.length > 0 || touched.password) {
                  setTouched((prev) => ({ ...prev, password: true }));
                  setFieldErrors((prev) => ({
                    ...prev,
                    password: validateField('password', password),
                  }));
                }
              }}
              required
            />

            <Button
              type="submit"
              size="lg"
              loading={mutation.isPending}
              className="w-full mt-2"
            >
              {mutation.isPending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <footer className="text-[13px] text-[var(--text-secondary)] text-center pt-2 border-t border-[var(--border)]">
            New to NOVA STUDIO?{' '}
            <Link
              href="/register"
              className="text-[var(--accent-2)] hover:underline font-medium"
            >
              Create an account
            </Link>
          </footer>
        </div>
      </Card>
    </main>
  );
}
