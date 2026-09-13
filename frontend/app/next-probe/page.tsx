import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Next runtime probe',
  robots: { index: false, follow: false },
};

// Kept for staging device/E2E diagnostics, never exposed by a production build.
export default function NextProbePage() {
  if (process.env.VERCEL_ENV === 'production' || process.env.VERCEL_GIT_COMMIT_REF === 'main') notFound();
  return (
    <main style={{ fontFamily: 'monospace', padding: '2rem' }}>
      <h1>next-probe</h1>
      <p>implementation: next</p>
      <p>release: {process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev'}</p>
      <p>env: {process.env.VERCEL_ENV ?? 'local'}</p>
    </main>
  );
}
