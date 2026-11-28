'use client';

import { useEffect } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { coreSpeakingUpload } from '@/lib/core-speaking-operation.mjs';
import { coreOperationRequest } from '@/lib/core-operation-intent.mjs';
import { SpeakingSubmissionController } from '../../../../public/js/speaking-submission-controller.mjs';

export function PracticeSubmissionBridge() {
  const { status, user } = useAuth();

  useEffect(() => {
    if (status !== 'signed-in' || !user?.id) return undefined;
    const win = window as any;
    const submission = Object.assign(new SpeakingSubmissionController({
      // A redirect here would destroy the only in-memory copy of an
      // unconfirmed recording. Preserve 401 and let the player keep the blob.
      upload: (path: string, formData: FormData, { signal }: { signal: AbortSignal }) => (
        coreSpeakingUpload({ accountId: user.id, path, formData }, (headers: Record<string, string>) =>
          win.api.uploadWith(path, formData, { noRedirect: true, signal }, headers))
      ),
      getSession: (path: string, { signal }: { signal: AbortSignal }) => win.api.getWith(path, {}, { noRedirect: true, signal }),
    }), {
      // EXAMSPEAK-0072 FR-010: the exam room passes `{ noRedirect: true }` so a
      // 401 stays in the page; without options the call is exactly as before.
      complete: (sessionId: string, options?: { noRedirect?: boolean }) => {
        const path = `/sessions/${encodeURIComponent(sessionId)}/complete`;
        const noRedirect = options?.noRedirect === true;
        return coreOperationRequest({
          accountId: user.id, method: 'PATCH', path, input: {},
          acknowledged: (reply: any) => (reply?.session_id === sessionId || reply?.id === sessionId) && reply?.status === 'completed',
        }, (headers: Record<string, string>) => (noRedirect
          ? win.api.patchWith(path, {}, headers, { noRedirect: true })
          : win.api.patchWith(path, {}, headers)));
      },
    });
    win.PracticeSubmission = submission;

    return () => {
      submission.destroy();
      if (win.PracticeSubmission === submission) delete win.PracticeSubmission;
    };
  }, [status, user?.id]);

  return null;
}
