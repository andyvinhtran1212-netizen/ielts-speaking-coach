import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { diagnosticRoutesEnabled } from '@/lib/diagnostic-routes.mjs';

// BL-01: gate the metadata too. With a static `metadata` export the disabled
// route's 404 still carried this debug title (hoisted after hydration);
// failing here gives it the same head as any unknown URL ("Aver Learning").
export function generateMetadata(): Metadata {
  if (!diagnosticRoutesEnabled()) notFound();
  return {
    title: 'Next runtime probe',
    robots: { index: false, follow: false },
  };
}

// Engineering diagnostics only (U-03): not-found on every deployment unless
// `next dev` or AVER_ENABLE_DIAGNOSTIC_ROUTES=1 (not set on staging).
//
// Deliberately STATIC: the gate is evaluated when the page is prerendered, i.e.
// with the deployment's own build env (Vercel builds each deployment with that
// environment's variables and env changes need a redeploy anyway), and a
// disabled build ships a prerendered 404 with a real 404 status. A request-time
// gate (`connection()`) would stream behind the root Suspense shell under Cache
// Components and turn notFound() into a 200 soft-404.
export default function NextProbePage() {
  if (!diagnosticRoutesEnabled()) notFound();
  return (
    <main style={{ fontFamily: 'monospace', padding: '2rem' }}>
      <h1>next-probe</h1>
      <p>implementation: next</p>
      <p>release: {process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev'}</p>
      <p>env: {process.env.VERCEL_ENV ?? 'local'}</p>
    </main>
  );
}
