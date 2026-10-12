import type { Metadata } from 'next';

import { ReadingExamSession } from './reading-exam-session';

export const metadata: Metadata = {
  title: 'Reading Test — Aver Learning',
  robots: { index: false, follow: false },
};

export default function ReadingExamSessionPage() {
  return <div lang="en" style={{ display: 'contents' }}><ReadingExamSession /></div>;
}
