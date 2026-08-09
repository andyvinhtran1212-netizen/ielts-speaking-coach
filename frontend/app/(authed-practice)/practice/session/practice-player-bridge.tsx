'use client';

import { useEffect, useState } from 'react';

import { installPracticePlayerController } from '@/lib/practice-player-lifecycle.mjs';
import { SPEAKING_PLAYER_INITIAL_VIEW } from '@/lib/speaking-player-controller.mjs';
import { PracticePageShell } from './practice-page-shell';

const INERT_PLAYER_STATE = Object.freeze({
  getStateSnapshot: () => null,
  subscribeState: () => () => {},
  getViewSnapshot: () => SPEAKING_PLAYER_INITIAL_VIEW,
  subscribeView: () => () => {},
  updateView: () => false,
});

export function PracticePlayerBridge() {
  const [controller, setController] = useState<ReturnType<typeof installPracticePlayerController>['controller'] | null>(null);

  useEffect(() => {
    const installation = installPracticePlayerController(window as any);
    setController(installation.controller);
    return installation.cleanup;
  }, []);

  return <PracticePageShell player={controller || INERT_PLAYER_STATE} />;
}
