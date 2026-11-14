'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, MailCheck } from 'lucide-react';
import { Button, Card, useToast } from '@nova/ui';
import { NovaLogo } from '../../../components/NovaLogo';
import { NovaApiError, apiClient } from '../../../lib/api';
import { buildAuthHref } from '../../../lib/safe-next';

export default function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => apiClient.getMe(),
    retry: false,
  });

  const acceptMutation = useMutation({
    mutationFn: () => apiClient.acceptInvite(token),
    onSuccess: async ({ workspace }) => {
      setAcceptError(null);
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      pushToast({
        title: `Joined ${workspace.name}`,
        description: `Access role: ${workspace.role}`,
        tone: 'success',
      });
      router.replace(`/dashboard?workspaceId=${encodeURIComponent(workspace.id)}`);
    },
    onError: (err) => {
      const msg =
        err instanceof NovaApiError ? err.message : 'Unable to accept this invitation.';
      setAcceptError(msg);
      pushToast({ title: 'Invite acceptance failed', description: msg, tone: 'danger' });
    },
  });

  const invitePath = `/invite/${encodeURIComponent(token)}`;
  const isUnauthenticated =
    meQuery.error instanceof NovaApiError && meQuery.error.status === 401;

  return (
    <main className="min-h-screen nova-auth-bg flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-8 shadow-2xl">
        <div className="flex flex-col gap-5">
          <header className="flex flex-col gap-2">
            <NovaLogo />
            <div className="flex items-center gap-2 mt-2">
              <MailCheck className="w-5 h-5 text-[var(--accent-2)]" aria-hidden="true" />
              <h1 className="text-[20px] font-semibold text-[var(--text-primary)] m-0">
                Workspace invitation
              </h1>
            </div>
            <p className="text-[13px] text-[var(--text-secondary)] m-0">
              Accept this invitation to collaborate in NOVA STUDIO.
            </p>
          </header>

          {meQuery.isLoading ? (
            <p className="text-[13px] text-[var(--text-secondary)] m-0">
              Checking your studio session…
            </p>
          ) : isUnauthenticated ? (
            <div className="flex flex-col gap-3">
              <p className="text-[13px] text-[var(--text-secondary)] m-0">
                Sign in or create an account to join this workspace.
              </p>
              <div className="flex flex-wrap gap-2">
                <Link href={buildAuthHref('/login', invitePath)} className="flex-1">
                  <Button variant="primary" className="w-full">
                    Sign in to accept
                  </Button>
                </Link>
                <Link href={buildAuthHref('/register', invitePath)} className="flex-1">
                  <Button variant="secondary" className="w-full">
                    Create account
                  </Button>
                </Link>
              </div>
            </div>
          ) : meQuery.isError ? (
            <div className="flex flex-col gap-3">
              <div
                role="alert"
                className="px-3 py-2.5 rounded-[var(--radius-control)] border border-[var(--danger)]/50 bg-[var(--danger)]/10 text-[13px] text-[var(--danger)]"
              >
                {meQuery.error instanceof Error
                  ? meQuery.error.message
                  : 'Unable to load your account session.'}
              </div>
              <Button variant="secondary" onClick={() => void meQuery.refetch()}>
                Retry
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--bg-app)] p-3 text-[13px]">
                Signed in as{' '}
                <span className="font-medium text-[var(--text-primary)]">
                  {meQuery.data?.user.name}
                </span>{' '}
                <span className="text-[var(--text-secondary)]">
                  ({meQuery.data?.user.email})
                </span>
              </div>

              {acceptError ? (
                <div
                  role="alert"
                  className="px-3 py-2.5 rounded-[var(--radius-control)] border border-[var(--danger)]/50 bg-[var(--danger)]/10 text-[13px] text-[var(--danger)]"
                >
                  {acceptError}
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-2">
                <Link href="/dashboard">
                  <Button variant="secondary">Back to dashboard</Button>
                </Link>
                <Button
                  data-testid="accept-invite-btn"
                  loading={acceptMutation.isPending}
                  onClick={() => acceptMutation.mutate()}
                >
                  <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  <span>{acceptMutation.isPending ? 'Joining…' : 'Accept invitation'}</span>
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>
    </main>
  );
}
