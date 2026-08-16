// Speaking core dark route. The stable Next URL is rollback-floor ready, while
// admission stays Legacy until Gate E real-device and live coexistence evidence pass.
import type { Metadata } from 'next';

import { PracticeFullTestBridge } from './practice-full-test-bridge';
import { PracticePlayerBridge } from './practice-player-bridge';
import { PracticeRecorderBridge } from './practice-recorder-bridge';
import { PracticeSessionBoot } from './practice-session-boot';
import { PracticeSubmissionBridge } from './practice-submission-bridge';

export const metadata: Metadata = {
  title: 'Luyện tập Ghi âm — Aver Learning',
  robots: { index: false, follow: false },
};

export default function PracticeSessionPage() {
  return (
    <>
      {/* @ts-ignore — custom element do aver-chrome.js đăng ký. */}
      <aver-chrome active="speaking" />
      <PracticePlayerBridge />
      <PracticeRecorderBridge />
      <PracticeSubmissionBridge />
      <PracticeFullTestBridge />
      <PracticeSessionBoot />
    </>
  );
}
