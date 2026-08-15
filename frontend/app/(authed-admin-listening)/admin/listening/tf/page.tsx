import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import HydratedSignal from '@/components/hydrated-signal';
import LegacyModule from '@/components/legacy-module';
import { watchdogScript } from '@/lib/watchdog-script';

import { AdminListeningTrueFalse } from './admin-listening-true-false';

export const metadata: Metadata = {
  title: 'Biên tập True / False / Not Given · Admin Listening',
  robots: { index: false, follow: false },
};

async function TrueFalseRoute({ searchParams }: { searchParams: Promise<{ content_id?: string; exercise_id?: string }> }) {
  const query = await searchParams;
  const contentId = String(query.content_id || '').trim();
  if (!contentId) redirect('/admin/listening');
  return <>
    <HydratedSignal />
    <LegacyModule src="/js/components/audio-player.js" />
    {/* Preserve exact content identity when the native watchdog rolls back. */}
    <script dangerouslySetInnerHTML={{ __html: watchdogScript('/pages/admin/listening/tf.html') }} />
    <aver-admin-chrome active="listening" subsection="tf"><AdminAccessGate><AdminListeningTrueFalse contentId={contentId} requestedExerciseId={String(query.exercise_id || '').trim() || null} /></AdminAccessGate></aver-admin-chrome>
  </>;
}

export default function AdminListeningTrueFalsePage({ searchParams }: { searchParams: Promise<{ content_id?: string; exercise_id?: string }> }) {
  return <Suspense fallback={<main className="altf-shell"><div className="altf-state" role="status">Đang mở trình biên tập True / False / Not Given…</div></main>}><TrueFalseRoute searchParams={searchParams} /></Suspense>;
}
