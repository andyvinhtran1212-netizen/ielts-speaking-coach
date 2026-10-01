import type { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { ListeningSourceDay } from './source-day';

export const metadata: Metadata = { title: 'Ngày luyện Listening — Aver Learning', robots: { index: false, follow: false } };

async function DayRoute({ params }: { params: Promise<{ day: string }> }) {
  const { day } = await params;
  if (!/^(?:[1-9]|[1-7]\d|80)$/.test(day)) notFound();
  return <ListeningSourceDay day={Number(day)} />;
}

export default function SourceDayPage({ params }: { params: Promise<{ day: string }> }) {
  return <><link rel="stylesheet" href="/css/listening-source-collection.css" /><aver-chrome active="listening" /><Suspense fallback={<main className="source-shell" role="status">Đang mở ngày học…</main>}><DayRoute params={params} /></Suspense></>;
}
