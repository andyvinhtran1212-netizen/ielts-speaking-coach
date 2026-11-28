'use client';

// Lộ trình `/course` (LEARNERCORE-0063 T15). Flag on (`learnerV2Enabled(me)`):
// the new page. Flag off: the URL is replaced by the section's stand-in page
// (NAV_PLAN `today` of Lộ trình, `/course/assigned`) and no Lộ trình request is made.
import { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { PageState } from '@/components/ui/page-state';
import { useLearnerMe } from '@/components/learner/learner-frame';
import { learnerV2Enabled } from '@/lib/auth-wire-model.mjs';
import { useAuth } from '@/lib/auth/auth-provider';
import { documentNavigation, replaceAcrossTrees } from '@/lib/tree-replace';

import { CourseHubPage } from './course-hub';

/** Where flag-off learners land: the stand-in of the Lộ trình nav item. */
const COURSE_STAND_IN = '/course/assigned';

function CourseGate() {
  const router = useRouter();
  const { status: authStatus } = useAuth();
  const { status, me } = useLearnerMe();
  const accountId = status === 'ready' ? me.id || null : null;
  const enabled = authStatus === 'signed-in' && status === 'ready' && learnerV2Enabled(me);
  const leave = status === 'error' || (status === 'ready' && !enabled);
  useEffect(() => {
    if (authStatus === 'signed-out') {
      documentNavigation.replace('/login');
      return;
    }
    // An unreadable profile is treated as flag off: the stand-in page works
    // for everyone, the new page only for opted-in learners. `/course/assigned` is
    // in the legacy tree, so this is a full document replacement (FR-015).
    if (authStatus === 'signed-in' && leave) replaceAcrossTrees(router, COURSE_STAND_IN);
  }, [authStatus, leave, router]);
  if (!enabled || !accountId) return <PageState kind="loading" title="Đang tải Lộ trình" />;
  return <CourseHubPage key={accountId} accountId={accountId} />;
}

export default function CoursePage() {
  return (
    <Suspense fallback={<PageState kind="loading" title="Đang tải Lộ trình" />}>
      <CourseGate />
    </Suspense>
  );
}
