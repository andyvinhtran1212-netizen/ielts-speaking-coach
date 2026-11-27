import type { Metadata } from 'next';

import { ReviewV2Shell } from '@/components/review-v2/review-v2-shell';

import { ListeningReviewWorkspace } from './listening-review-workspace';

export const metadata: Metadata = {
  title: 'Chữa bài Listening — Aver Learning',
  robots: { index: false, follow: false },
};

export default function ListeningReviewPage() {
  // LEARNERCORE-0063 FR-104: the account's flag picks the tree; off → the workspace as today.
  return <ReviewV2Shell><ListeningReviewWorkspace /></ReviewV2Shell>;
}
