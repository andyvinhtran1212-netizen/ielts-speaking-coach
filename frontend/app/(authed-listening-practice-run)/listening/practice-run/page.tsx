import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ListeningPracticeRun } from './practice-run-player';

export const metadata: Metadata = {
  title: 'Luyện nhanh — Aver Learning',
  robots: { index: false, follow: false },
};

export default function ListeningPracticeRunPage() {
  return (
    <>
      <aver-chrome active="listening" />
      <Suspense fallback={<main className="lpr-next-shell"><p className="lpr-next-state">Đang mở bài luyện…</p></main>}>
        <ListeningPracticeRun />
      </Suspense>
    </>
  );
}
