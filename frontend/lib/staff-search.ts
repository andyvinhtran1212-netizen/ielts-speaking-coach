import 'client-only';

import { postBrowserJsonAt } from '@/lib/browser-api';

/**
 * The one data adapter for staff quick search (ADMINIA-0074 FR-075, FR-102;
 * G09-T05/T19). Both presentations use it: the modal dialog on today's
 * admin/teacher pages (`components/staff-quick-search.tsx`) and the top-bar
 * field of the v2 StaffShell (G03-T16, `search` prop of `StaffTopBar`).
 *
 * The query goes in the POST body, never in a URL (#2453). Groups come back in
 * the fixed order with Vietnamese headings, at most three rows each, empty
 * groups dropped, and only same-origin hrefs kept. `failed` names the groups
 * the server could not read (`sources_failed`), so no caller can show an
 * unreadable group as an empty one.
 */
export type StaffSearchDoor = 'admin' | 'instructor';
export type StaffSearchItem = { title: string; meta?: string; href: string };
export type StaffSearchGroup = { group: string; items: readonly StaffSearchItem[] };
export type StaffSearchResult = { groups: readonly StaffSearchGroup[]; failed: readonly string[] };

export const STAFF_SEARCH_MIN_QUERY = 2;
export const STAFF_SEARCH_DEBOUNCE_MS = 250;
const ROWS_PER_GROUP = 3;

type Hit = { title: string; meta?: string | null; href: string };
type GroupId = 'learners' | 'classes' | 'submissions' | 'content' | 'orders';
type Raw = Partial<Record<GroupId, Hit[]>> & { sources_failed?: string[] };

const GROUPS: readonly { id: GroupId; label: string; doors: readonly StaffSearchDoor[] }[] = [
  { id: 'learners', label: 'Học viên', doors: ['admin', 'instructor'] },
  { id: 'classes', label: 'Lớp', doors: ['admin', 'instructor'] },
  { id: 'submissions', label: 'Bài nộp', doors: ['admin', 'instructor'] },
  { id: 'content', label: 'Đề', doors: ['admin'] },
  { id: 'orders', label: 'Đơn đăng ký', doors: ['admin'] },
];

/** Only a same-origin path may be opened; anything else is dropped. */
export function safeStaffHref(href: unknown): string | null {
  return typeof href === 'string' && href.startsWith('/') && !href.startsWith('//') ? href : null;
}

export function shapeStaffSearch(door: StaffSearchDoor, raw: Raw): StaffSearchResult {
  const mine = GROUPS.filter((g) => g.doors.includes(door));
  const groups = mine
    .map((g) => ({
      group: g.label,
      items: (raw[g.id] ?? [])
        .flatMap((hit): StaffSearchItem[] => {
          const href = safeStaffHref(hit.href);
          return href ? [{ title: hit.title, meta: hit.meta ?? undefined, href }] : [];
        })
        .slice(0, ROWS_PER_GROUP),
    }))
    .filter((g) => g.items.length > 0);
  const failed = mine.filter((g) => raw.sources_failed?.includes(g.id)).map((g) => g.label);
  return { groups, failed };
}

/** Rejects with the transport error (`.status` set) on any non-2xx answer. */
export async function searchStaff(door: StaffSearchDoor, q: string): Promise<StaffSearchResult> {
  const raw = door === 'admin'
    ? await postBrowserJsonAt('/admin/search', '/admin/search', { q })
    : await postBrowserJsonAt('/instructor/search', '/instructor/search', { q });
  return shapeStaffSearch(door, raw as Raw);
}
