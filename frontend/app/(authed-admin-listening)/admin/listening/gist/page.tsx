import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import HydratedSignal from '@/components/hydrated-signal';
import LegacyModule from '@/components/legacy-module';
import { watchdogScript } from '@/lib/watchdog-script';

import { AdminListeningGist } from './admin-listening-gist';

export const metadata: Metadata = {
  title: 'Biên tập Gist · Admin Listening',
  robots: { index: false, follow: false },
};

async function GistRoute({ searchParams }: { searchParams: Promise<{ content_id?: string; exercise_id?: string }> }) {
  const query = await searchParams;
  const contentId = String(query.content_id || '').trim();
  if (!contentId) redirect('/admin/listening');
  return <>
    <HydratedSignal />
    <LegacyModule src="/js/components/audio-player.js" />
    {/* watchdogScript appends the current search/hash, preserving exact content identity. */}
    <script dangerouslySetInnerHTML={{ __html: watchdogScript('/pages/admin/listening/gist.html') }} />
    <aver-admin-chrome active="listening" subsection="gist"><AdminAccessGate><AdminListeningGist contentId={contentId} requestedExerciseId={String(query.exercise_id || '').trim() || null} /></AdminAccessGate></aver-admin-chrome>
  </>;
}

export default function AdminListeningGistPage({ searchParams }: { searchParams: Promise<{ content_id?: string; exercise_id?: string }> }) {
  return <Suspense fallback={<main className="alge-shell"><div className="alge-state" role="status">Đang mở trình biên tập Gist…</div></main>}><GistRoute searchParams={searchParams} /></Suspense>;
}
