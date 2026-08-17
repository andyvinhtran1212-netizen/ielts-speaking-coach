import type { Metadata } from 'next';

import { ExamPlayer } from './exam-player';

export const metadata: Metadata = {
  title: 'Luyện đề — Aver Learning',
  robots: { index: false, follow: false },
};

export default function ExamPage() {
  return (
    <>
      {/* @ts-ignore — registered by the shared student chrome script. */}
      <aver-chrome active="home" />
      <ExamPlayer />
    </>
  );
}
