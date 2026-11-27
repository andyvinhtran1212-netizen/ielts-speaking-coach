// The five learner sections (UIBASE-0056 FR-007, KhungTrang §1): fixed order,
// never a sixth. `id` is the `section` of lib/route-registry.mjs; the current
// one is derived from the pathname, never passed by a page.
import { routeFor } from '@/lib/route-registry.mjs';

import type { IconName } from '../icon/icon-set';

export type LearnerSectionId = 'home' | 'course' | 'practice' | 'tests' | 'library';

/**
 * Registry Q53: the shell renders only links to `live` routes, so it can sit on
 * a live page (/library) before G07 builds the learner hubs. Each link names
 * its planned route and the live page that stands in for it today (`today`,
 * null = hide the link). A planned route wins as soon as the registry marks it
 * `live`, with no change here.
 */
type PlannedLink = { href: string; today: string | null };

export function isLiveRoute(href: string): boolean {
  return routeFor(href)?.status === 'live';
}

/** The href to render: the planned route once live, else today's stand-in, else null (hidden). */
export function liveHref({ href, today }: PlannedLink): string | null {
  if (isLiveRoute(href)) return href;
  return today && isLiveRoute(today) ? today : null;
}

function resolve<T extends PlannedLink>(links: readonly T[]): (Omit<T, 'today'> & { href: string })[] {
  return links.flatMap(({ today, ...link }) => {
    const href = liveHref({ href: link.href, today });
    return href ? [{ ...link, href }] : [];
  });
}

const NAV_PLAN: readonly (PlannedLink & { id: LearnerSectionId; label: string; icon: IconName })[] = [
  { id: 'home', label: 'Hôm nay', href: '/home', today: null, icon: 'home' },
  { id: 'course', label: 'Lộ trình', href: '/course', today: null, icon: 'route' },
  { id: 'practice', label: 'Luyện tập', href: '/practice', today: '/speaking', icon: 'pencil' },
  { id: 'tests', label: 'Thi thử', href: '/tests', today: '/full-test', icon: 'timer' },
  { id: 'library', label: 'Thư viện', href: '/library', today: null, icon: 'books' },
];

/**
 * The five sections, fixed order, never a sixth. A section always has a live
 * page today; the guard test fails if one would be hidden.
 */
export const LEARNER_NAV = Object.freeze(resolve(NAV_PLAN));

/** Account menu, fixed order (FR-008). "Đổi vai trò" and "Đăng xuất" are added by the menu. */
export const ACCOUNT_LINKS = Object.freeze(resolve([
  { label: 'Tiến độ', href: '/progress', today: null },
  { label: 'Khoá học và lượt AI', href: '/account', today: null },
  { label: 'Hồ sơ', href: '/profile', today: null },
  { label: 'Trợ giúp', href: '/help', today: null },
]));

export const ADMIN_SWITCH = Object.freeze({ label: 'Đổi vai trò: sang Quản trị', href: '/admin' });
/** LEARNERNAV-0062 FR-003 (T03s): instructors and admins. */
export const INSTRUCTOR_SWITCH = Object.freeze({ label: 'Đổi vai trò: sang Giáo viên', href: '/instructor' });

export const COMPACT_FOOTER_LINKS = Object.freeze(resolve([
  { label: 'Trợ giúp', href: '/help', today: null },
  { label: 'Điều khoản', href: '/terms', today: null },
  { label: 'Quyền riêng tư', href: '/privacy', today: null },
]));
