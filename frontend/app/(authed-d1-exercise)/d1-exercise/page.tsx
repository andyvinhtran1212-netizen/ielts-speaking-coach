import type { Metadata } from 'next';

import { D1ExercisePlayer } from './d1-exercise-player';

export const metadata: Metadata = {
  title: 'Điền từ — Aver Learning',
  robots: { index: false, follow: false },
};

export default function D1ExercisePage() {
  return (
    <>
      {/* @ts-ignore — custom element supplied by the shared student chrome. */}
      <aver-chrome active="vocabulary" />
      <header className="d1x-header">
        <div className="d1x-width">
          <a href="/exercises" className="d1x-back">← Bài luyện</a>
          <span aria-hidden="true">/</span>
          <h1>Điền từ</h1>
        </div>
      </header>
      <D1ExercisePlayer />
    </>
  );
}
