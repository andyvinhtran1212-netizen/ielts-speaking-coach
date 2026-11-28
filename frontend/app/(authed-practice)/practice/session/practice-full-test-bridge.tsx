'use client';

import { useEffect, useRef } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { coreOperationRequest } from '@/lib/core-operation-intent.mjs';
import { registerNavigationGuard } from '@/lib/navigation-guard';
import { SpeakingFullTestController } from '../../../../public/js/speaking-full-test-controller.mjs';

export function PracticeFullTestBridge() {
  const { status, user } = useAuth();
  const installation = useRef<{ ownerId: string; dispose: () => void } | null>(null);

  // Auth expiry can retain this owner-scoped queue; leaving the page always
  // disposes it. Do not tie its cleanup to every auth-status transition.
  useEffect(() => () => {
    installation.current?.dispose();
    installation.current = null;
  }, []);

  useEffect(() => {
    const win = window as any;
    if (status === 'signed-out' && installation.current
        && win.PracticeApp?.retainExpiredSession?.() === true) return;
    if (status === 'signed-in' && installation.current?.ownerId === user?.id) return;
    // A different account must never inherit the previous owner's blobs.
    installation.current?.dispose();
    installation.current = null;
    if (status !== 'signed-in' || !user?.id) return;
    let storage = null;
    try { storage = win.sessionStorage; } catch { /* storage is best-effort */ }
    const controller = new SpeakingFullTestController({
      storage,
      submit: (request: Record<string, unknown>) => {
        if (typeof win.PracticeSubmission?.submit !== 'function') {
          throw new Error('Speaking submission transport is unavailable');
        }
        return win.PracticeSubmission.submit(request);
      },
      finalize: (body: Record<string, unknown>) => (
        coreOperationRequest({
          accountId: user.id, method: 'POST', path: '/sessions/finalize-full-test', input: body,
          // Admission acknowledgement, not proof that background grading ended.
          acknowledged: (reply: any) => reply?.accepted === true && Array.isArray(reply?.session_ids),
        }, (headers: Record<string, string>) => win.api.postWith('/sessions/finalize-full-test', body, headers, { noRedirect: true }))
      ),
      getSession: (sessionId: string) => (
        win.api.getWith(
          `/sessions/${encodeURIComponent(sessionId)}`,
          {},
          { noRedirect: true },
        )
      ),
    });

    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      // EXAMSPEAK-0072 FR-007: the learner already chose to drop the recordings in the room's box.
      if (win.PracticeApp?.leaveConfirmed?.() === true) return;
      if (!controller.hasUnsavedAudio() && !win.PracticeApp?.hasUnsavedWork?.()) return;
      event.preventDefault();
      event.returnValue = '';
    };

    win.PracticeFullTest = controller;
    const releaseNavigationGuard = registerNavigationGuard(warnBeforeUnload);
    installation.current = { ownerId: user.id, dispose: () => {
      releaseNavigationGuard();
      controller.destroy();
      if (win.PracticeFullTest === controller) delete win.PracticeFullTest;
    } };
  }, [status, user?.id]);

  return null;
}
