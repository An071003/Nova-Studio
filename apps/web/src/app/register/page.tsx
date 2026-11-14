'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RegisterSchema } from '@nova/shared';
import { Button, Card, Input, PasswordInput } from '@nova/ui';
import { NovaLogo } from '../../components/NovaLogo';
import { NovaApiError, apiClient } from '../../lib/api';

interface RegisterFieldErrors {
  name?: string;
  email?: string;
  password?: string;
}

export default function RegisterPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState<{ name: boolean; email: boolean; password: boolean }>({
    name: false,
    email: false,
    password: false,
  });
  const [fieldErrors, setFieldErrors] = useState<RegisterFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.register({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
      }),
    onSuccess: (data) => {
      queryClient.clear();
      apiClient.setAccessToken(data.accessToken);
      router.push('/dashboard');
    },
    onError: (err) => {
      if (err instanceof NovaApiError) {
        setFormError(err.message);
      } else {
        setFormError('Unable to create account. Please try again.');
      }
    },
  });

  function validateField(field: keyof RegisterFieldErrors, value: string): string | undefined {
    if (field === 'name') {
      return RegisterSchema.shape.name.safeParse(value).success
        ? undefined
        : 'Display name is required.';
    }
    if (field === 'email') {
      return RegisterSchema.shape.email.safeParse(value).success
        ? undefined
        : 'Enter a valid email address.';
    }
    return RegisterSchema.shape.password.safeParse(value).success
      ? undefined
      : 'Password must be at least 8 characters.';
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const parsed = RegisterSchema.safeParse({ name, email, password });
    if (!parsed.success) {
      const nextErrors: RegisterFieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === 'name' && !nextErrors.name) {
          nextErrors.name = 'Display name is required.';
        } else if (key === 'email' && !nextErrors.email) {
          nextErrors.email = 'Enter a valid email address.';
        } else if (key === 'password' && !nextErrors.password) {
          nextErrors.password = 'Password must be at least 8 characters.';
        }
      }
      setFieldErrors(nextErrors);
      setTouched({ name: true, email: true, password: true });
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
              Create your NOVA account
            </h1>
            <p className="text-[13px] text-[var(--text-secondary)] m-0">
              Start designing together in seconds.
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
              id="register-name"
              name="name"
              type="text"
              label="Full name"
              placeholder="Alex Rivera"
              autoComplete="name"
              value={name}
              error={fieldErrors.name}
              onChange={(e) => {
                setName(e.target.value);
                if (fieldErrors.name) {
                  setFieldErrors((prev) => ({ ...prev, name: undefined }));
                }
                if (formError) setFormError(null);
              }}
              onBlur={() => {
                if (name.length > 0 || touched.name) {
                  setTouched((prev) => ({ ...prev, name: true }));
                  setFieldErrors((prev) => ({ ...prev, name: validateField('name', name) }));
                }
              }}
              required
            />

            <Input
              id="register-email"
              name="email"
              type="email"
              label="Email"
              placeholder="alex@nova.dev"
              autoComplete="email"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              error={fieldErrors.email}
              onChange={(e) => {
                setEmail(e.target.value);
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
              id="register-password"
              name="password"
              label="Password"
              placeholder="Minimum 8 characters"
              hint="Use at least 8 characters."
              autoComplete="new-password"
              value={password}
              error={fieldErrors.password}
              onChange={(e) => {
                setPassword(e.target.value);
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
              {mutation.isPending ? 'Creating account…' : 'Create account'}
            </Button>
          </form>

          <footer className="text-[13px] text-[var(--text-secondary)] text-center pt-2 border-t border-[var(--border)]">
            Already have an account?{' '}
            <Link
              href="/login"
              className="text-[var(--accent-2)] hover:underline font-medium"
            >
              Sign in
            </Link>
          </footer>
        </div>
      </Card>
    </main>
  );
}
