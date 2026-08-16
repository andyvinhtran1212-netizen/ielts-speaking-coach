import type { ReactNode } from 'react';
import { Suspense } from 'react';

export default function ListeningStandaloneExercisesLayout({ children }: { children: ReactNode }) {
  return <>
    <link rel="stylesheet" href="/css/listening-standalone-next.css" />
    <link rel="stylesheet" href="/css/feedback.css" />
    <script type="module" src="/js/components/audio-player.js" />
    <script src="/js/feedback-widgets.js" defer />
    <Suspense fallback={<main className="shell"><section className="lse-state" role="status">Đang mở bài luyện…</section></main>}>
      {children}
    </Suspense>
  </>;
}
