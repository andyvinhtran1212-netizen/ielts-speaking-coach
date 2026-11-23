'use client';

// ENROLL-0060 FR-060 (G05-T22) — the mail's unsubscribe link lands on
// /courses/<slug>#bo-nhan=<token>. Send exactly one DELETE with the token,
// clear the hash at once (a reload or a shared URL must not carry it), and
// show the result strip; a failure offers one retry button.

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button, Notice } from '@/components/ui';
import { OPEN_ALERT_COPY, openAlertPath, parseUnsubscribeHash } from '@/lib/open-alert-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type State = 'none' | 'sending' | 'done' | 'failed';

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
    const parsed = parseUnsubscribeHash(window.location.hash);
    if (window.location.hash.startsWith('#bo-nhan=')) {
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    }
    if (!parsed) return;
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
  if (state === 'sending') return <p role="status">{OPEN_ALERT_COPY.sending}</p>;
  return null;
}
