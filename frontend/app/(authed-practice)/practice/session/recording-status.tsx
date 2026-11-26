'use client';

// EXAMSPEAK-0072 FR-004 (G08-T18): the recording state in words, not colour
// alone. practice.js sends `recording.level` (RMS 0..1 of the analyser's
// time-domain bytes, or null when there is no analyser) and `recording.paused`
// (track muted or MediaRecorder paused by the browser); this file decides
// "Không nghe thấy tiếng" from them.
import { useEffect, useRef, useState } from 'react';

import type { speakingRoomStrings } from '@/lib/exam-room/strings-speaking.mjs';

/** Below this level counts as silence (open question 4; tuned on staging with a fake mic). */
export const SILENCE_RMS = 0.02;
/** Silence must last this long before the room says so. */
export const SILENCE_MS = 3000;

export type RecordingSubstate = 'idle' | 'recording' | 'recorded';
export type RecordingPhase = 'ready' | 'recording' | 'silent' | 'paused' | 'recorded';

type Strings = ReturnType<typeof speakingRoomStrings>;

/** Silence for SILENCE_MS while recording; never without a level. */
export function useSilence(recording: boolean, level: number | null | undefined, now: () => number = Date.now): boolean {
  const [silent, setSilent] = useState(false);
  const quietSince = useRef<number | null>(null);
  const quiet = recording && typeof level === 'number' && level < SILENCE_RMS;
  useEffect(() => {
    if (!quiet) { quietSince.current = null; setSilent(false); return undefined; }
    if (quietSince.current == null) quietSince.current = now();
    const left = SILENCE_MS - (now() - quietSince.current);
    if (left <= 0) { setSilent(true); return undefined; }
    // A level that stays exactly the same does not re-render, so wait on a timer.
    const id = window.setTimeout(() => setSilent(true), left);
    return () => window.clearTimeout(id);
  }, [quiet, level, now]);
  return quiet && silent;
}

export function recordingPhase(substate: RecordingSubstate, paused: boolean, silent: boolean): RecordingPhase {
  if (substate === 'recorded') return 'recorded';
  if (substate !== 'recording') return 'ready';
  if (paused) return 'paused';
  return silent ? 'silent' : 'recording';
}

export function RecordingStatus({
  substate,
  timer,
  duration,
  level,
  paused = false,
  strings,
  now,
}: {
  substate: RecordingSubstate;
  timer: string;
  duration: string;
  level?: number | null;
  paused?: boolean;
  strings: Strings;
  now?: () => number;
}) {
  const silent = useSilence(substate === 'recording', level, now);
  const phase = recordingPhase(substate, paused, silent);
  let label: string = strings.recReady;
  let detail: string | null = null;
  if (phase === 'recording') { label = strings.recRecording; detail = timer; }
  if (phase === 'silent') { label = strings.recSilent; detail = strings.recSilentHint; }
  if (phase === 'paused') { label = strings.recPaused; detail = strings.recPausedHint; }
  if (phase === 'recorded') { label = strings.recRecorded; detail = duration || null; }
  return (
    <div
      className="practice-room-rec-status text-sm"
      data-rec-phase={phase}
      role="status"
      aria-live="polite"
      aria-label={strings.recRegion}
      style={{ display: 'flex', gap: 8, alignItems: 'baseline', justifyContent: 'center', flexWrap: 'wrap', margin: '0 0 12px' }}
    >
      <strong>{label}</strong>
      {detail ? <span className={phase === 'recording' ? 'tabular-nums' : undefined}>{detail}</span> : null}
    </div>
  );
}
