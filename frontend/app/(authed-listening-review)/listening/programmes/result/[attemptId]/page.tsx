import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ProgrammeResult } from './programme-result';

export const metadata: Metadata = { title: 'Tự đối chiếu Listening — Aver Learning', robots: { index: false, follow: false } };

async function ProgrammeResultRoute({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  return <ProgrammeResult attemptId={attemptId} />;
}

export default function ProgrammeResultPage({ params }: { params: Promise<{ attemptId: string }> }) {
  return (
    <Suspense fallback={<main className="programme-result programme-result-state" role="status">Đang mở phần tự đối chiếu…</main>}>
      <ProgrammeResultRoute params={params} />
    </Suspense>
  );
}
