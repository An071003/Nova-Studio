'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '../lib/api';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await apiClient.getMe();
        if (active) router.replace('/dashboard');
      } catch {
        if (active) router.replace('/login');
      }
    })();
    return () => {
      active = false;
    };
  }, [router]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-[var(--bg-app)]">
      <div className="flex items-center gap-3 text-[var(--text-secondary)] text-[14px]">
        <span
          aria-hidden="true"
          className="inline-block w-2.5 h-2.5 rounded-full bg-[var(--accent)] animate-pulse"
        />
        <span>Loading NOVA STUDIO…</span>
      </div>
    </main>
  );
}
