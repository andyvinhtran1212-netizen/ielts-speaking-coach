'use client';

// /course/class gate (LEARNERCORE-0063 FR-119). Flag on (`learnerV2Enabled(me)`
// from the shared `/auth/me` profile `aver-chrome` loads): the session page,
// loaded lazily and keyed by account. Flag off, or no readable profile in
// time: the URL is replaced by `/my-class` (307 → /course/assigned), the page
// every learner can use, and no class request is made.
import dynamic from 'next/dynamic';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';

import { PageState } from '@/components/ui/page-state';
import { useAuth } from '@/lib/auth/auth-provider';
import { getAuthMeProfile, subscribeAuthMeProfile } from '@/lib/auth/auth-me-single-flight.mjs';
import { learnerV2Enabled } from '@/lib/auth-wire-model.mjs';

const ClassSessionsV2 = dynamic(() => import('./class-sessions-v2'), { ssr: false });

export const CLASS_STAND_IN = '/my-class';
/** Longer than the shared `/auth/me` timeout (15 s), so only a dead read trips it. */
export const PROFILE_WAIT_MS = 20_000;

export function ClassGate() {
  const router = useRouter();
  const { status, user } = useAuth();
  const accountId = status === 'signed-in' ? user?.id || null : null;
  const profile = useSyncExternalStore(
    subscribeAuthMeProfile,
    () => (accountId ? getAuthMeProfile(accountId) : null),
    () => null,
  );
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (profile || !accountId) return undefined;
    const timer = window.setTimeout(() => setTimedOut(true), PROFILE_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [profile, accountId]);
  const enabled = Boolean(accountId && profile) && learnerV2Enabled(profile);
  const leave = Boolean(accountId) && ((profile && !enabled) || (!profile && timedOut));
  useEffect(() => {
    if (leave) router.replace(CLASS_STAND_IN);
  }, [leave, router]);
  if (enabled && accountId) return <ClassSessionsV2 key={accountId} accountId={accountId} />;
  return <PageState kind="loading" title="Đang tải buổi học…" />;
}
