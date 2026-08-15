import type { Metadata } from 'next';

import { OnboardingBehavior } from './onboarding-behavior';

export const metadata: Metadata = {
  title: 'Thiết lập tài khoản — Aver Learning',
  robots: { index: false, follow: false },
};

export default function OnboardingPage() {
  return (
    <>
      {/* @ts-ignore — custom element do aver-chrome.js đăng ký. */}
      <aver-chrome active="home" />
      <OnboardingBehavior />
    </>
  );
}
