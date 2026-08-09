'use client';

import { useEffect } from 'react';

import { SpeakingSubmissionController } from '@/lib/speaking-submission-controller.mjs';

export function PracticeSubmissionBridge() {
  useEffect(() => {
    const win = window as any;
    const submission = new SpeakingSubmissionController({
      upload: (path: string, formData: FormData) => win.api.upload(path, formData),
      getSession: (path: string) => win.api.get(path),
    });
    win.PracticeSubmission = submission;

    return () => {
      submission.destroy();
      if (win.PracticeSubmission === submission) delete win.PracticeSubmission;
    };
  }, []);

  return null;
}
