'use client';

// /reading?hub=1 (LEARNERCORE-0063 FR-111). Plain `/reading` is still the
// server redirect to /reading/vocab; only the hub's skill tabs link here. Flag
// on → the Reading hub; flag off → `router.replace('/reading/vocab')`, query
// kept without `hub`. If the profile never arrives the page falls back to the
// same redirect, so nobody is left on a spinner.
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { PageState } from '@/components/ui/page-state';
import { readingFallbackHref } from '@/lib/skill-hub-model.mjs';

import { useLearnerV2 } from './use-learner-v2';

const SkillHub = dynamic(() => import('./skill-hub').then((m) => m.SkillHub), { ssr: false });

export const READING_FLAG_WAIT_MS = 4000;

export function ReadingHubEntry() {
  const router = useRouter();
  const { state, accountId } = useLearnerV2();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (state !== 'pending') return undefined;
    const timer = window.setTimeout(() => setTimedOut(true), READING_FLAG_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  const fallback = state === 'off' || (state === 'pending' && timedOut);
  useEffect(() => {
    if (fallback) router.replace(readingFallbackHref(window.location.search));
  }, [fallback, router]);

  if (state === 'on' && accountId) return <SkillHub skill="reading" accountId={accountId} />;
  return <PageState kind="loading" title="Đang mở Reading" />;
}
