// Speaking core dark route. App Router owns the stable URL, but admission stays
// legacy until the behavior is native and Gate E live drills are complete.
import type { Metadata } from 'next';

import { LegacyPracticeShell } from './legacy-practice-shell';
import { PracticeLegacyBoot } from './practice-legacy-boot';

export const metadata: Metadata = {
  title: 'Luyện tập Ghi âm — Aver Learning',
  robots: { index: false, follow: false },
};

export default function PracticeSessionPage() {
  return (
    <>
      {/* @ts-ignore — custom element do aver-chrome.js đăng ký. */}
      <aver-chrome active="speaking" />
      <LegacyPracticeShell />
      <PracticeLegacyBoot />
    </>
  );
}
