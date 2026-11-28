// /progress — Tiến độ (LEARNERCORE-0063 FR-061, FR-087; sheet TienDo).
import type { Metadata } from 'next';

import { ProgressPage } from './progress-page';

export const metadata: Metadata = {
  title: 'Tiến độ — Aver Learning',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <ProgressPage />;
}
