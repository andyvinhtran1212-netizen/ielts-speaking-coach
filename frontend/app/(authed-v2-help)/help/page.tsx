// /help — Trợ giúp (LEARNERCORE-0063 FR-062; sheet TroGiupLanDau screen 1).
import type { Metadata } from 'next';

import { HelpPage } from './help-page';

export const metadata: Metadata = {
  title: 'Trợ giúp — Aver Learning',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <HelpPage />;
}
