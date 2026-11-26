// Staff shell data model (UIBASE-0056 FR-010, FR-018; KhungTrang2 §7–8).
// The shell draws what `nav` says: G09 supplies the eight admin groups and the
// instructor's five flat entries; /ui-library passes sample data. Nothing here
// knows a real admin route except the brand and "Xem như học viên" targets.
import { routeFor } from '@/lib/route-registry.mjs';

import type { IconName } from '../icon/icon-set';

export type StaffRole = 'admin' | 'instructor';
export type StaffEnvironment = 'production' | 'staging' | 'local';

export type StaffUser = { name: string; email: string; initials: string };

export type StaffNavItem = {
  label: string;
  href: string;
  /** Items waiting (the real queue count). 0, null or absent → no number. */
  count?: number | null;
  /** Icon of a flat entry in the icon-only rail; grouped entries use the group's. */
  icon?: IconName;
};

export type StaffNavGroup = {
  id: string;
  /**
   * Group heading ("Học viên và quyền truy cập"). Without one the items are
   * flat rows with no heading and no fold: the instructor's five entries.
   */
  label?: string;
  /** Icon of the group in the icon-only rail. */
  icon: IconName;
  items: readonly StaffNavItem[];
};

/** "Đổi vai trò" entries of the account menu; only roles the server profile grants. */
export type StaffRoleSwitch = { label: string; href: string };

export const ROLE_LABEL: Record<StaffRole, string> = { admin: 'Quản trị', instructor: 'Giáo viên' };

/** Where the brand goes: the area's first page. */
export const STAFF_HOME: Record<StaffRole, string> = { admin: '/admin', instructor: '/instructor' };

/** "Xem như học viên": the learner's first page. */
export const LEARNER_VIEW_HREF = '/home';

/**
 * Environment badge text. Production and the others differ in words and in
 * fill (solid vs dashed), never in colour alone (KhungTrang2 §7 rule).
 */
export const ENV_LABEL: Record<StaffEnvironment, string> = {
  production: 'Production · dữ liệu thật',
  staging: 'Staging · dữ liệu thử',
  local: 'Local · dữ liệu thử',
};

/** Same key as <aver-admin-chrome>, so a collapsed sidebar stays collapsed across both. */
export const SIDEBAR_COLLAPSED_KEY = 'av-admin-sidebar-collapsed';

/**
 * The badge for `window.__AVER_RUNTIME_CONFIG__.environment` (tooling/
 * runtime-origins.mjs: 'production' | 'staging' | null). Unknown or missing
 * reads as production unless the page is on this machine: a missing config
 * must never tell an admin that real data is test data.
 */
export function staffEnvironmentFrom(value: unknown, hostname = ''): StaffEnvironment {
  if (value === 'production') return 'production';
  if (value === 'staging') return 'staging';
  return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(hostname) ? 'local' : 'production';
}

/** Browser-side reading of the runtime config, for pages that build the shell's props. */
export function runtimeStaffEnvironment(): StaffEnvironment {
  if (typeof window === 'undefined') return 'production';
  const config = (window as { __AVER_RUNTIME_CONFIG__?: { environment?: unknown } }).__AVER_RUNTIME_CONFIG__;
  return staffEnvironmentFrom(config?.environment, window.location.hostname);
}

function normalize(path: string): string {
  const bare = path.split(/[?#]/)[0] || '/';
  return bare.length > 1 ? bare.replace(/\/+$/, '') : bare;
}

/**
 * The nav item for a pathname: the exact entry, else the nearest registry
 * parent that is an entry (/admin/classes/42 → Lớp), else the longest entry
 * that is a path prefix below the area root. Null when nothing matches.
 */
export function currentStaffHref(nav: readonly StaffNavGroup[], pathname: string): string | null {
  const hrefs = new Set(nav.flatMap((g) => g.items.map((i) => normalize(i.href))));
  const path = normalize(pathname);
  if (hrefs.has(path)) return path;

  const seen = new Set<string>();
  let entry = routeFor(path);
  while (entry?.parent && !seen.has(entry.parent)) {
    seen.add(entry.parent);
    if (hrefs.has(entry.parent)) return entry.parent;
    entry = routeFor(entry.parent);
  }

  let best: string | null = null;
  for (const href of hrefs) {
    const deep = href.split('/').filter(Boolean).length > 1;
    if (deep && path.startsWith(`${href}/`) && (!best || href.length > best.length)) best = href;
  }
  return best;
}

/** Sum of the items' counts: what a folded group and its rail icon show. */
export function groupCount(group: StaffNavGroup): number {
  return group.items.reduce((n, item) => n + (item.count && item.count > 0 ? item.count : 0), 0);
}

export function hasCurrent(group: StaffNavGroup, current: string | null): boolean {
  return current !== null && group.items.some((item) => normalize(item.href) === current);
}

export function isCurrent(item: StaffNavItem, current: string | null): boolean {
  return current !== null && normalize(item.href) === current;
}
