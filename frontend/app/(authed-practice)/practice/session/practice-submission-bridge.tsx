'use client';

import { useEffect } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { SpeakingSubmissionController } from '../../../../public/js/speaking-submission-controller.mjs';

export function PracticeSubmissionBridge() {
  const { status, user } = useAuth();

  useEffect(() => {
    if (status !== 'signed-in' || !user?.id) return undefined;
    const win = window as any;
    const submission = new SpeakingSubmissionController({
      // A redirect here would destroy the only in-memory copy of an
      // unconfirmed recording. Preserve 401 and let the player keep the blob.
      upload: (path: string, formData: FormData) => (
        win.api.uploadWith(path, formData, { noRedirect: true })
      ),
      getSession: (path: string) => win.api.getWith(path, {}, { noRedirect: true }),
    });
    win.PracticeSubmission = submission;

    return () => {
      submission.destroy();
      if (win.PracticeSubmission === submission) delete win.PracticeSubmission;
    };
  }, [status, user?.id]);

  return null;
}
