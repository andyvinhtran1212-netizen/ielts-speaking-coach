'use client';

// Page frame of the public course pages (PUBLICSITE-0059 plan 5.1): PublicShell
// for guests, LearnerShell for a signed-in learner. Same rules as the Library
// frame (`app/(public-library)/library-frame.tsx`): the server always renders
// PublicShell; after hydration AuthProvider (no activation gate) reads the
// browser session, and the name and admin switch come from `/auth/me`.
import { useEffect, useState, type ReactNode } from 'react';

import { PublicShell } from '@/components/ui/shell/public-shell';
import { LearnerShell } from '@/components/ui/shell/learner-shell';
import type { LearnerUser } from '@/components/ui/shell/account-menu';
import { getCurrentUser } from '@/lib/auth-api';
import { AuthProvider, useAuth } from '@/lib/auth/auth-provider';

type Profile = { accountId: string; displayName: string | null; isAdmin: boolean; expired?: boolean };

function initials(name: string | null, email: string): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0]?.[0] ?? email[0] ?? '?';
  return letters.toLocaleUpperCase('vi');
}

function Frame({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const accountId = status === 'signed-in' ? user?.id ?? null : null;

  useEffect(() => {
    if (!accountId) return undefined;
    const abort = new AbortController();
    getCurrentUser(abort.signal, { noRedirect: true }).then(
      (me) => setProfile({ accountId, displayName: me.display_name, isAdmin: me.role === 'admin' }),
      (error) => {
        if (abort.signal.aborted) return;
        // 401: the session is no longer valid, so this visitor is a guest here.
        if ((error as { status?: number } | null)?.status === 401) {
          setProfile({ accountId, displayName: null, isAdmin: false, expired: true });
          return;
        }
        (window as any).aver?.reportError?.('courses frame: /auth/me failed', {
          type: 'courses_frame_profile_failed',
          detail: error instanceof Error ? error.message : String(error ?? ''),
        });
        setProfile({ accountId, displayName: null, isAdmin: false });
      },
    );
    return () => abort.abort();
  }, [accountId]);

  const own = accountId && profile?.accountId === accountId ? profile : null;
  if (!accountId || !user || own?.expired) return <PublicShell active="courses">{children}</PublicShell>;

  const email = user.email ?? '';
  const learner: LearnerUser = { name: own?.displayName?.trim() || email, email, initials: initials(own?.displayName ?? null, email) };
  return <LearnerShell user={learner} canSwitchToAdmin={own?.isAdmin ?? false}>{children}</LearnerShell>;
}

export function CommerceFrame({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <Frame>{children}</Frame>
    </AuthProvider>
  );
}
