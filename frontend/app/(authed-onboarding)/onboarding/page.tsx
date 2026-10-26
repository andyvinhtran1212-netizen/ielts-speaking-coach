import type { Metadata } from 'next';

import { OnboardingBehavior, OnboardingHeader } from './onboarding-behavior';

export const metadata: Metadata = {
  title: 'Thiết lập tài khoản — Aver Learning',
  robots: { index: false, follow: false },
};

export default function OnboardingPage() {
  return (
    <>
      <OnboardingHeader />
      <OnboardingBehavior />
    </>
  );
}
