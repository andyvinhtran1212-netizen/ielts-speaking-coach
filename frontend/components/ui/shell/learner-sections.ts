// The five learner sections (UIBASE-0056 FR-007, KhungTrang §1): fixed order,
// never a sixth. `id` is the `section` of lib/route-registry.mjs; the current
// one is derived from the pathname, never passed by a page.
import type { IconName } from '../icon/icon-set';

export type LearnerSectionId = 'home' | 'course' | 'practice' | 'tests' | 'library';

export const LEARNER_NAV: readonly { id: LearnerSectionId; label: string; href: string; icon: IconName }[] = Object.freeze([
  { id: 'home', label: 'Hôm nay', href: '/home', icon: 'home' },
  { id: 'course', label: 'Lộ trình', href: '/course', icon: 'route' },
  { id: 'practice', label: 'Luyện tập', href: '/practice', icon: 'pencil' },
  { id: 'tests', label: 'Thi thử', href: '/tests', icon: 'timer' },
  { id: 'library', label: 'Thư viện', href: '/library', icon: 'books' },
]);

/** Account menu, fixed order (FR-008). "Đổi vai trò" and "Đăng xuất" are added by the menu. */
export const ACCOUNT_LINKS = Object.freeze([
  { label: 'Tiến độ', href: '/progress' },
  { label: 'Khoá học và lượt AI', href: '/account' },
  { label: 'Hồ sơ', href: '/profile' },
  { label: 'Trợ giúp', href: '/help' },
] as const);

export const ADMIN_SWITCH = Object.freeze({ label: 'Đổi vai trò: sang Quản trị', href: '/admin' });

export const COMPACT_FOOTER_LINKS = Object.freeze([
  { label: 'Trợ giúp', href: '/help' },
  { label: 'Điều khoản', href: '/terms' },
  { label: 'Quyền riêng tư', href: '/privacy' },
] as const);
