'use client';

import { useEffect, useState } from 'react';

import { redirectNoticeMessage, takeRedirectNotice } from '@/lib/redirect-notice-model.mjs';

// G02-T11 (FR-02-010): the one-line strip a parent page shows after a page
// without its required parameter sent the visitor here with `?notice=`.
//
// Reads `window.location` in an effect rather than `useSearchParams`: the app
// runs `cacheComponents`, and `useSearchParams` outside <Suspense> fails the
// build for every layout this is mounted in. The parameter is dropped from the
// address bar straight away, so a reload or a copied link does not repeat it.
const CHROME_SELECTOR = 'aver-chrome, aver-admin-chrome';

export function RedirectNotice() {
  const [message, setMessage] = useState<string | null>(null);
  const [top, setTop] = useState(0);

  useEffect(() => {
    const { key, search } = takeRedirectNotice(window.location.search);
    if (key === null) return;
    try {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`);
    } catch { /* the notice still shows; only the URL keeps the parameter */ }
    const text = redirectNoticeMessage(key, window.location.pathname);
    if (!text) return;
    const chrome = document.querySelector(CHROME_SELECTOR);
    setTop(chrome ? Math.max(0, Math.round(chrome.getBoundingClientRect().bottom)) : 0);
    setMessage(text);
  }, []);

  if (!message) return null;
  return (
    <div
      className="av-redirect-notice"
      role="status"
      style={{
        position: 'fixed',
        top,
        left: 0,
        right: 0,
        zIndex: 'var(--av-z-toast)',
        display: 'flex',
        justifyContent: 'center',
        padding: '0 var(--av-space-4)',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--av-space-3)',
          maxWidth: '720px',
          width: '100%',
          marginTop: 'var(--av-space-2)',
          padding: 'var(--av-space-2) var(--av-space-3)',
          borderRadius: 'var(--av-radius-md)',
          border: '1px solid var(--av-info)',
          // `--av-info-soft` is translucent: lay it over the opaque card surface
          // so the page underneath never shows through the line.
          backgroundColor: 'var(--av-surface-card)',
          backgroundImage: 'linear-gradient(var(--av-info-soft), var(--av-info-soft))',
          color: 'var(--av-text-primary)',
          boxShadow: 'var(--av-shadow-md)',
          fontSize: 'var(--av-fs-sm)',
          pointerEvents: 'auto',
        }}
      >
        <span style={{ flex: 1 }}>{message}</span>
        <button
          type="button"
          onClick={() => setMessage(null)}
          style={{
            border: 0,
            background: 'transparent',
            color: 'var(--av-text-secondary)',
            font: 'inherit',
            fontWeight: 600,
            cursor: 'pointer',
            padding: 'var(--av-space-1) var(--av-space-2)',
          }}
        >
          Đóng
        </button>
      </div>
    </div>
  );
}
