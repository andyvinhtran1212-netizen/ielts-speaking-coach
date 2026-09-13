import type { Metadata } from 'next';
import { Suspense } from 'react';

import {
  FullTestResultBehavior,
  FullTestResultLoading,
} from './full-test-result-behavior';

export const metadata: Metadata = {
  title: 'Kết quả Full Test · Aver Learning',
  robots: { index: false, follow: false },
};

export default function FullTestResultPage() {
  return (
    <Suspense fallback={<FullTestResultLoading />}>
      <FullTestResultBehavior />
    </Suspense>
  );
}
