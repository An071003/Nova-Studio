import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Providers } from '../components/Providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'NOVA STUDIO — Collaborative Canvas',
  description: 'Multiplayer creative workspace for realtime collaborative design.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta name="color-scheme" content="dark" />
      </head>
      <body className="min-h-screen bg-[var(--bg-app)] text-[var(--text-primary)] antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
