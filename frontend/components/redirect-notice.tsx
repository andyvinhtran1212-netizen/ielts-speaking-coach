'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { redirectNoticeMessage, takeRedirectNotice } from '@/lib/redirect-notice-model.mjs';

// G02-T11 (FR-02-010): the one-line strip a parent page shows after a page
// without its required parameter sent the visitor here with `?notice=`.
//
// The strip lives in a shared layout, and Next keeps a layout mounted across
// client-side navigation, so it re-reads the address on every pathname or
// search change (Codex on #2365): a soft redirect into this layout still shows
// the line, and moving on to another page hides it. `useSearchParams` sits
// inside <Suspense> because the app runs `cacheComponents`. The parameter is
// dropped from the address bar straight away, so a reload or a copied link
// does not repeat it.
const CHROME_SELECTOR = 'aver-chrome, aver-admin-chrome';

// The key leaves the URL on first read, so a remount (Strict Mode replay, an
// auth provider re-keying its subtree) would otherwise lose the line. Keep it
// for the page it was shown on until the learner closes it or moves on.
let pending: { path: string; text: string } | null = null;

export function RedirectNotice() {
  return (
    <Suspense fallback={null}>
      <RedirectNoticeLine />
    </Suspense>
  );
}

function RedirectNoticeLine() {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? '';
  const [message, setMessage] = useState<string | null>(null);
  const [top, setTop] = useState(0);

  useEffect(() => {
    const path = window.location.pathname;
    const taken = takeRedirectNotice(window.location.search);
    if (taken.key !== null) {
      try {
        window.history.replaceState(window.history.state, '', `${path}${taken.search}${window.location.hash}`);
      } catch { /* the notice still shows; only the URL keeps the parameter */ }
      const text = redirectNoticeMessage(taken.key, path);
      pending = text ? { path, text } : null;
    }
    if (!pending || pending.path !== path) {
      pending = null;
      setMessage(null);
      return;
    }
    const chrome = document.querySelector(CHROME_SELECTOR);
    setTop(chrome ? Math.max(0, Math.round(chrome.getBoundingClientRect().bottom)) : 0);
    setMessage(pending.text);
  }, [pathname, search]);

  const close = () => {
    pending = null;
    setMessage(null);
  };

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
          onClick={close}
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
