'use client';

// learner_v2 for the signed-in account (LEARNERCORE-0063 FR-073), read from the
// shared `/auth/me` profile that `aver-chrome` loads. `pending` until that
// profile is known, so a caller can keep the old tree (or wait) instead of
// guessing. Mirrors `home-tree-switch.tsx` (T14).
import { useSyncExternalStore } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { getAuthMeProfile, subscribeAuthMeProfile } from '@/lib/auth/auth-me-single-flight.mjs';
import { learnerV2Enabled } from '@/lib/auth-wire-model.mjs';

export type LearnerV2State = 'pending' | 'on' | 'off';

export function useLearnerV2(): { state: LearnerV2State; accountId: string | null } {
  const { status, user } = useAuth();
  const accountId = status === 'signed-in' ? user?.id || null : null;
  const state = useSyncExternalStore<LearnerV2State>(
    subscribeAuthMeProfile,
    () => {
      if (!accountId) return status === 'initial-loading' ? 'pending' : 'off';
      const profile = getAuthMeProfile(accountId);
      if (!profile) return 'pending';
      return learnerV2Enabled(profile) ? 'on' : 'off';
    },
    () => 'pending',
  );
  return { state, accountId };
}

/** `window.location.search` without useSearchParams (no Suspense boundary needed). */
export function useLocationSearch(): string {
  return useSyncExternalStore(
    (listener) => {
      window.addEventListener('popstate', listener);
      return () => window.removeEventListener('popstate', listener);
    },
    () => window.location.search,
    () => '',
  );
}
