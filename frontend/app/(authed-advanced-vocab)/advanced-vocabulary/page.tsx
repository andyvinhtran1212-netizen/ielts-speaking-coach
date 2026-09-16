import type { Metadata } from 'next';

import { AdvancedVocabularyLesson } from './advanced-vocabulary-lesson';

export const metadata: Metadata = {
  title: 'Advanced Vocabulary — Aver Learning',
  robots: { index: false, follow: false },
};

export default function AdvancedVocabularyPage() {
  return (
    <>
      {/* @ts-ignore — custom element supplied by the shared student chrome. */}
      <aver-chrome active="my-class" />
      <AdvancedVocabularyLesson />
    </>
  );
}
