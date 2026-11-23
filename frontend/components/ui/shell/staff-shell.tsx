'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';

import {
  SIDEBAR_COLLAPSED_KEY, currentStaffHref,
  type StaffEnvironment, type StaffNavGroup, type StaffRole, type StaffRoleSwitch, type StaffUser,
} from './staff-nav';
import type { StaffSearchFn } from './staff-quick-search';
import { StaffDrawer, StaffSidebar } from './staff-sidebar';
import { StaffTopBar, type StaffPanel } from './staff-top-bar';
import styles from './staff-shell.module.css';

export type { StaffEnvironment, StaffNavGroup, StaffNavItem, StaffRole, StaffRoleSwitch, StaffUser } from './staff-nav';
export type { StaffSearchFn, StaffSearchGroup, StaffSearchItem } from './staff-quick-search';

export type StaffShellProps = {
  /** Role label "Quản trị" / "Giáo viên" and the brand target. */
  role: StaffRole;
  /**
   * The sidebar, supplied by G09: eight groups for admins, one group without
   * a label (five flat entries) for instructors. Every href must be a live
   * route; an entry whose page is not open yet has `available: false` (and
   * may have `href: null`): it shows dimmed with "Chưa mở", never as a link.
   */
  nav: readonly StaffNavGroup[];
  /** From `runtimeStaffEnvironment()`; never hidden. */
  environment: StaffEnvironment;
  user: StaffUser;
  /** Role entries of the account menu ("Sang khu giáo viên"), printed as given; only roles the server profile grants. */
  switchTo?: readonly StaffRoleSwitch[];
  /** Built-in quick search field (data from G09); without it there is no field. */
  search?: StaffSearchFn;
  /**
   * Replaces the built-in field with the page's own quick-search trigger, e.g.
   * G09-T19's `QuickSearchButton` when AuthedShell already mounts its ⌘K
   * dialog (#2466). Wins over `search`; never pass both a dialog and `search`,
   * or ⌘K would open two searches.
   */
  searchSlot?: ReactNode;
  /**
   * The current entry's href when the page knows it better than the
   * pathname (G09's registry: /admin/speaking/sessions belongs to Báo cáo ›
   * Hoạt động). Absent: matched from the pathname. Unlike `demo`, the page
   * still gets <main> and localStorage.
   */
  current?: string | null;
  /**
   * /ui-library and tests only: the current entry instead of the pathname's,
   * the content in a <div> (the library page has its own <main>), and the
   * collapsed state kept in memory, not in localStorage.
   */
  demo?: { current: string | null; collapsed?: boolean };
  children: ReactNode;
};

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function readCollapsed() {
  try { return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'; } catch { return false; }
}

function writeCollapsed(collapsed: boolean) {
  try {
    if (collapsed) window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, '1');
    else window.localStorage.removeItem(SIDEBAR_COLLAPSED_KEY);
  } catch { /* private mode: the choice lasts until reload */ }
}

/**
 * Page frame of admin and instructor pages (UIBASE-0056 FR-010, FR-018,
 * plan 5.5, KhungTrang2 §7–8): top bar, sidebar (icon rail below 1200px or
 * when collapsed; the collapse is remembered under the same key as
 * <aver-admin-chrome>), phone drawer below 768px. No footer. At most one of
 * quick search, account menu and drawer is open. The content area never
 * scrolls the page sideways; wide tables scroll inside their own frame.
 */
export function StaffShell({
  role, nav, environment, user, switchTo = [], search, searchSlot, current: currentProp, demo, children,
}: StaffShellProps) {
  const pathname = usePathname() ?? '';
  const current = demo ? demo.current : currentProp !== undefined ? currentProp : currentStaffHref(nav, pathname);
  const [collapsed, setCollapsed] = useState(demo?.collapsed ?? false);
  const [panel, setPanelState] = useState<StaffPanel | null>(null);
  const setPanel = useCallback((next: StaffPanel | null) => setPanelState(next), []);

  // Before paint, so a collapsed sidebar does not flash open.
  useIsoLayoutEffect(() => { if (!demo) setCollapsed(readCollapsed()); }, []);

  const onCollapsedChange = (next: boolean) => {
    setCollapsed(next);
    if (!demo) writeCollapsed(next);
  };

  return (
    <div className={styles.shell} data-demo={demo ? '' : undefined}>
      {demo ? null : <a href="#main-content" className={styles.skip}>Bỏ qua tới nội dung</a>}
      <StaffTopBar
        role={role}
        environment={environment}
        user={user}
        switchTo={switchTo}
        search={searchSlot ? undefined : search}
        searchSlot={searchSlot}
        panel={panel}
        setPanel={setPanel}
      />
      <div className={styles.body}>
        <StaffSidebar role={role} nav={nav} current={current} collapsed={collapsed} onCollapsedChange={onCollapsedChange} persist={!demo} />
        {demo
          ? <div className={styles.main}>{children}</div>
          : <main id="main-content" tabIndex={-1} className={styles.main}>{children}</main>}
      </div>
      <StaffDrawer role={role} nav={nav} current={current} open={panel === 'drawer'} onClose={() => setPanel(null)} persist={!demo} />
    </div>
  );
}
