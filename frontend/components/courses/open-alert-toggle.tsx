'use client';

// ENROLL-0060 FR-060 / PUBLICSITE-0059 FR-022 (G05-T22) — "Báo cho tôi khi mở".
// Guest: an email field opens right under the row (no popup). Signed in: the
// button alone, then "Bỏ nhận" through the session. A guest never receives or
// stores an unsubscribe token; it only travels in the mail.

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { Button, Notice, TextField } from '@/components/ui';
import { useAuth } from '@/lib/auth/auth-provider';
import { OPEN_ALERT_COPY, normalizeEmail, openAlertErrorMessage, openAlertPath } from '@/lib/open-alert-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type View = 'idle' | 'form' | 'subscribed';

async function transport(): Promise<AverApi> {
  if (!await whenGlobalReady(() => !!window.api?.deleteWith, 'window.api')) {
    throw new Error('window.api unavailable');
  }
  return window.api as AverApi;
}

export function OpenAlertToggle({ slug }: { slug: string }) {
  const { status } = useAuth();
  const signedIn = status === 'signed-in';
  const [view, setView] = useState<View>('idle');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // Signed in: the server list is the truth for "đã đăng ký" (re-read after
  // every change). A failed read keeps the button: subscribing is idempotent.
  const refresh = useCallback(async () => {
    const api = await transport();
    const data = await api.getWith<{ slugs?: unknown }>('/api/me/open-alerts', undefined, { noRedirect: true });
    const slugs = Array.isArray(data?.slugs) ? data.slugs : [];
    if (alive.current) setView(slugs.includes(slug) ? 'subscribed' : 'idle');
  }, [slug]);

  useEffect(() => {
    if (!signedIn) return;
    refresh().catch(() => {});
  }, [signedIn, refresh]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setFieldError(undefined);
    try {
      await action();
    } catch (caught) {
      if (!alive.current) return;
      const { message, field } = openAlertErrorMessage(caught);
      if (field) setFieldError(message); else setError(message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  function subscribeSignedIn() {
    void run(async () => {
      const api = await transport();
      await api.postWith(openAlertPath(slug), {}, undefined, { noRedirect: true });
      await refresh().catch(() => { if (alive.current) setView('subscribed'); });
    });
  }

  function unsubscribeSignedIn() {
    void run(async () => {
      const api = await transport();
      await api.deleteWith(openAlertPath(slug), {}, undefined, { noRedirect: true });
      await refresh().catch(() => { if (alive.current) setView('idle'); });
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
    void run(async () => {
      const api = await transport();
      await api.postWith(openAlertPath(slug), { email: clean }, undefined, { noRedirect: true });
      if (alive.current) setView('subscribed');
    });
  }

  const errorNotice = error ? <Notice kind="error" live="alert">{error}</Notice> : null;

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
