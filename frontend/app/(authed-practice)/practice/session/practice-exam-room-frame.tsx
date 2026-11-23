'use client';

// EXAMSPEAK-0072 FR-001, FR-011 (G08-T18): the focus bar around the Speaking
// page. practice-page-shell.tsx loads this file through lazyLegacyRoom() only
// when the `speaking` flag is on: the (authed-practice) layout is a legacy
// layout, so LegacyRoomRoot brings the av2 root, fonts, tokens.css and base.css
// in the room's chunk, and the flag-off page loads the same assets as before
// (UIBASE-0056 FR-003, as in #2597).
import { useEffect, useState, type ReactNode } from 'react';

import { FocusShell, FocusStatus, FocusTimer } from '@/components/ui/shell/focus-shell';
import { speakingRoomStrings, type SpeakingRoomMode } from '@/lib/exam-room/strings-speaking.mjs';

import { callApp, elapsedClock } from './practice-exam-room';

function useElapsed(running: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return undefined;
    const started = Date.now() - seconds * 1000;
    const id = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(id);
    // Resume from where it stopped; `seconds` is read once per start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);
  return seconds;
}

export function PracticeExamRoom({
  view,
  activeState,
  mode,
  returnHref,
  children,
}: {
  view: any;
  activeState: string;
  mode: SpeakingRoomMode;
  returnHref: string;
  children: ReactNode;
}) {
  const strings = speakingRoomStrings(mode);
  const elapsed = useElapsed(activeState !== 'loading' && activeState !== 'error');
  const title = typeof view.frame?.contextLabel === 'string' && view.frame.contextLabel ? view.frame.contextLabel : 'Speaking';
  const detail = view.header?.visible && view.header.info ? String(view.header.info) : undefined;
  const progress = view.header?.visible && view.header.progress ? String(view.header.progress) : '';
  return (
    <FocusShell
      mode={mode === 'test' ? 'exam' : 'practice'}
      // Speaking has no server timer (open question 3): never say it keeps running.
      leaveCopy={mode === 'test' ? { lead: undefined } : undefined}
      title={title}
      detail={detail}
      exitHref={returnHref}
      hasUnsavedWork={() => callApp('hasUnsavedWork') === true}
      right={(
        <>
          {progress ? <FocusStatus>{progress}</FocusStatus> : null}
          <FocusTimer label={strings.elapsed} value={elapsedClock(elapsed)} />
        </>
      )}
    >
      <div className="flex-1 flex flex-col" data-exam-room-speaking>{children}</div>
    </FocusShell>
  );
}
