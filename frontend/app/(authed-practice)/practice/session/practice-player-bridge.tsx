'use client';

import { useEffect, useState } from 'react';

import { SpeakingPlayerController } from '@/lib/speaking-player-controller.mjs';
import { PracticePageShell } from './practice-page-shell';

const INERT_PLAYER_STATE = Object.freeze({
  getStateSnapshot: () => null,
  subscribeState: () => () => {},
});

function createPlayerController() {
  const browser = typeof window === 'undefined' ? globalThis : window;
  return new SpeakingPlayerController({
    document: (browser as any).document,
    urlApi: (browser as any).URL,
    speechSynthesis: (browser as any).speechSynthesis,
    setIntervalFn: browser.setInterval.bind(browser),
    clearIntervalFn: browser.clearInterval.bind(browser),
    setTimeoutFn: browser.setTimeout.bind(browser),
    clearTimeoutFn: browser.clearTimeout.bind(browser),
    // App Router renders the active state from the controller snapshot. The
    // default controller path still mutates classes for the legacy page.
    domStateActivation: false,
  });
}

export function PracticePlayerBridge() {
  const [controller, setController] = useState<ReturnType<typeof createPlayerController> | null>(null);

  useEffect(() => {
    const win = window as any;
    const mountedController = createPlayerController();
    win.PracticePlayer = mountedController;
    setController(mountedController);
    return () => {
      win.PracticeApp?.destroy?.();
      mountedController.destroy();
      if (win.PracticePlayer === mountedController) delete win.PracticePlayer;
    };
  }, []);

  return <PracticePageShell player={controller || INERT_PLAYER_STATE} />;
}
