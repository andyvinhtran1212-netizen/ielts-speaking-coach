'use client';

// EXAMSPEAK-0072 FR-001, FR-003, FR-004, FR-005, FR-011 (G08-T18): the Speaking
// page inside the focus bar of the exam room. practice.js still owns the whole
// flow; this file draws the bar, the microphone and the recording state from
// the view practice.js already publishes, and never calls an API.
import { useEffect, useState, type ReactNode } from 'react';

import { trackExamRoomEvent } from '@/components/exam-room/track';
import { FocusShell, FocusStatus, FocusTimer } from '@/components/ui/shell/focus-shell';
import {
  speakingRoomMode,
  speakingRoomStrings,
  speakingTooShortReason,
  type SpeakingRoomMode,
} from '@/lib/exam-room/strings-speaking.mjs';

import { MicStatus, micState } from './mic-status';
import { RecordingStatus, type RecordingSubstate } from './recording-status';

function callApp(method: string) {
  const app = (window as any).PracticeApp;
  if (!app || typeof app[method] !== 'function') return undefined;
  return app[method]();
}

/** "m:ss" counting up; "h:mm:ss" past an hour. */
export function elapsedClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

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

type TooShort = { part: number | string; durationSeconds: number; minSeconds: number } | null;

function tooShortOf(value: any): TooShort {
  if (!value || typeof value !== 'object') return null;
  const durationSeconds = Number(value.durationSeconds);
  const minSeconds = Number(value.minSeconds);
  if (!Number.isFinite(durationSeconds) || !Number.isFinite(minSeconds)) return null;
  return { part: value.part ?? '', durationSeconds, minSeconds };
}

function TooShortReason({ value, mode }: { value: TooShort; mode: SpeakingRoomMode }) {
  if (!value) return null;
  return (
    <p className="ds-callout practice-error-callout text-sm" role="alert" data-room-too-short style={{ marginBottom: 12 }}>
      {speakingTooShortReason(value.durationSeconds, value.part, value.minSeconds, mode)}
    </p>
  );
}

/** What the room adds inside the existing page; null slots draw nothing. */
export type SpeakingRoomSlots = {
  /** Above the P1/P3 recorder (inline recording section). */
  recorder: ReactNode;
  /** Above the Part 2 cue card start button. */
  part2Cue: ReactNode;
  /** Above the Part 2 speaking timer. */
  part2Speaking: ReactNode;
};

/** The room's slots for the current view (FR-003, FR-004, FR-005). Not a hook. */
export function speakingRoomSlots(view: any, activeState: string): { mode: SpeakingRoomMode; slots: SpeakingRoomSlots } {
  const mode = speakingRoomMode(view.frame?.examRoomSessionMode);
  const strings = speakingRoomStrings(mode);
  const mic = micState(view.mic?.state);
  const requestMic = () => { void callApp('requestMicrophone'); };
  const micBox = <MicStatus state={mic} strings={strings} onRequest={requestMic} track={trackExamRoomEvent} />;
  const rec = view.recording || {};
  const substate: RecordingSubstate = rec.substate === 'recording' || rec.substate === 'recorded' ? rec.substate : 'idle';
  const level = typeof rec.level === 'number' ? rec.level : null;
  // Only the slot of the screen on show is drawn, so the page never holds two
  // microphone boxes or two alerts at once.
  return {
    mode,
    slots: {
      recorder: activeState === 'prep' ? (
        <div data-room-slot="recorder">
          {micBox}
          <RecordingStatus substate={substate} timer={rec.timer || '0:00'} duration={rec.duration || ''} level={level} paused={rec.paused === true} strings={strings} />
          <TooShortReason value={tooShortOf(rec.tooShort)} mode={mode} />
        </div>
      ) : null,
      part2Cue: activeState === 'p2a' ? (
        <div data-room-slot="part2-cue">
          {micBox}
          <TooShortReason value={tooShortOf(view.part2?.tooShort)} mode={mode} />
        </div>
      ) : null,
      part2Speaking: activeState === 'p2c' ? (
        <div data-room-slot="part2-speaking">
          <RecordingStatus substate="recording" timer={view.part2?.speakTimer || ''} duration="" level={level} paused={rec.paused === true} strings={strings} />
        </div>
      ) : null,
    },
  };
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
