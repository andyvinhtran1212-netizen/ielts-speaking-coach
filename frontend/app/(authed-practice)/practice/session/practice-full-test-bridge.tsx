'use client';

import { useEffect } from 'react';

import { SpeakingFullTestController } from '@/lib/speaking-full-test-controller.mjs';

export function PracticeFullTestBridge() {
  useEffect(() => {
    const win = window as any;
    const controller = new SpeakingFullTestController({
      storage: win.sessionStorage,
      submit: (request: Record<string, unknown>) => {
        if (typeof win.PracticeSubmission?.submit !== 'function') {
          throw new Error('Speaking submission transport is unavailable');
        }
        return win.PracticeSubmission.submit(request);
      },
      finalize: (body: Record<string, unknown>) => (
        win.api.post('/sessions/finalize-full-test', body)
      ),
      getSession: (sessionId: string) => (
        win.api.get(`/sessions/${encodeURIComponent(sessionId)}`)
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
  }, []);

  return null;
}
