'use client';

// Luyện tập `/practice` (LEARNERCORE-0063 T16, FR-079). Flag on
// (`learnerV2Enabled(me)`): the new hub. Flag off: the URL is replaced by the
// section's stand-in page (NAV_PLAN `today` of Luyện tập, `/speaking`) and no
// request is made. `/practice/session` is a different route in
// `(authed-practice)` and is not touched.
import { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { PageState } from '@/components/ui/page-state';
import { useLearnerMe } from '@/components/learner/learner-frame';
import { learnerV2Enabled } from '@/lib/auth-wire-model.mjs';
import { replaceAcrossTrees } from '@/lib/tree-replace';

import { PracticeHubPage } from './practice-hub';

/** Where flag-off learners land: the stand-in of the Luyện tập nav item. */
const PRACTICE_STAND_IN = '/speaking';

function PracticeGate() {
  const router = useRouter();
  const { status, me } = useLearnerMe();
  const accountId = status === 'ready' ? me.id || null : null;
  const enabled = status === 'ready' && learnerV2Enabled(me);
  const leave = status === 'error' || (status === 'ready' && !enabled);
  useEffect(() => {
    // An unreadable profile is treated as flag off: the stand-in page works
    // for everyone, the new page only for opted-in learners. `/speaking` is in
    // the legacy tree, so this is a full document replacement (UIBASE-0056 FR-015).
    if (leave) replaceAcrossTrees(router, PRACTICE_STAND_IN);
  }, [leave, router]);
  if (!enabled || !accountId) return <PageState kind="loading" title="Đang tải Luyện tập" />;
  return <PracticeHubPage key={accountId} accountId={accountId} />;
}

export default function PracticePage() {
  return (
    <Suspense fallback={<PageState kind="loading" title="Đang tải Luyện tập" />}>
      <PracticeGate />
    </Suspense>
  );
}
