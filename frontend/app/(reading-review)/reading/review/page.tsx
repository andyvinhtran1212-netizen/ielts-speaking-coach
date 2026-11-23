import type { Metadata } from 'next';

import { ReviewV2Shell } from '@/components/review-v2/review-v2-shell';

import { ReadingReviewWorkspace } from './reading-review-workspace';

export const metadata: Metadata = {
  title: 'Chữa bài Reading — Aver Learning',
  robots: { index: false, follow: false },
};

export default function ReadingReviewPage() {
  // LEARNERCORE-0063 FR-104: the account's flag picks the tree; off → the workspace as today.
  return <ReviewV2Shell><ReadingReviewWorkspace /></ReviewV2Shell>;
}
