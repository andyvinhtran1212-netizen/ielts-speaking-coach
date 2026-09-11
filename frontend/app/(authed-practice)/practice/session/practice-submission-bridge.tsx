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
      upload: (path: string, formData: FormData) => (
        coreSpeakingUpload({ accountId: user.id, path, formData }, (headers: Record<string, string>) =>
          win.api.uploadWith(path, formData, { noRedirect: true }, headers))
      ),
      getSession: (path: string) => win.api.getWith(path, {}, { noRedirect: true }),
    }), {
      complete: (sessionId: string) => {
        const path = `/sessions/${encodeURIComponent(sessionId)}/complete`;
        return coreOperationRequest({
          accountId: user.id, method: 'PATCH', path, input: {},
          acknowledged: (reply: any) => (reply?.session_id === sessionId || reply?.id === sessionId) && reply?.status === 'completed',
        }, (headers: Record<string, string>) => win.api.patchWith(path, {}, headers));
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
