import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';

import { AdminListeningContentEditor } from './admin-listening-content-editor';

export const metadata: Metadata = {
  title: 'Sửa metadata Listening · Admin',
  description: 'Biên tập metadata Listening với version guard và canonical readback.',
  robots: { index: false, follow: false },
};

async function EditorRoute({ params }: { params: Promise<{ contentId: string }> }) {
  const { contentId } = await params;
  return <aver-admin-chrome active="listening" subsection="content"><AdminAccessGate><AdminListeningContentEditor contentId={contentId} /></AdminAccessGate></aver-admin-chrome>;
}

export default function AdminListeningContentEditorPage({ params }: { params: Promise<{ contentId: string }> }) {
  return <Suspense fallback={<main className="alme-shell"><div className="alme-state" role="status">Đang mở metadata editor…</div></main>}><EditorRoute params={params} /></Suspense>;
}
