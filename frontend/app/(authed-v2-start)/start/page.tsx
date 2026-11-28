// /start — "Lần đầu vào" (LEARNERCORE-0063 FR-065; sheet TroGiupLanDau
// screen 2). Reached after the first sign-in when `learnerV2Enabled(me)`
// (`lib/login-model.mjs`); `/onboarding` stays for everyone else.
import type { Metadata } from 'next';

import { StartFlow } from './start-flow';

export const metadata: Metadata = {
  title: 'Bắt đầu — Aver Learning',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <StartFlow />;
}
