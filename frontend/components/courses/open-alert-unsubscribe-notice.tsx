'use client';

// ENROLL-0060 FR-060 (G05-T22) — the mail's unsubscribe link lands on
// /courses/<slug>#bo-nhan=<token>. Send exactly one DELETE with the token,
// clear the hash at once (a reload or a shared URL must not carry it), and
// show the result strip; a failure offers one retry button.

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button, Notice } from '@/components/ui';
import { OPEN_ALERT_COPY, isUnsubscribeHash, openAlertPath, parseUnsubscribeHash } from '@/lib/open-alert-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type State = 'none' | 'sending' | 'done' | 'failed' | 'broken';

export function OpenAlertUnsubscribeNotice({ slug }: { slug: string }) {
  const [state, setState] = useState<State>('none');
  const token = useRef<string | null>(null);
  const started = useRef(false);

  const send = useCallback(async () => {
    const value = token.current;
    if (!value) return;
    setState('sending');
    try {
      if (!await whenGlobalReady(() => !!window.api?.deleteWith, 'window.api')) throw new Error('window.api unavailable');
      await (window.api as AverApi).deleteWith(openAlertPath(slug), { unsubscribe_token: value }, undefined, { noRedirect: true });
      token.current = null;
      setState('done');
    } catch {
      setState('failed');
    }
  }, [slug]);

  useEffect(() => {
    if (started.current) return; // StrictMode re-runs effects: still one request
    started.current = true;
    const hash = window.location.hash;
    if (!isUnsubscribeHash(hash)) return;
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    const parsed = parseUnsubscribeHash(hash);
    if (!parsed) {
      // A mangled mail link (cut by the mail app, token missing): say so,
      // nothing to send, nothing to retry.
      setState('broken');
      return;
    }
    token.current = parsed;
    void send();
  }, [send]);

  if (state === 'done') {
    return <Notice kind="success" live="status">{OPEN_ALERT_COPY.unsubscribedNotice}</Notice>;
  }
  if (state === 'failed') {
    return (
      <Notice kind="error" live="alert" action={<Button variant="secondary" onClick={() => void send()}>{OPEN_ALERT_COPY.retry}</Button>}>
        {OPEN_ALERT_COPY.unsubscribeFailed}
      </Notice>
    );
  }
  if (state === 'broken') {
    return <Notice kind="warning" live="alert">{OPEN_ALERT_COPY.unsubscribeLinkBroken}</Notice>;
  }
  if (state === 'sending') return <p role="status">{OPEN_ALERT_COPY.sending}</p>;
  return null;
}
