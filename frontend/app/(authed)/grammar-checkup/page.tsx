import type { Metadata } from 'next';
import { Suspense } from 'react';

import { GrammarCheckup } from './grammar-checkup';

export const metadata: Metadata = {
  title: 'MASTER30 Grammar Check-up — AverLearning',
  robots: { index: false, follow: false },
};

export default function GrammarCheckupPage() {
  return (
    <>
      <link rel="stylesheet" href="/css/grammar-checkup.css" />
      <aver-chrome active="grammar"></aver-chrome>
      <Suspense fallback={<main className="gd-shell"><div className="gd-empty">Đang mở Grammar Check-up…</div></main>}>
        <GrammarCheckup />
      </Suspense>
    </>
  );
}
