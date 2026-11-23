'use client';

// Chooses the /course/assigned tree (LEARNERCORE-0063 FR-095). Flag off, the
// default for everyone, renders the legacy `MyClassWorkspace` passed in,
// unchanged: same DOM, same CSS, same requests. Flag on (`learnerV2Enabled(me)`)
// swaps in the new page, loaded lazily so its CSS and its request never reach
// the old tree. Same rule as the /home switch (`home-tree-switch.tsx`).
//
// The flag comes from the shared `/auth/me` profile that `aver-chrome` loads on
// this page. While a signed-in profile is still on its way, neither tree
// mounts, so an opted-in learner never sees (or fetches for) the old tree
// first. The wait is capped at `PROFILE_WAIT_MS`: after that, or if the profile
// never comes, the legacy tree shows, so a missing or slow profile never
// blanks the page.
import dynamic from 'next/dynamic';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { getAuthMeProfile, subscribeAuthMeProfile } from '@/lib/auth/auth-me-single-flight.mjs';
import { learnerV2Enabled } from '@/lib/auth-wire-model.mjs';

const AssignedV2 = dynamic(() => import('./assigned-v2'), { ssr: false });

export const PROFILE_WAIT_MS = 1200;

type Tree = 'v2' | 'legacy' | 'pending';

export function AssignedTreeSwitch({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const accountId = status === 'signed-in' ? user?.id || null : null;
  const tree = useSyncExternalStore<Tree>(
    subscribeAuthMeProfile,
    () => {
      if (!accountId) return 'legacy';
      const me = getAuthMeProfile(accountId);
      if (!me) return 'pending';
      return learnerV2Enabled(me) ? 'v2' : 'legacy';
    },
    () => 'legacy',
  );
  const [waitedFor, setWaitedFor] = useState<string | null>(null);
  useEffect(() => {
    if (tree !== 'pending' || !accountId) return undefined;
    const timer = setTimeout(() => setWaitedFor(accountId), PROFILE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [tree, accountId]);

  // Keyed by account: a switch between two opted-in accounts mounts a fresh
  // tree, so nothing loaded for the previous account survives.
  if (tree === 'v2' && accountId) return <AssignedV2 key={accountId} accountId={accountId} />;
  if (tree === 'pending' && waitedFor !== accountId) return <div aria-busy="true" style={{ minHeight: '60vh' }} />;
  return <>{children}</>;
}
