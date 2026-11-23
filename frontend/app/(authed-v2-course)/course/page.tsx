'use client';

// Lộ trình `/course` (LEARNERCORE-0063 T15). Flag on (`learnerV2Enabled(me)`):
// the new page. Flag off: the URL is replaced by the section's stand-in page
// (NAV_PLAN `today` of Lộ trình, `/course/assigned`) and no Lộ trình request is made.
import { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { PageState } from '@/components/ui/page-state';
import { useLearnerMe } from '@/components/learner/learner-frame';
import { learnerV2Enabled } from '@/lib/auth-wire-model.mjs';

import { CourseHubPage } from './course-hub';

/** Where flag-off learners land: the stand-in of the Lộ trình nav item. */
const COURSE_STAND_IN = '/course/assigned';

function CourseGate() {
  const router = useRouter();
  const { status, me } = useLearnerMe();
  const accountId = status === 'ready' ? me.id || null : null;
  const enabled = status === 'ready' && learnerV2Enabled(me);
  const leave = status === 'error' || (status === 'ready' && !enabled);
  useEffect(() => {
    // An unreadable profile is treated as flag off: the stand-in page works
    // for everyone, the new page only for opted-in learners.
    if (leave) router.replace(COURSE_STAND_IN);
  }, [leave, router]);
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
