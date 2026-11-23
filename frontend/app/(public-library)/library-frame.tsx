'use client';

// Page frame of the public Library (LIBRARY-0061 FR-002, UIBASE-0056 FR-007):
// PublicShell for guests, LearnerShell for a signed-in learner.
//
// The server always renders PublicShell, so `/library` stays a static, public
// page with no cookie read (FR-001). After hydration AuthProvider reads the
// browser session; a signed-in account switches to LearnerShell, and its name
// and the admin switch come from `/auth/me` (never inferred on the client).
// No activation gate: reading the Library never needs an activated account.
import { useEffect, useState, type ReactNode } from 'react';

import { PublicShell } from '@/components/ui/shell/public-shell';
import { LearnerShell } from '@/components/ui/shell/learner-shell';
import type { LearnerUser } from '@/components/ui/shell/account-menu';
import { getCurrentUser } from '@/lib/auth-api';
import { AuthProvider, useAuth } from '@/lib/auth/auth-provider';

type Profile = { accountId: string; displayName: string | null; isAdmin: boolean; expired?: boolean };

/** Two initials from the name ("Vũ Thu Trang" → "VT"), else the email's first letter. */
export function learnerInitials(name: string | null, email: string): string {
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
    // noRedirect: a 401 (expired session) must not move a reader off the
    // public Library to /login (FR-001); it lands in the failure branch.
    getCurrentUser(abort.signal, { noRedirect: true }).then(
      (me) => setProfile({ accountId, displayName: me.display_name, isAdmin: me.role === 'admin' }),
      // Profile unreadable: keep the learner frame with the email and no admin
      // switch (fail closed), and leave a trace instead of failing silently.
      (error) => {
        if (abort.signal.aborted) return;
        // 401: the server no longer accepts this session, so the reader is a
        // guest here. Expected after a long absence; not an error to report.
        if ((error as { status?: number } | null)?.status === 401) {
          setProfile({ accountId, displayName: null, isAdmin: false, expired: true });
          return;
        }
        (window as any).aver?.reportError?.('library frame: /auth/me failed', {
          type: 'library_frame_profile_failed',
          detail: error instanceof Error ? error.message : String(error ?? ''),
        });
        setProfile({ accountId, displayName: null, isAdmin: false });
      },
    );
    return () => abort.abort();
  }, [accountId]);

  // A profile read for another account (switch in another tab) is never shown.
  const own = accountId && profile?.accountId === accountId ? profile : null;
  if (!accountId || !user || own?.expired) return <PublicShell active="library">{children}</PublicShell>;

  const email = user.email ?? '';
  const name = own?.displayName?.trim() || email;
  const learner: LearnerUser = { name, email, initials: learnerInitials(own?.displayName ?? null, email) };
  return (
    <LearnerShell user={learner} canSwitchToAdmin={own?.isAdmin ?? false}>
      {children}
    </LearnerShell>
  );
}

export function LibraryFrame({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <Frame>{children}</Frame>
    </AuthProvider>
  );
}
