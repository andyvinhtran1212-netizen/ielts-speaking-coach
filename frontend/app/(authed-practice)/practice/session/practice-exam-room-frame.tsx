'use client';

// EXAMSPEAK-0072 FR-001, FR-011 (G08-T18): the focus bar around the Speaking
// page. practice-page-shell.tsx loads this file with React.lazy only when the
// `speaking` flag is on, so the flag-off page loads the same assets as before
// (UIBASE-0056 FR-003). The (authed-practice) layout is legacy and loads none
// of the "Bản in" styles, so this chunk brings tokens.css, base.css and the
// fonts. `.av2-root` (and with it base.css) goes only on the room's own parts,
// the mic and recording slots; the legacy page body is never inside it, so its
// h2, links and buttons keep their own classes. The bar needs no `.av2-root`:
// FocusShell's module CSS draws it, and the root below gives it the fonts.
import '@/styles/av2/tokens.css';
import '@/styles/av2/base.css';

import type { CSSProperties } from 'react';
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';

import { FocusShell, FocusStatus, FocusTimer } from '@/components/ui/shell/focus-shell';
import { speakingRoomStrings, type SpeakingRoomMode } from '@/lib/exam-room/strings-speaking.mjs';
import { av2FontClass } from '@/styles/av2/fonts';

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

/**
 * UIBASE-0056 FR-009: the focus bar has no site navigation or account button
 * above it. page.tsx renders `<aver-chrome>` for the flag-off page; the room
 * hides it while shown and gives it back after (the same as the Reading and
 * Quick Check rooms). Inline `display` because the design sheet sets
 * `aver-chrome { display: block }`, which outranks the `hidden` attribute.
 */
function useHideSiteChrome() {
  useLayoutEffect(() => {
    const hidden = Array.from(document.querySelectorAll<HTMLElement>('aver-chrome'))
      .filter((element) => element.style.display !== 'none')
      .map((element) => ({ element, display: element.style.display }));
    hidden.forEach(({ element }) => { element.style.display = 'none'; });
    return () => { hidden.forEach(({ element, display }) => { element.style.display = display; }); };
  }, []);
}

// tokens.css declares the font stacks on `.av2-root` only; the room root sets
// the same two stacks, so FocusShell finds them without base.css on the body.
const FONT_STACKS = {
  '--av2-font-serif': 'var(--av2-ff-serif), Georgia, serif',
  '--av2-font-sans': 'var(--av2-ff-sans), system-ui, sans-serif',
} as CSSProperties;

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
  useHideSiteChrome();
  const strings = speakingRoomStrings(mode);
  const elapsed = useElapsed(activeState !== 'loading' && activeState !== 'error');
  const title = typeof view.frame?.contextLabel === 'string' && view.frame.contextLabel ? view.frame.contextLabel : 'Speaking';
  const detail = view.header?.visible && view.header.info ? String(view.header.info) : undefined;
  const progress = view.header?.visible && view.header.progress ? String(view.header.progress) : '';
  return (
    <div className={av2FontClass} style={FONT_STACKS} data-speaking-room-root="">
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
    </div>
  );
}
