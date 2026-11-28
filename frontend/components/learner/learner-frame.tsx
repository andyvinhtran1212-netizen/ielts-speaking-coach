'use client';

// LearnerShell with the signed-in learner's real data (LEARNERCORE-0063
// FR-090), for the v2 learner pages: /help, /account, /progress (G07-T17) and
// /course (G07-T15). The layout is `AuthedShell design="v2"`, so AuthProvider
// and the session gate are already there; this frame only reads `/auth/me` once
// and hands the profile to the page through `useLearnerMe()`.
//
// - Name, initials and the admin switch come from `/auth/me`, never inferred on
//   the client (UIBASE-0056 FR-003). Profile unreadable: the frame stays, with
//   the email and no admin switch (fail closed), and the failure is reported.
// - The nav section comes from the pathname through the route registry inside
//   LearnerShell (UIBASE-0056 FR-007); pages do not pass it.
// - A profile read for another account (switch in another tab) is never shown.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { LearnerShell } from '@/components/ui/shell/learner-shell';
import type { LearnerUser } from '@/components/ui/shell/account-menu';
import { learnerInitials } from '@/app/(public-library)/library-frame';
import { getCurrentUser, type AuthMeWire } from '@/lib/auth-api';
import { useAuth } from '@/lib/auth/auth-provider';

export type LearnerMe =
  | { status: 'loading'; me: null }
  | { status: 'ready'; me: AuthMeWire }
  | { status: 'error'; me: null };

const LearnerMeContext = createContext<LearnerMe>({ status: 'loading', me: null });

/** The `/auth/me` profile read by the frame, for the page inside it. */
export function useLearnerMe(): LearnerMe {
  return useContext(LearnerMeContext);
}

type Read = { accountId: string; result: LearnerMe };

export function LearnerFrame({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const accountId = status === 'signed-in' ? user?.id ?? null : null;
  const [read, setRead] = useState<Read | null>(null);

  useEffect(() => {
    if (!accountId) return undefined;
    const abort = new AbortController();
    getCurrentUser(abort.signal).then(
      (me) => {
        if (!abort.signal.aborted) setRead({ accountId, result: { status: 'ready', me } });
      },
      (error) => {
        if (abort.signal.aborted) return;
        (window as any).aver?.reportError?.('learner frame: /auth/me failed', {
          type: 'learner_frame_profile_failed',
          detail: error instanceof Error ? error.message : String(error ?? ''),
        });
        setRead({ accountId, result: { status: 'error', me: null } });
      },
    );
    return () => abort.abort();
  }, [accountId]);

  const own: LearnerMe = accountId && read?.accountId === accountId ? read.result : { status: 'loading', me: null };
  const email = user?.email ?? '';
  const displayName = own.me?.display_name?.trim() || null;
  const learner: LearnerUser = {
    name: displayName || email,
    email,
    initials: learnerInitials(displayName, email),
  };
  return (
    <LearnerMeContext.Provider value={own}>
      <LearnerShell user={learner} canSwitchToAdmin={own.me?.role === 'admin'}>
        {children}
      </LearnerShell>
    </LearnerMeContext.Provider>
  );
}
