'use client';

// R149, EXAMSPEAK-0072 edge case "Hai tab cùng phiên": one writing tab per
// Speaking session in a browser, through the shared EXAMROOM-0066 FR-017 guard
// (`surface='speaking'`, `attemptKey=session_id`). practice.js is told whether
// this tab may write (`setWriteRight`); a read-only tab opens no microphone and
// uploads nothing. Hand-over runs practice.js `roomFlush`, which is never
// "secured" while a take is recording, unsent or uploading (FR-009: takes live
// only in page memory), so the old tab refuses and the new one ends up stuck.
import { useEffect, useRef, useState } from 'react';

import { trackExamRoomEvent } from '@/components/exam-room/track';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { createTabGuard } from '@/lib/exam-room/tab-guard.mjs';
import type { speakingRoomStrings } from '@/lib/exam-room/strings-speaking.mjs';

import { callApp } from './practice-exam-room';

export type SpeakingTabState = 'pending' | 'writer' | 'read-only' | 'releasing' | 'acquiring' | 'stuck' | 'unsupported';

type Channel = { postMessage(m: unknown): void; close(): void; onmessage: ((e: { data: unknown }) => void) | null };
type Strings = ReturnType<typeof speakingRoomStrings>;

function safeLocalStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

/** The session this page records for; the guard's attempt key. */
export function speakingAttemptKey(): string {
  if (typeof window === 'undefined') return '';
  try { return new URLSearchParams(window.location.search).get('session_id') || ''; } catch { return ''; }
}

export function useSpeakingTabGuard(attemptKey: string) {
  const [state, setState] = useState<SpeakingTabState>(attemptKey ? 'pending' : 'unsupported');
  const [refused, setRefused] = useState(false);
  const guardRef = useRef<ReturnType<typeof createTabGuard> | null>(null);

  useEffect(() => {
    if (!attemptKey) { setState('unsupported'); return undefined; }
    let reported = false;
    // The guard reloads from the server every time it takes the right, the
    // first time too. Only a tab that was read-only can be behind the server.
    let behind = false;
    const guard = createTabGuard({
      surface: 'speaking',
      attemptKey,
      flush: () => Promise.resolve(callApp('roomFlush') ?? { secured: true, unsaved: 0 }),
      // A tab taking over holds nothing unsent (it was read-only), so a page
      // reload is the honest "reload the attempt from the server": it shows the
      // answers the other tab sent, and takes the lock again on the way in. The
      // first tab to open has nothing to catch up on and must not reload.
      reloadFromServer: () => {
        if (!behind) return Promise.resolve();
        window.location.reload();
        return new Promise(() => {});
      },
      onChange: (next: SpeakingTabState) => {
        if (next === 'read-only' || next === 'stuck') behind = true;
        setState(next);
        if (next !== 'writer') setRefused(false);
        if (next === 'read-only' && !reported) { reported = true; trackExamRoomEvent('exam_room_other_tab', { surface: 'speaking' }); }
      },
      onHandoverRefused: () => setRefused(true),
      locks: typeof navigator !== 'undefined' && 'locks' in navigator ? (navigator as any).locks : null,
      channelFactory: typeof BroadcastChannel === 'undefined' ? null : (name: string) => new BroadcastChannel(name) as unknown as Channel,
      storage: safeLocalStorage(),
    });
    guardRef.current = guard;
    guard.start();
    setState(guard.state as SpeakingTabState);
    return () => { guard.stop(); guardRef.current = null; };
  }, [attemptKey]);

  // Token fallback (no Web Locks): only canWrite() notices another tab took
  // the token, so ask it while this tab writes.
  useEffect(() => {
    const guard = guardRef.current;
    if (!guard || guard.mode !== 'token' || state !== 'writer') return undefined;
    const id = window.setInterval(() => { guard.canWrite(); }, 1000);
    return () => window.clearInterval(id);
  }, [state]);

  // Nothing records or sends until the lock answers (CR #2649): only the tab
  // that holds the right writes, or every tab when there is no lock to take.
  // `pending`, `acquiring` and `releasing` never do; the notice says the tab
  // is being checked, so the only tab does not look like a broken mic.
  const canWrite = state === 'writer' || state === 'unsupported';
  useEffect(() => { callApp('setWriteRight', canWrite); }, [canWrite]);
  useEffect(() => () => { callApp('setWriteRight', false); }, []);

  return {
    state,
    refused,
    takeover: () => guardRef.current?.requestTakeover(),
    reload: () => guardRef.current?.reload(),
  };
}

export function SpeakingTabNotice({ state, refused, strings, lang, onTakeover, onReload }: {
  state: SpeakingTabState;
  refused: boolean;
  strings: Strings;
  lang: 'vi' | 'en';
  onTakeover(): void;
  onReload(): void;
}) {
  let body = null;
  if (state === 'pending' || state === 'acquiring') {
    body = <Notice kind="info" lang={lang}>{strings.checkingTab}</Notice>;
  } else if (state === 'read-only') {
    body = <Notice kind="warning" lang={lang} action={<Button variant="secondary" size="sm" onClick={onTakeover}>{strings.useThisTab}</Button>}>{strings.otherTab}</Notice>;
  } else if (state === 'stuck') {
    body = <Notice kind="warning" lang={lang} action={<Button variant="secondary" size="sm" onClick={onReload}>{strings.reload}</Button>}>{strings.otherTabStuck}</Notice>;
  } else if (state === 'writer' && refused) {
    body = <Notice kind="info" lang={lang}>{strings.handoverRefused}</Notice>;
  }
  if (!body) return null;
  return <div className="av2-root" data-room-tab-notice={state} style={{ background: 'transparent', marginBottom: 12 }}>{body}</div>;
}
