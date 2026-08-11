import type { Metadata } from 'next';

import { VocabularyHubBehavior } from './vocabulary-hub-behavior';

export const metadata: Metadata = {
  title: 'Từ vựng — Aver Learning',
  robots: { index: false, follow: false },
};

export default function VocabularyHubPage() {
  return (
    <>
      {/* @ts-ignore — custom element do aver-chrome.js đăng ký. */}
      <aver-chrome active="vocabulary" />
      <VocabularyHubBehavior />
    </>
  );
}
