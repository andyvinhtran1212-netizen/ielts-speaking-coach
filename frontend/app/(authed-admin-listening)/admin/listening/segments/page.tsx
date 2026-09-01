import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import HydratedSignal from '@/components/hydrated-signal';
import LegacyModule from '@/components/legacy-module';
import { watchdogScript } from '@/lib/watchdog-script';

import { AdminListeningSegments } from './admin-listening-segments';

export const metadata: Metadata = {
  title: 'Phân câu Dictation · Admin Listening',
  robots: { index: false, follow: false },
};

async function SegmentsRoute({ searchParams }: { searchParams: Promise<{ content_id?: string; exercise_id?: string }> }) {
  const query = await searchParams;
  const contentId = String(query.content_id || '').trim();
  if (!contentId) redirect('/admin/listening');
  return <>
    <HydratedSignal />
    <LegacyModule src="/js/components/audio-player.js" />
    {/* watchdogScript intentionally appends the current search/hash, preserving content_id. */}
    <script dangerouslySetInnerHTML={{ __html: watchdogScript('/pages/admin/listening/segments.html') }} />
    <aver-admin-chrome active="listening" subsection="segments"><AdminAccessGate><AdminListeningSegments contentId={contentId} requestedExerciseId={String(query.exercise_id || '').trim() || null} /></AdminAccessGate></aver-admin-chrome>
  </>;
}

export default function AdminListeningSegmentsPage({ searchParams }: { searchParams: Promise<{ content_id?: string; exercise_id?: string }> }) {
  return <Suspense fallback={<main className="alse-shell"><div className="alse-state" role="status">Đang mở trình phân câu…</div></main>}><SegmentsRoute searchParams={searchParams} /></Suspense>;
}
