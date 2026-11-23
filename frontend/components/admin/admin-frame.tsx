'use client';

// New admin frame (ADMINIA-0074 FR-001…FR-014; plan 5.1, 5.2; G09-T08).
// AuthedShell wraps every chrome="admin" route in it when the server env
// ADMIN_FRAME_V2=1 and adds `av-admin-frame-v2` to <body>; <aver-admin-chrome>
// then renders only its slot, so the 75 admin page.tsx stay as they are.
// Flag off → none of this renders and the old frame is unchanged.
//
// The frame is the G03 StaffShell. Only its chrome (top bar, sidebar, drawer)
// is in the v2 tree (`scope="shell"`); the page content stays in the legacy
// v1 cascade, because `.av2-root` element rules would beat the old pages'
// single-class rules.

import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import '@/styles/av2/tokens.css';
import '@/styles/av2/base.css';
import { StaffShell } from '@/components/ui/shell/staff-shell';
import { runtimeStaffEnvironment, type StaffEnvironment } from '@/components/ui/shell/staff-nav';
import {
  ADMIN_SWITCH_TO,
  HIDDEN_IMPORT_COPY,
  adminCurrentHref,
  adminStaffNav,
  attentionCounts,
  hiddenImportBack,
  hiddenImportEvent,
  hiddenImportKey,
  hiddenImportPattern,
  initialsOf,
  isEmbedSearch,
} from '@/lib/admin-frame-model.mjs';
import { useAuth } from '@/lib/auth/auth-provider';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

import styles from './admin-frame.module.css';

type Counts = Record<string, number | null>;

/** Sidebar numbers from GET /admin/attention (plan 5.4). On failure: no numbers, logged. */
function useAttentionCounts(enabled: boolean): Counts {
  const [counts, setCounts] = useState<Counts>({});
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    (async () => {
      try {
        if (!await whenGlobalReady(() => !!window.api?.getWith, 'Admin API')) return;
        const body = await window.api.getWith<unknown>('/admin/attention');
        if (live) setCounts(attentionCounts(body));
      } catch (caught) {
        console.warn('[admin-frame] attention counts unavailable', caught);
        if (live) setCounts({});
      }
    })();
    return () => { live = false; };
  }, [enabled]);
  return counts;
}

function readOpened(key: string) {
  try { return window.sessionStorage.getItem(key) === '1'; } catch { return false; }
}

/**
 * FR-013: on the four manual import pages the content is hidden behind a
 * strip until "Vẫn mở" (remembered for this tab, logged). The import APIs are
 * not blocked.
 */
export function HiddenImportBanner({ pattern, children }: { pattern: string; children: ReactNode }) {
  const key = hiddenImportKey(pattern);
  const [opened, setOpened] = useState(false);
  useEffect(() => { setOpened(readOpened(key)); }, [key]);

  const open = useCallback(() => {
    try { window.sessionStorage.setItem(key, '1'); } catch { /* lasts until reload */ }
    setOpened(true);
    try {
      void window.api?.post?.('/api/analytics/events', hiddenImportEvent(pattern))?.catch?.(() => undefined);
    } catch { /* telemetry never blocks the page */ }
  }, [key, pattern]);

  return (
    <>
      <div className={styles.hiddenImport} role="status" data-hidden-import={pattern}>
        <p><strong>{HIDDEN_IMPORT_COPY.title}</strong> {HIDDEN_IMPORT_COPY.body}</p>
        {opened ? null : (
          <div className={styles.hiddenImportActions}>
            <a href={hiddenImportBack(pattern)}>{HIDDEN_IMPORT_COPY.back}</a>
            <button type="button" onClick={open}>{HIDDEN_IMPORT_COPY.open}</button>
          </div>
        )}
      </div>
      {opened ? children : null}
    </>
  );
}

export function AdminFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '';
  const search = useSearchParams()?.toString() ?? '';
  const { status, user } = useAuth();
  const embed = isEmbedSearch(search);
  const counts = useAttentionCounts(!embed && status === 'signed-in');
  const [environment, setEnvironment] = useState<StaffEnvironment>('production');
  useEffect(() => { setEnvironment(runtimeStaffEnvironment()); }, []);

  const nav = useMemo(() => adminStaffNav(counts), [counts]);
  const current = adminCurrentHref(pathname, search);
  const hidden = hiddenImportPattern(pathname);
  const content = hidden ? <HiddenImportBanner pattern={hidden}>{children}</HiddenImportBanner> : children;

  if (embed) return <>{children}</>;

  const email = user?.email ?? '';
  return (
    <StaffShell
      role="admin"
      scope="shell"
      nav={nav}
      current={current}
      environment={environment}
      user={{ name: email, email, initials: initialsOf(email) }}
      switchTo={ADMIN_SWITCH_TO}
    >
      <div className={styles.content}>{content}</div>
    </StaffShell>
  );
}
