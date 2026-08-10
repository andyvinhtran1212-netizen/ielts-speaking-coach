import { Suspense } from 'react';

import {
  FullTestResultBehavior,
  FullTestResultLoading,
} from './full-test-result-behavior';

export default function FullTestResultPage() {
  return (
    <Suspense fallback={<FullTestResultLoading />}>
      <FullTestResultBehavior />
    </Suspense>
  );
}
