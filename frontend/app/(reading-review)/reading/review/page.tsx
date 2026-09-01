import type { Metadata } from 'next';

import { ReadingReviewWorkspace } from './reading-review-workspace';

export const metadata: Metadata = {
  title: 'Chữa bài Reading — Aver Learning',
  robots: { index: false, follow: false },
};

export default function ReadingReviewPage() {
  return <ReadingReviewWorkspace />;
}
