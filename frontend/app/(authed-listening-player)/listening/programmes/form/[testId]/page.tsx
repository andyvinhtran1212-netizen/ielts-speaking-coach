import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ProgrammeFormRunner } from './programme-form-runner';

export const metadata: Metadata = { title: 'Luyện nghe — Aver Learning', robots: { index: false, follow: false } };

async function ProgrammeFormRoute({ params }: { params: Promise<{ testId: string }> }) {
  const { testId } = await params;
  return <ProgrammeFormRunner testId={testId} />;
}

export default function ProgrammeFormPage({ params }: { params: Promise<{ testId: string }> }) {
  return (
    <Suspense fallback={<main className="programme-runner programme-state shell" role="status">Đang mở bài luyện…</main>}>
      <ProgrammeFormRoute params={params} />
    </Suspense>
  );
}
