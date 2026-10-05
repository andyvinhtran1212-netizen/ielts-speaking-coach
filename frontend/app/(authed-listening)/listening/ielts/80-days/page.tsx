import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ListeningSourceCollection } from './source-collection';

export const metadata: Metadata = { title: '80 ngày Listening — Aver Learning', robots: { index: false, follow: false } };

export default function SourceCollectionPage() {
  return <><link rel="stylesheet" href="/css/listening-source-collection.css" /><aver-chrome active="listening" /><Suspense fallback={<main className="source-shell" role="status">Đang mở bộ luyện…</main>}><ListeningSourceCollection /></Suspense></>;
}
