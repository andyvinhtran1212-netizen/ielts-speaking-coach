import type { ReactNode } from 'react';
import { Suspense } from 'react';

import { RouteScriptChain } from '@/components/route-script-chain';

export default function ListeningStandaloneExercisesLayout({ children }: { children: ReactNode }) {
  return <>
    <link rel="stylesheet" href="/css/listening-standalone-next.css" />
    <link rel="stylesheet" href="/css/feedback.css" />
    <RouteScriptChain scripts={[
      { src: '/js/components/audio-player.js', type: 'module' },
      { src: '/js/feedback-widgets.js' },
    ]} />
    <Suspense fallback={<main className="shell"><section className="lse-state" role="status">Đang mở bài luyện…</section></main>}>
      {children}
    </Suspense>
  </>;
}
