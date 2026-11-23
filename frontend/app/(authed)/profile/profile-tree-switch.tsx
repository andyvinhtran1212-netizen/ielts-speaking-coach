'use client';

// Chooses the /profile tree (LEARNERCORE-0063 FR-090), same pattern as the
// /home switch (G07-T14). Flag off — the default — renders the legacy tree
// passed in, unchanged: same DOM, same CSS, same requests. Flag on
// (`learnerV2Enabled(me)`) swaps in the new Hồ sơ, loaded lazily so its CSS and
// its requests never reach the old tree.
//
// The flag comes from the shared `/auth/me` profile that `aver-chrome` loads
// on this page; until it arrives the legacy tree shows, so a missing or slow
// profile never blanks the page.
import dynamic from 'next/dynamic';
import { useSyncExternalStore, type ReactNode } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { getAuthMeProfile, subscribeAuthMeProfile } from '@/lib/auth/auth-me-single-flight.mjs';
import { learnerV2Enabled } from '@/lib/auth-wire-model.mjs';

const ProfileV2 = dynamic(() => import('./profile-v2'), { ssr: false });

export function ProfileTreeSwitch({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const accountId = status === 'signed-in' ? user?.id || null : null;
  const enabled = useSyncExternalStore(
    subscribeAuthMeProfile,
    () => Boolean(accountId) && learnerV2Enabled(getAuthMeProfile(accountId)),
    () => false,
  );
  // Keyed by account: an account switch mounts a fresh tree.
  if (enabled && accountId) return <ProfileV2 key={accountId} accountId={accountId} />;
  return <>{children}</>;
}
