'use client';

import { useEffect } from 'react';

import { SpeakingPlayerController } from '@/lib/speaking-player-controller.mjs';

export function PracticePlayerBridge() {
  useEffect(() => {
    const win = window as any;
    const controller = new SpeakingPlayerController({
      document: win.document,
      urlApi: win.URL,
      speechSynthesis: win.speechSynthesis,
      setIntervalFn: win.setInterval.bind(win),
      clearIntervalFn: win.clearInterval.bind(win),
      setTimeoutFn: win.setTimeout.bind(win),
      clearTimeoutFn: win.clearTimeout.bind(win),
    });

    win.PracticePlayer = controller;
    return () => {
      win.PracticeApp?.destroy?.();
      controller.destroy();
      if (win.PracticePlayer === controller) delete win.PracticePlayer;
    };
  }, []);

  return null;
}
