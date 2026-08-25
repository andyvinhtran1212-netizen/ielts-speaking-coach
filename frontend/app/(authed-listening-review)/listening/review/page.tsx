import type { Metadata } from 'next';

import { ListeningReviewWorkspace } from './listening-review-workspace';

export const metadata: Metadata = {
  title: 'Chữa bài Listening — Aver Learning',
  robots: { index: false, follow: false },
};

export default function ListeningReviewPage() {
  return <ListeningReviewWorkspace />;
}
