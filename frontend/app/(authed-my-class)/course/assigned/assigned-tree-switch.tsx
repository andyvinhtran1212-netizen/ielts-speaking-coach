'use client';

// Chooses the /course/assigned tree (LEARNERCORE-0063 FR-095). Flag off, the
// default for everyone, renders the legacy `MyClassWorkspace` passed in,
// unchanged: same DOM, same CSS, same requests. Flag on (`learnerV2Enabled(me)`)
// swaps in the new page, loaded lazily so its CSS and its request never reach
// the old tree. Same rule as the /home switch (`home-tree-switch.tsx`).
//
// The flag comes from the shared `/auth/me` profile that `aver-chrome` loads on
// this page; until it arrives the legacy tree shows, so a missing or slow
// profile never blanks the page.
import dynamic from 'next/dynamic';
import { useSyncExternalStore, type ReactNode } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { getAuthMeProfile, subscribeAuthMeProfile } from '@/lib/auth/auth-me-single-flight.mjs';
import { learnerV2Enabled } from '@/lib/auth-wire-model.mjs';

const AssignedV2 = dynamic(() => import('./assigned-v2'), { ssr: false });

export function AssignedTreeSwitch({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const accountId = status === 'signed-in' ? user?.id || null : null;
  const enabled = useSyncExternalStore(
    subscribeAuthMeProfile,
    () => Boolean(accountId) && learnerV2Enabled(getAuthMeProfile(accountId)),
    () => false,
  );
  // Keyed by account: a switch between two opted-in accounts mounts a fresh
  // tree, so nothing loaded for the previous account survives.
  if (enabled && accountId) return <AssignedV2 key={accountId} accountId={accountId} />;
  return <>{children}</>;
}
