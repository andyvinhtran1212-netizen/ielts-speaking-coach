'use client';

// EXAMSPEAK-0072 FR-001, FR-003, FR-004, FR-005, FR-011 (G08-T18): the Speaking
// page inside the focus bar of the exam room. practice.js still owns the whole
// flow; this file draws the bar, the microphone and the recording state from
// the view practice.js already publishes, and never calls an API. The frame
// itself (FocusShell, the "Bản in" tokens and fonts) is in
// practice-exam-room-frame.tsx, loaded only while the flag is on.
import type { ReactNode } from 'react';

import { trackExamRoomEvent } from '@/components/exam-room/track';
import {
  speakingRoomMode,
  speakingRoomStrings,
  speakingTooShortReason,
  type SpeakingRoomMode,
} from '@/lib/exam-room/strings-speaking.mjs';

import { MicStatus, micState } from './mic-status';
import { RecordingStatus, type RecordingSubstate } from './recording-status';

export function callApp(method: string) {
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
  /** P1/P3 microphone box, above "Bắt đầu ghi âm" and outside the inline
   *  recording section, so "Cho phép micro" shows before the recorder opens. */
  prepMic: ReactNode;
  /** Above the P1/P3 recorder (inline recording section). */
  recorder: ReactNode;
  /** Above the Part 2 cue card start button. */
  part2Cue: ReactNode;
  /** Above the Part 2 "speak now" button: the microphone is asked for here. */
  part2Prep: ReactNode;
  /** Above the Part 2 speaking timer. */
  part2Speaking: ReactNode;
};

// `.av2-root` paints the paper colour; a slot sits inside a legacy card and
// takes that card's background instead of drawing its own band.
const SLOT_STYLE = { background: 'transparent' } as const;

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
  // The recorded duration is left to the legacy body ("Thời lượng ghi âm"),
  // so the room does not print the same number twice.
  // Only the slot of the screen on show is drawn, so the page never holds two
  // microphone boxes or two alerts at once. Each slot is its own `.av2-root`
  // (base.css loads with the room); the legacy body around it is not.
  return {
    mode,
    slots: {
      // P1/P3: `_showPrep()` hides the inline recording section until
      // "Bắt đầu ghi âm" opens it and starts the recorder, so the microphone
      // box sits outside that section (FR-003) and stays there while recording.
      prepMic: activeState === 'prep' ? (
        <div className="av2-root" data-room-slot="prep-mic" style={SLOT_STYLE}>
          {micBox}
        </div>
      ) : null,
      recorder: activeState === 'prep' ? (
        <div className="av2-root" data-room-slot="recorder" style={SLOT_STYLE}>
          <RecordingStatus substate={substate} timer={rec.timer || '0:00'} duration="" level={level} paused={rec.paused === true} strings={strings} />
          <TooShortReason value={tooShortOf(rec.tooShort)} mode={mode} />
        </div>
      ) : null,
      part2Cue: activeState === 'p2a' ? (
        <div className="av2-root" data-room-slot="part2-cue" style={SLOT_STYLE}>
          {micBox}
          <TooShortReason value={tooShortOf(view.part2?.tooShort)} mode={mode} />
        </div>
      ) : null,
      // Part 2 asks for the microphone when preparation ends, on this screen,
      // so its pending state and any recovery steps show here too.
      part2Prep: activeState === 'p2b' ? (
        <div className="av2-root" data-room-slot="part2-prep" style={SLOT_STYLE}>
          {micBox}
        </div>
      ) : null,
      part2Speaking: activeState === 'p2c' ? (
        <div className="av2-root" data-room-slot="part2-speaking" style={SLOT_STYLE}>
          <RecordingStatus substate="recording" timer={view.part2?.speakTimer || ''} duration="" level={level} paused={rec.paused === true} strings={strings} />
        </div>
      ) : null,
    },
  };
}
