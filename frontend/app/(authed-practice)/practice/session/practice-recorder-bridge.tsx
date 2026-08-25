'use client';

import { useEffect } from 'react';

import { SpeakingRecorderController } from '@/lib/speaking-recorder-controller.mjs';

export function PracticeRecorderBridge() {
  useEffect(() => {
    const recorder = new SpeakingRecorderController();
    const win = window as any;
    win.PracticeRecorder = recorder;

    return () => {
      recorder.destroy();
      if (win.PracticeRecorder === recorder) delete win.PracticeRecorder;
    };
  }, []);

  return null;
}
