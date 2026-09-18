import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ReviewRoute } from './review-route';

export const metadata: Metadata = { title: 'Tuyến ôn Grammar — AverLearning', robots: { index: false, follow: false } };

export default function GrammarReviewPage() {
  return <><link rel="stylesheet" href="/css/grammar-checkup.css" /><aver-chrome active="grammar"></aver-chrome><Suspense fallback={<main className="gd-shell"><div className="gd-empty">Đang mở tuyến ôn…</div></main>}><ReviewRoute /></Suspense></>;
}
