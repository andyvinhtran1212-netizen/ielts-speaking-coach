import type { Metadata } from 'next';

import { FlashcardStudyPlayer } from './flashcard-study-player';

export const metadata: Metadata = {
  title: 'Học flashcard — Aver Learning',
  robots: { index: false, follow: false },
};

export default function FlashcardStudyPage() {
  return (
    <>
      {/* @ts-ignore — custom element supplied by the shared student chrome. */}
      <aver-chrome active="vocabulary" />
      <header className="fcs-header">
        <div className="fcs-width fcs-header__inner">
          <a href="/flashcards" className="fcs-back" aria-label="Quay lại Flashcards">←</a>
          <div>
            <p className="fcs-eyebrow">Vocabulary studio</p>
            <h1>Học flashcard</h1>
          </div>
        </div>
      </header>
      <FlashcardStudyPlayer />
    </>
  );
}
