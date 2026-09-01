import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import HydratedSignal from '@/components/hydrated-signal';
import LegacyModule from '@/components/legacy-module';
import { watchdogScript } from '@/lib/watchdog-script';

import { AdminListeningMcq } from './admin-listening-mcq';

export const metadata: Metadata = {
  title: 'Biên tập Multiple Choice · Admin Listening',
  robots: { index: false, follow: false },
};

async function McqRoute({ searchParams }: { searchParams: Promise<{ content_id?: string; exercise_id?: string }> }) {
  const query = await searchParams;
  const contentId = String(query.content_id || '').trim();
  if (!contentId) redirect('/admin/listening');
  return <>
    <HydratedSignal />
    <LegacyModule src="/js/components/audio-player.js" />
    <script dangerouslySetInnerHTML={{ __html: watchdogScript('/pages/admin/listening/mcq.html') }} />
    <aver-admin-chrome active="listening" subsection="mcq">
      <AdminAccessGate>
        <AdminListeningMcq contentId={contentId} requestedExerciseId={String(query.exercise_id || '').trim() || null} />
      </AdminAccessGate>
    </aver-admin-chrome>
  </>;
}

export default function AdminListeningMcqPage({ searchParams }: { searchParams: Promise<{ content_id?: string; exercise_id?: string }> }) {
  return <Suspense fallback={<main className="almc-shell"><div className="almc-state" role="status">Đang mở trình biên tập Multiple Choice…</div></main>}>
    <McqRoute searchParams={searchParams} />
  </Suspense>;
}
