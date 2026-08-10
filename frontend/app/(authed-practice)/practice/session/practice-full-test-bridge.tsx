'use client';

import { useEffect } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { SpeakingFullTestController } from '@/lib/speaking-full-test-controller.mjs';

export function PracticeFullTestBridge() {
  const { status, user } = useAuth();

  useEffect(() => {
    if (status !== 'signed-in' || !user?.id) return undefined;
    const win = window as any;
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
        win.api.postWith('/sessions/finalize-full-test', body, {}, { noRedirect: true })
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
      if (!controller.hasUnsavedAudio()) return;
      event.preventDefault();
      event.returnValue = '';
    };

    win.PracticeFullTest = controller;
    win.addEventListener('beforeunload', warnBeforeUnload);
    return () => {
      win.removeEventListener('beforeunload', warnBeforeUnload);
      controller.destroy();
      if (win.PracticeFullTest === controller) delete win.PracticeFullTest;
    };
  }, [status, user?.id]);

  return null;
}
