import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ListeningDictationSession } from './listening-dictation-session';

export const metadata: Metadata = {
  title: 'Chép chính tả — Aver Learning',
  robots: { index: false, follow: false },
};

export default function ListeningDictationPage() {
  return <Suspense fallback={<main className="dict-next-shell"><p className="dict-next-state">Đang mở bài chép chính tả…</p></main>}><ListeningDictationSession /></Suspense>;
}
