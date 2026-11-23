'use client';

// EXAMSPEAK-0072 FR-003 (G08-T18): the microphone, in words, before and around
// the browser's permission box. practice.js owns the state (`view.mic.state`);
// this file only draws it and asks practice.js to request the device.
import { useEffect, useRef } from 'react';

import type { speakingRoomStrings } from '@/lib/exam-room/strings-speaking.mjs';

export type MicState =
  | 'unknown'
  | 'prompt'
  | 'pending'
  | 'granted'
  | 'denied'
  | 'not_found'
  | 'busy'
  | 'unsupported';

const MIC_STATES: readonly MicState[] = ['unknown', 'prompt', 'pending', 'granted', 'denied', 'not_found', 'busy', 'unsupported'];

/** Problem cases sent to analytics by name only (FR-013). */
const REPORTED: readonly MicState[] = ['denied', 'not_found', 'busy', 'unsupported'];

export function micState(value: unknown): MicState {
  return MIC_STATES.includes(value as MicState) ? (value as MicState) : 'unknown';
}

type Strings = ReturnType<typeof speakingRoomStrings>;

export function MicStatus({
  state,
  strings,
  onRequest,
  track,
  lost = false,
}: {
  state: MicState;
  /** The track ended while recording (R139): "Mất kết nối micro", kept until the mic is granted again. */
  lost?: boolean;
  strings: Strings;
  /** "Cho phép micro" and "Thử lại": practice.js `requestMicrophone`. */
  onRequest: () => void;
  track?: (name: string, props: Record<string, string>) => void;
}) {
  const reported = useRef<MicState | null>(null);
  useEffect(() => {
    if (!REPORTED.includes(state) || reported.current === state) return;
    reported.current = state;
    track?.('exam_room_mic', { surface: 'speaking', state });
  }, [state, track]);

  // R139: kept above every case until the microphone works again, so an error
  // on a later "Thử lại" does not hide why the take stopped.
  const showLost = lost && state !== 'granted' && state !== 'unknown';
  const lostLine = showLost ? <p className="text-sm font-semibold" style={{ margin: '0 0 4px' }} data-mic-lost>{strings.micLost}</p> : null;
  let body = null;
  if (state === 'prompt') {
    body = (
      <>
        <p className="text-sm" style={{ margin: '0 0 8px' }}>{strings.micPrompt}</p>
        <button type="button" className="btn-primary px-5 py-2.5 text-sm font-semibold" onClick={onRequest}>{strings.micAllow}</button>
      </>
    );
  } else if (state === 'pending') {
    body = (
      <>
        <p className="text-sm" style={{ margin: '0 0 8px' }}>{strings.micPending}</p>
        <button type="button" className="btn-primary px-5 py-2.5 text-sm font-semibold" disabled aria-disabled="true">{strings.micPendingButton}</button>
      </>
    );
  } else if (state === 'not_found' || state === 'busy') {
    body = (
      <>
        <p className="text-sm" style={{ margin: '0 0 8px' }}>{state === 'not_found' ? strings.micNotFound : strings.micBusy}</p>
        <button type="button" className="btn-ghost px-5 py-2.5 text-sm font-semibold" onClick={onRequest}>{strings.micRetry}</button>
      </>
    );
  } else if (state === 'unsupported') {
    body = <p className="text-sm" style={{ margin: 0 }}>{strings.micUnsupported}</p>;
  }

  return (
    <div className="practice-room-mic" data-mic-state={state} aria-label={strings.micRegion} role="group">
      {/* Polite for every case; the denied case below is announced once as an alert. */}
      {/* A lost microphone takes the warning tone (CR nit); `display: block` undoes the callout's flex row. */}
      <div aria-live="polite">{body ? (
        <div className={showLost ? 'ds-callout practice-warning-callout' : 'ds-callout'} style={showLost ? { marginBottom: 12, display: 'block' } : { marginBottom: 12 }} data-mic-tone={showLost ? 'warning' : 'info'}>{lostLine}{body}</div>
      ) : null}</div>
      {state === 'denied' ? (
        <div className="ds-callout practice-error-callout" role="alert" style={{ marginBottom: 12 }}>
          {lostLine}
          <p className="text-sm font-semibold" style={{ margin: '0 0 6px' }}>{strings.micDeniedTitle}</p>
          <ol className="text-sm" style={{ margin: '0 0 6px', paddingLeft: 20 }}>
            {strings.micDeniedSteps.map((step) => <li key={step}>{step}</li>)}
          </ol>
          <p className="text-xs" style={{ margin: '0 0 8px' }}>{strings.micDeniedKept}</p>
          <button type="button" className="btn-ghost px-5 py-2.5 text-sm font-semibold" onClick={onRequest}>{strings.micRetry}</button>
        </div>
      ) : null}
    </div>
  );
}
