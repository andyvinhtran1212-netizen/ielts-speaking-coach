'use client';

// ENROLL-0060 FR-060 / PUBLICSITE-0059 FR-022 (G05-T22) — "Báo cho tôi khi mở".
// Guest: an email field opens right under the row (no popup). Signed in: the
// button alone, then "Bỏ nhận" through the session. A guest never receives or
// stores an unsubscribe token; it only travels in the mail.
//
// State belongs to one viewer: everything resets when the account changes
// (sign-in, sign-out, A → B), and an answer that arrives for an earlier viewer
// or after unmount is dropped (abort signal, also safe under StrictMode).
// Signed in, "đã đăng ký" is only ever what GET /api/me/open-alerts said; when
// that read fails the UI says so and offers a retry instead of guessing.

import { useCallback, useLayoutEffect, useRef, useState, type FormEvent } from 'react';

import { Button, Notice, TextField } from '@/components/ui';
import { useAuth } from '@/lib/auth/auth-provider';
import { deleteBrowserJsonAt, getBrowserJson, postBrowserJsonAtWith } from '@/lib/browser-api';
import { OPEN_ALERT_COPY, normalizeEmail, openAlertErrorMessage, openAlertPath } from '@/lib/open-alert-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

const CONTRACT = '/api/courses/{slug}/open-alerts' as const;

type View = 'idle' | 'form' | 'subscribed';
/** Signed in only: has the server list been read for this viewer? */
type ListState = 'loading' | 'ready' | 'error';

async function transportReady(): Promise<void> {
  if (!await whenGlobalReady(() => !!window.api?.deleteWith, 'window.api')) {
    throw new Error('window.api unavailable');
  }
}

export function OpenAlertToggle({ slug }: { slug: string }) {
  const { status, user } = useAuth();
  const signedIn = status === 'signed-in';
  const viewerKey = signedIn ? `user:${user?.id ?? ''}` : status;

  const [view, setView] = useState<View>('idle');
  const [list, setList] = useState<ListState>('loading');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const viewerRequests = useRef<AbortController | null>(null);

  const readList = useCallback(async (signal: AbortSignal) => {
    await transportReady();
    if (signal.aborted) return;
    const data = await getBrowserJson('/api/me/open-alerts', undefined, signal, { noRedirect: true });
    if (signal.aborted) return;
    const slugs = Array.isArray(data?.slugs) ? data.slugs : null;
    if (!slugs) throw new Error('open-alerts list malformed');
    setView(slugs.includes(slug) ? 'subscribed' : 'idle');
    setList('ready');
  }, [slug]);

  const loadList = useCallback((signal: AbortSignal) => {
    setList('loading');
    readList(signal).catch(() => {
      if (!signal.aborted) setList('error');
    });
  }, [readList]);

  // Reset and cancel the previous viewer before the browser can paint their state.
  useLayoutEffect(() => {
    const requests = new AbortController();
    viewerRequests.current = requests;
    setView('idle');
    setEmail('');
    setBusy(false);
    setFieldError(undefined);
    setError(null);
    if (signedIn) loadList(requests.signal); else setList('ready');
    return () => { requests.abort(); };
  }, [viewerKey, signedIn, loadList]);

  function retryList() {
    const signal = viewerRequests.current?.signal;
    if (signal && !signal.aborted) loadList(signal);
  }

  async function run(action: (signal: AbortSignal) => Promise<void>) {
    const signal = viewerRequests.current?.signal;
    if (!signal || signal.aborted) return;
    setBusy(true);
    setError(null);
    setFieldError(undefined);
    try {
      await transportReady();
      if (!signal.aborted) await action(signal);
    } catch (caught) {
      if (signal.aborted) return;
      const { message, field } = openAlertErrorMessage(caught);
      if (field) setFieldError(message); else setError(message);
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }

  // After a signed-in change, re-read the list; a failed re-read shows the
  // "chưa đọc được" state rather than an assumed one.
  async function rereadAfterChange(signal: AbortSignal) {
    try {
      await readList(signal);
    } catch {
      if (!signal.aborted) setList('error');
    }
  }

  function subscribeSignedIn() {
    void run(async (signal) => {
      await postBrowserJsonAtWith(CONTRACT, openAlertPath(slug), {}, { noRedirect: true, signal });
      if (!signal.aborted) await rereadAfterChange(signal);
    });
  }

  function unsubscribeSignedIn() {
    void run(async (signal) => {
      await deleteBrowserJsonAt(CONTRACT, openAlertPath(slug), {}, { noRedirect: true, signal });
      if (!signal.aborted) await rereadAfterChange(signal);
    });
  }

  function submitGuest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const clean = normalizeEmail(email);
    if (!clean) {
      setFieldError(OPEN_ALERT_COPY.emailInvalid);
      return;
    }
    void run(async (signal) => {
      await postBrowserJsonAtWith(CONTRACT, openAlertPath(slug), { email: clean }, { noRedirect: true, signal });
      if (!signal.aborted) setView('subscribed');
    });
  }

  const errorNotice = error ? <Notice kind="error" live="alert">{error}</Notice> : null;
  if (signedIn && list === 'loading') {
    return (
      <div data-open-alert="loading">
        <Button variant="secondary" disabled>{OPEN_ALERT_COPY.subscribe}</Button>
        <p>{OPEN_ALERT_COPY.note}</p>
      </div>
    );
  }

  if (signedIn && list === 'error') {
    return (
      <div data-open-alert="list-error">
        <Notice
          kind="warning"
          live="alert"
          action={<Button variant="secondary" onClick={retryList}>{OPEN_ALERT_COPY.retry}</Button>}
        >
          {OPEN_ALERT_COPY.listUnavailable}
        </Notice>
        <p>{OPEN_ALERT_COPY.note}</p>
      </div>
    );
  }

  if (view === 'subscribed') {
    return (
      <div data-open-alert="subscribed">
        <p role="status">{OPEN_ALERT_COPY.subscribed}</p>
        {signedIn ? (
          <Button variant="text" onClick={unsubscribeSignedIn} disabled={busy}>{OPEN_ALERT_COPY.unsubscribe}</Button>
        ) : (
          <p>{OPEN_ALERT_COPY.guestMailNote}</p>
        )}
        {errorNotice}
      </div>
    );
  }

  if (view === 'form' && !signedIn) {
    return (
      <form data-open-alert="form" onSubmit={submitGuest} noValidate>
        <TextField
          label={OPEN_ALERT_COPY.emailLabel}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(value) => { setEmail(value); setFieldError(undefined); }}
          error={fieldError}
          hint={OPEN_ALERT_COPY.note}
          maxLength={254}
        />
        <Button type="submit" variant="secondary" loading={busy} loadingLabel={OPEN_ALERT_COPY.sending}>
          {OPEN_ALERT_COPY.subscribe}
        </Button>
        {errorNotice}
      </form>
    );
  }

  return (
    <div data-open-alert="idle">
      <Button
        variant="secondary"
        loading={busy}
        loadingLabel={OPEN_ALERT_COPY.sending}
        disabled={status === 'initial-loading'}
        onClick={signedIn ? subscribeSignedIn : () => setView('form')}
      >
        {OPEN_ALERT_COPY.subscribe}
      </Button>
      <p>{OPEN_ALERT_COPY.note}</p>
      {errorNotice}
    </div>
  );
}
