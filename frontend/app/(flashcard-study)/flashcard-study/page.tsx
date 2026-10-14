import type { Metadata } from 'next';
import { Suspense } from 'react';

import { FlashcardStudyPlayer } from './flashcard-study-player';
import { flashcardReturnHref } from '@/lib/flashcard-study-model.mjs';

export const metadata: Metadata = {
  title: 'Học flashcard — Aver Learning',
  robots: { index: false, follow: false },
};

async function StudyHeader({ searchParams }: { searchParams: Promise<{ stack?: string | string[] }> }) {
  const query = await searchParams;
  const returnHref = flashcardReturnHref(typeof query.stack === 'string' ? query.stack : '');
  return <header className="fcs-header">
        <div className="fcs-width fcs-header__inner">
          <a href={returnHref} className="fcs-back" aria-label="Quay lại bộ sưu tập">←</a>
          <div>
            <p className="fcs-eyebrow">Vocabulary studio</p>
            <h1>Học flashcard</h1>
          </div>
        </div>
      </header>;
}

export default function FlashcardStudyPage({ searchParams }: { searchParams: Promise<{ stack?: string | string[] }> }) {
  return <><aver-chrome active="vocabulary" /><Suspense fallback={<p role="status">Đang tải bộ sưu tập…</p>}><StudyHeader searchParams={searchParams} /></Suspense><FlashcardStudyPlayer /></>;
}
