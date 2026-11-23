'use client';

// EXAMSPEAK-0072 FR-006–FR-008, FR-010, FR-012 (G08-T19): the boxes the Speaking
// room asks in the page instead of window.confirm and alert. practice.js
// decides when to ask (`view.dialog.kind`) and what each answer does; this file
// only draws the box and reports the answer through PracticeApp.
import { useEffect, useId, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  speakingRoomStrings,
  speakingUnsentSubmitTitle,
  type SpeakingRoomMode,
} from '@/lib/exam-room/strings-speaking.mjs';

import { callApp } from './practice-exam-room';

export type SpeakingDialogKind = 'rerecord' | 'rerecord-part2' | 'leave' | 'submit' | 'expired';

const KINDS = new Set<SpeakingDialogKind>(['rerecord', 'rerecord-part2', 'leave', 'submit', 'expired']);

export function dialogKind(value: unknown): SpeakingDialogKind | null {
  return typeof value === 'string' && KINDS.has(value as SpeakingDialogKind) ? value as SpeakingDialogKind : null;
}

/** `/login?next=<this page>`: the sign-in page brings the learner back here. */
export function speakingLoginHref(): string {
  const here = `${window.location.pathname}${window.location.search}`;
  return `/login?next=${encodeURIComponent(here)}`;
}

export function SpeakingRoomDialogs({ kind, unsent, mode }: { kind: SpeakingDialogKind | null; unsent: number; mode: SpeakingRoomMode }) {
  const strings = speakingRoomStrings(mode);
  const safeRef = useRef<HTMLButtonElement>(null);
  const bodyId = useId();
  const lang = mode === 'test' ? 'en' : undefined;
  if (!kind) return null;

  let title: string;
  let body: string;
  let note: string | null = null;
  let safeLabel: string;
  let onSafe: () => void;
  let other: { label: string; danger: boolean; run: () => void } | null;

  if (kind === 'rerecord' || kind === 'rerecord-part2') {
    title = strings.rerecordTitle;
    body = strings.rerecordBody;
    safeLabel = strings.rerecordKeep;
    onSafe = () => { callApp('confirmRerecord', false); };
    other = { label: strings.rerecordDiscard, danger: true, run: () => { callApp('confirmRerecord', true); } };
  } else if (kind === 'leave') {
    title = strings.leaveTitle;
    body = strings.leaveBody;
    safeLabel = strings.leaveStay;
    onSafe = () => { callApp('confirmLeave', false); };
    other = { label: strings.leaveGo, danger: true, run: () => { callApp('confirmLeave', true); } };
  } else if (kind === 'submit') {
    title = speakingUnsentSubmitTitle(unsent, mode);
    body = strings.submitBody;
    safeLabel = strings.submitRetry;
    onSafe = () => { callApp('confirmSubmitWithUnsent', 'retry'); };
    other = { label: strings.submitAnyway, danger: false, run: () => { callApp('confirmSubmitWithUnsent', 'submit'); } };
  } else {
    title = strings.expiredTitle;
    body = strings.expiredBody;
    if (unsent > 0) {
      // Signing in on this tab drops the page; say so and let the learner choose.
      note = strings.expiredUnsent;
      safeLabel = strings.expiredStay;
      onSafe = () => { callApp('confirmLeave', false); };
      other = { label: strings.expiredSignInLose, danger: true, run: () => { callApp('confirmLeave', true, speakingLoginHref()); } };
    } else {
      safeLabel = strings.expiredSignIn;
      onSafe = () => { callApp('confirmLeave', true, speakingLoginHref()); };
      other = null;
    }
  }
  // Esc, the backdrop and the close button take the safe way, except where the
  // safe way leaves the page (expired with nothing unsent): then they just close.
  const close = kind === 'expired' && unsent === 0 ? () => { callApp('confirmLeave', false); } : onSafe;

  return (
    <Dialog
      open
      onClose={close}
      role="alertdialog"
      describedBy={bodyId}
      initialFocusRef={safeRef}
      title={title}
      closeLabel={strings.close}
      actions={(
        <>
          {/* data-room-action: journeys answer the box without reading its words (write-flows clickIfPresent). */}
          <Button ref={safeRef} variant="primary" onClick={onSafe} data-room-action="safe">{safeLabel}</Button>
          {other ? <Button variant={other.danger ? 'danger' : 'secondary'} onClick={other.run} data-room-action="proceed">{other.label}</Button> : null}
        </>
      )}
    >
      <div id={bodyId} lang={lang} data-room-dialog={kind}>
        <p>{body}</p>
        {note ? <p>{note}</p> : null}
      </div>
    </Dialog>
  );
}

function anchorOf(event: Event): HTMLAnchorElement | null {
  for (const node of event.composedPath()) {
    if (node instanceof HTMLAnchorElement) return node;
  }
  return null;
}

/**
 * FR-007: a link anywhere on the page (body, chrome) with unsent recordings
 * opens the room's box first; the learner's choice then navigates by code.
 * Capture phase, so neither Next's <Link> nor the chrome bridge sees the click.
 */
export function useSpeakingLinkGuard(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return undefined;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = anchorOf(event);
      if (!anchor || anchor.hasAttribute('download') || anchor.closest('dialog')) return;
      const target = anchor.getAttribute('target');
      if (target && target !== '_self') return;
      let url: URL;
      try { url = new URL(anchor.href, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (callApp('hasUnsavedWork') !== true) return;
      event.preventDefault();
      event.stopPropagation();
      callApp('requestLeave', `${url.pathname}${url.search}${url.hash}`);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [enabled]);
}
