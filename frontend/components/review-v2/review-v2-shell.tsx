'use client';

// LEARNERCORE-0063 amendment 4 (FR-104): the review pages' new tree.
//
// /listening/review and /reading/review keep their one workspace (the same
// review data and question cards, no second grading call). This frame picks
// the tree from the server's flag on `/auth/me`:
//   - learner_v2_enabled → LearnerShell around the workspace, and the
//     workspace adds "Chỉ câu sai" and the per-question note (useReviewV2()).
//   - flag off, a guest, an anonymous Reading share link, or `/auth/me`
//     unreadable → the workspace exactly as today (fail closed to the old UI).
// The flag is read once per account; another account's answer is never used.
import dynamic from 'next/dynamic';
import { useEffect, useState, type ReactNode } from 'react';

import type { LearnerUser } from '@/components/ui/shell/account-menu';
import { getCurrentUser, type AuthMeWire } from '@/lib/auth-api';
import { learnerV2Enabled } from '@/lib/auth-wire-model.mjs';
import { useAuth } from '@/lib/auth/auth-provider';

import { REVIEW_V2_OFF, ReviewV2Context } from './review-v2-context';

export { useReviewV2 } from './review-v2-context';

// Lazy, so the av2 CSS and LearnerShell reach only flagged accounts.
const ReviewV2Frame = dynamic(() => import('./review-v2-frame'), {
  ssr: false,
  loading: () => <main className="exam-state-shell"><p className="exam-state-msg" role="status">Đang tải chữa bài…</p></main>,
});

/** Two initials from the name ("Vũ Thu Trang" → "VT"), else the email's first letter. */
function initials(name: string | null, email: string): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0]?.[0] ?? email[0] ?? '?';
  return letters.toLocaleUpperCase('vi');
}

export function ReviewV2Shell({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const accountId = status === 'signed-in' ? user?.id ?? null : null;
  const [me, setMe] = useState<{ accountId: string; wire: AuthMeWire | null } | null>(null);

  useEffect(() => {
    if (!accountId) return undefined;
    const abort = new AbortController();
    // noRedirect: the Reading layout serves anonymous share links too; the
    // workspace owns any sign-in redirect, this read only picks the tree.
    getCurrentUser(abort.signal, { noRedirect: true }).then(
      (wire) => setMe({ accountId, wire }),
      (error) => {
        if (abort.signal.aborted) return;
        if ((error as { status?: number } | null)?.status !== 401) {
          (window as any).aver?.reportError?.('review frame: /auth/me failed', {
            type: 'review_v2_profile_failed',
            detail: error instanceof Error ? error.message : String(error ?? ''),
          });
        }
        setMe({ accountId, wire: null });
      },
    );
    return () => abort.abort();
  }, [accountId]);

  // Until the flag is known nothing is drawn, so the workspace mounts once in
  // its final tree (a switch would reload the review and lose the scroll).
  const own = accountId && me?.accountId === accountId ? me : null;
  if (status === 'initial-loading' || (accountId && !own)) {
    return <main className="exam-state-shell"><p className="exam-state-msg" role="status">Đang tải chữa bài…</p></main>;
  }

  const wire = own?.wire ?? null;
  if (!wire || !learnerV2Enabled(wire) || !user) {
    return <ReviewV2Context.Provider value={REVIEW_V2_OFF}>{children}</ReviewV2Context.Provider>;
  }
  const email = user.email ?? wire.email ?? '';
  const learner: LearnerUser = {
    name: wire.display_name?.trim() || email,
    email,
    initials: initials(wire.display_name ?? null, email),
  };
  // Keyed by account: another account never inherits this one's tree state.
  return <ReviewV2Frame key={user.id} learner={learner} isAdmin={wire.role === 'admin'}>{children}</ReviewV2Frame>;
}
