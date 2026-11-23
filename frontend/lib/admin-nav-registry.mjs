// Admin navigation registry (ADMINIA-0074 FR-005, FR-007, FR-008, FR-012,
// FR-013; plan 5.1 "Sidebar chuẩn" and 5.2; G09-T08). Plain ES module, no
// React: the new admin frame, its tests and tooling read it.
//
// * ADMIN_NAV_GROUPS — the eight sidebar groups, items in the order of plan
//   5.1. `href` is null while the item's page does not exist; such an item
//   has `available: false` (drawn dimmed, "Chưa mở", not a link). No item is
//   an import / upload page, there is no "Giáo viên duyệt" and no "Chấm bài
//   › Thi thử".
// * ADMIN_ROUTES — every admin page of plan 5.1 (all 75 `page.tsx`) plus the
//   new routes of the package: `pattern`, `kind` (nav | tab | context |
//   hidden | redirect), `group`, `item`, `redirectTo?`. The redirects are
//   done by later tasks; until then the old page still opens and is matched
//   to its item.
// * adminNavMatch(pathname, search) → { groupId, itemId } | null.
// * INSTRUCTOR_NAV_ITEMS — the teacher frame's five flat entries.
// * HIDDEN_IMPORT_ROUTES — the four manual import pages (FR-013).

/** @typedef {'nav' | 'tab' | 'context' | 'hidden' | 'redirect'} AdminRouteKind */
/**
 * @typedef {{ id: string, label: string, href: string | null, available: boolean,
 *             countKey?: string, plannedHref?: string }} AdminNavItem
 * @typedef {{ id: string, label: string, icon: import('../components/ui/icon/icon-set').IconName, items: AdminNavItem[] }} AdminNavGroup
 * @typedef {{ pattern: string, kind: AdminRouteKind, group: string | null, item: string | null,
 *             redirectTo?: string }} AdminRoute
 */

const item = (id, label, href, extra = {}) => ({ id, label, href, available: href !== null, ...extra });
const soon = (id, label, extra = {}) => ({ ...item(id, label, null, extra), available: false });

/** @type {readonly AdminNavGroup[]} */
export const ADMIN_NAV_GROUPS = Object.freeze([
  { id: 'overview', label: 'Tổng quan', icon: 'home', items: [item('todo', 'Việc cần làm', '/admin')] },
  {
    id: 'learners', label: 'Học viên và quyền truy cập', icon: 'users', items: [
      soon('learners', 'Học viên', { plannedHref: '/admin/learners' }),
      item('classes', 'Lớp', '/admin/classes'),
      item('instructors', 'Giáo viên', '/admin/instructors'),
      soon('activation-codes', 'Mã kích hoạt', { plannedHref: '/admin/activation-codes' }),
      soon('notifications', 'Gửi thông báo', { plannedHref: '/admin/notifications' }),
      { ...item('surveys', 'Khảo sát và nhận xét', '/admin/surveys'), available: false }, // GOI-13 part A builds it
    ],
  },
  {
    id: 'courses', label: 'Khoá học và đăng ký', icon: 'credit-card', items: [
      soon('courses', 'Khoá học', { plannedHref: '/admin/courses' }),
      soon('enrollments', 'Đơn đăng ký', { plannedHref: '/admin/enrollments', countKey: 'enrollments_reported' }),
      item('credits', 'Lượt AI', '/admin/credits'),
    ],
  },
  {
    id: 'grading', label: 'Chấm bài', icon: 'clipboard', items: [
      item('writing-queue', 'Writing', '/admin/writing/queue', { countKey: 'writing_review' }),
      soon('speaking-grading', 'Speaking', { plannedHref: '/admin/speaking/grading', countKey: 'speaking_mock_pending' }),
      item('regrade', 'Yêu cầu chấm lại', '/admin/writing/regrade-requests', { countKey: 'regrade_new' }),
    ],
  },
  {
    id: 'content', label: 'Nội dung', icon: 'book', items: [
      item('listening', 'Listening', '/admin/listening'),
      item('reading', 'Reading', '/admin/reading'),
      item('writing', 'Writing', '/admin/writing'),
      item('speaking', 'Speaking', '/admin/speaking'),
      item('vocab', 'Từ vựng', '/admin/vocab'),
      item('grammar', 'Ngữ pháp', '/admin/grammar'),
      soon('library', 'Thư viện công khai', { plannedHref: '/admin/library' }),
    ],
  },
  { id: 'mock', label: 'Thi thử', icon: 'timer', items: [item('mock-tests', 'Kỳ thi', '/admin/mock-tests')] },
  {
    id: 'reports', label: 'Báo cáo', icon: 'chart', items: [
      soon('activity', 'Hoạt động học viên', { plannedHref: '/admin/reports?tab=hoat-dong' }),
      soon('traffic', 'Lưu lượng', { plannedHref: '/admin/reports?tab=luu-luong' }),
      soon('ai-cost', 'Chi phí AI', { plannedHref: '/admin/reports?tab=chi-phi-ai' }),
      soon('quality', 'Chất lượng nội dung', { plannedHref: '/admin/reports?tab=chat-luong' }),
    ],
  },
  {
    id: 'system', label: 'Hệ thống', icon: 'settings', items: [
      soon('incidents', 'Hộp thư sự cố', { plannedHref: '/admin/incidents', countKey: 'incident_groups_open' }),
      soon('ai-models', 'AI và mô hình', { plannedHref: '/admin/ai-models' }),
      item('mfa', 'Bảo mật', '/admin/mfa'),
      soon('qa-tools', 'Công cụ QA', { plannedHref: '/admin/qa-tools' }),
      soon('settings', 'Cài đặt', { plannedHref: '/admin/settings' }),
    ],
  },
]);

const r = (pattern, kind, group, itemId, redirectTo) => (
  redirectTo ? { pattern, kind, group, item: itemId, redirectTo } : { pattern, kind, group, item: itemId });

/** @type {readonly AdminRoute[]} Plan 5.1 rows 1–75, then the package's new routes. */
export const ADMIN_ROUTES = Object.freeze([
  r('/admin', 'nav', 'overview', 'todo'),
  r('/admin/dashboard/reading-attempts', 'context', 'reports', 'activity'),
  r('/admin/users', 'redirect', 'learners', 'learners', '/admin/learners'),
  r('/admin/students', 'redirect', 'learners', 'learners', '/admin/learners'),
  r('/admin/classes', 'nav', 'learners', 'classes'),
  r('/admin/classes/[cohortId]', 'context', 'learners', 'classes'),
  r('/admin/classes/[cohortId]/exercise-book', 'context', 'learners', 'classes'),
  r('/admin/classes/[cohortId]/exercise-book/grants', 'context', 'learners', 'classes'),
  r('/admin/instructors', 'nav', 'learners', 'instructors'),
  r('/admin/usage', 'context', 'reports', 'ai-cost'),
  r('/admin/writing/cohorts', 'redirect', 'learners', 'classes', '/admin/classes'),
  r('/admin/grammar-lessons', 'context', 'learners', 'classes'),
  r('/admin/grammar-diagnostic', 'context', 'learners', 'classes'),
  r('/admin/writing/queue', 'nav', 'grading', 'writing-queue'),
  r('/admin/writing/grade', 'context', 'grading', 'writing-queue'),
  r('/admin/writing/status', 'redirect', 'grading', 'writing-queue', '/admin/writing/grade?panel=status'),
  r('/admin/writing/instructor-queue', 'redirect', 'grading', 'writing-queue', '/admin/writing/queue'),
  r('/admin/writing/regrade-requests', 'nav', 'grading', 'regrade'),
  r('/admin/writing/new', 'context', 'grading', 'writing-queue'),
  r('/admin/speaking/sessions', 'context', 'reports', 'activity'),
  r('/admin/mock-reviews', 'redirect', 'mock', 'mock-tests', '/admin/mock-tests'),
  r('/admin/mock-reviews/report', 'context', 'mock', 'mock-tests'),
  r('/admin/speaking', 'nav', 'content', 'speaking'),
  r('/admin/speaking/topics', 'tab', 'content', 'speaking', '/admin/speaking?tab=items'),
  r('/admin/writing', 'nav', 'content', 'writing'),
  r('/admin/writing/prompts', 'tab', 'content', 'writing', '/admin/writing?tab=items'),
  r('/admin/writing/tips', 'tab', 'content', 'writing', '/admin/writing?tab=items&type=tips'),
  r('/admin/writing/assignments', 'redirect', 'learners', 'classes', '/admin/classes'),
  r('/admin/listening', 'nav', 'content', 'listening'),
  r('/admin/listening/tests', 'tab', 'content', 'listening', '/admin/listening?tab=items&type=tests'),
  r('/admin/listening/tests/[testId]', 'context', 'content', 'listening'),
  r('/admin/listening/content/[contentId]', 'context', 'content', 'listening'),
  r('/admin/listening/content/[contentId]/edit', 'context', 'content', 'listening'),
  r('/admin/listening/segments', 'context', 'content', 'listening'),
  r('/admin/listening/gist', 'context', 'content', 'listening'),
  r('/admin/listening/tf', 'context', 'content', 'listening'),
  r('/admin/listening/mcq', 'context', 'content', 'listening'),
  r('/admin/listening/import-drills', 'hidden', 'content', 'listening'),
  r('/admin/listening/import-fulltest', 'hidden', 'content', 'listening'),
  r('/admin/listening/audit', 'context', 'reports', 'quality'),
  r('/admin/listening/audit-detail', 'context', 'reports', 'quality'),
  r('/admin/listening/attempts', 'context', 'reports', 'activity'),
  r('/admin/listening/dictation', 'context', 'reports', 'activity'),
  r('/admin/reading', 'nav', 'content', 'reading'),
  r('/admin/reading/content', 'tab', 'content', 'reading', '/admin/reading?tab=items'),
  r('/admin/reading/preview', 'context', 'content', 'reading'),
  r('/admin/vocab', 'nav', 'content', 'vocab'),
  r('/admin/vocab/sets', 'tab', 'content', 'vocab', '/admin/vocab?tab=programs'),
  r('/admin/vocab/sets/[setId]', 'context', 'content', 'vocab'),
  r('/admin/vocab/topics', 'context', 'content', 'vocab'),
  r('/admin/vocab/content', 'hidden', 'content', 'vocab'),
  r('/admin/vocab/quiz', 'hidden', 'content', 'vocab'),
  r('/admin/vocab/curated', 'tab', 'content', 'vocab', '/admin/vocab?tab=items&status=pending'),
  r('/admin/vocab/d1-curation', 'tab', 'content', 'vocab', '/admin/vocab?tab=items&status=pending'),
  r('/admin/vocab/exercises', 'tab', 'content', 'vocab', '/admin/vocab?tab=items&status=pending'),
  r('/admin/vocab/lemmas', 'context', 'content', 'vocab'),
  r('/admin/vocab/stats', 'context', 'reports', 'activity'),
  r('/admin/vocab/quiz-analytics', 'context', 'reports', 'activity'),
  r('/admin/vocab/pilot-metrics', 'context', 'reports', 'activity'),
  r('/admin/grammar', 'nav', 'content', 'grammar'),
  r('/admin/grammar/articles', 'tab', 'content', 'grammar', '/admin/grammar?tab=items'),
  r('/admin/grammar/analytics', 'context', 'reports', 'activity'),
  r('/admin/grammar/recommend-test', 'context', 'system', 'qa-tools'),
  r('/admin/mock-tests', 'nav', 'mock', 'mock-tests'),
  r('/admin/mock-exams', 'redirect', 'mock', 'mock-tests', '/admin/mock-tests'),
  r('/admin/mock-exams/corrections', 'context', 'system', 'qa-tools'),
  r('/admin/mock-live', 'redirect', 'mock', 'mock-tests', '/admin/mock-tests'),
  r('/admin/mock-pacing', 'redirect', 'mock', 'mock-tests', '/admin/mock-tests'),
  r('/admin/error-logs', 'tab', 'system', 'incidents', '/admin/incidents?source=errors'),
  r('/admin/system/alerts', 'tab', 'system', 'incidents', '/admin/incidents?source=grading'),
  r('/admin/feedback', 'tab', 'system', 'incidents', '/admin/incidents?source=feedback'),
  r('/admin/system', 'redirect', 'system', 'incidents', '/admin/incidents'),
  r('/admin/system/ai-usage', 'context', 'reports', 'ai-cost'),
  r('/admin/foot-traffic', 'context', 'reports', 'traffic'),
  r('/admin/mfa', 'nav', 'system', 'mfa'),
  // New routes of the package (plan 5.1 "Route mới của gói"); most land in later tasks.
  r('/admin/learners', 'nav', 'learners', 'learners'),
  r('/admin/learners/[ref]', 'context', 'learners', 'learners'),
  r('/admin/classes/[cohortId]/assignments/[assignmentId]', 'context', 'learners', 'classes'),
  r('/admin/classes/[cohortId]/assignments/[assignmentId]/release', 'context', 'learners', 'classes'),
  r('/admin/activation-codes', 'nav', 'learners', 'activation-codes'),
  r('/admin/notifications', 'nav', 'learners', 'notifications'),
  r('/admin/surveys', 'nav', 'learners', 'surveys'),
  r('/admin/instructors/[id]', 'context', 'learners', 'instructors'),
  r('/admin/courses', 'nav', 'courses', 'courses'),
  r('/admin/courses/[id]', 'context', 'courses', 'courses'),
  r('/admin/enrollments', 'nav', 'courses', 'enrollments'),
  r('/admin/enrollments/[orderCode]', 'context', 'courses', 'enrollments'),
  r('/admin/credits', 'nav', 'courses', 'credits'),
  r('/admin/speaking/grading', 'nav', 'grading', 'speaking-grading'),
  r('/admin/mock-tests/new', 'context', 'mock', 'mock-tests'),
  r('/admin/mock-tests/[examId]', 'context', 'mock', 'mock-tests'),
  r('/admin/mock-tests/[examId]/setup', 'context', 'mock', 'mock-tests'),
  r('/admin/library', 'nav', 'content', 'library'),
  r('/admin/reports', 'nav', 'reports', 'activity'),
  r('/admin/incidents', 'nav', 'system', 'incidents'),
  r('/admin/ai-models', 'nav', 'system', 'ai-models'),
  r('/admin/qa-tools', 'nav', 'system', 'qa-tools'),
  r('/admin/settings', 'nav', 'system', 'settings'),
]);

/** The four manual import pages: dimmed out of the sidebar, banner on top (FR-013). */
export const HIDDEN_IMPORT_ROUTES = Object.freeze(
  ADMIN_ROUTES.filter((route) => route.kind === 'hidden').map((route) => route.pattern));

/** Teacher frame (CHUAN-ADMIN.md §B): five flat entries. */
export const INSTRUCTOR_NAV_ITEMS = Object.freeze([
  { id: 'today', label: 'Việc của tôi', href: '/instructor?tab=today', icon: 'home' },
  { id: 'classes', label: 'Lớp của tôi', href: '/instructor?tab=classes', icon: 'users' },
  { id: 'students', label: 'Học viên', href: '/instructor?tab=students', icon: 'user' },
  { id: 'assign', label: 'Giao bài', href: '/instructor?tab=assign', icon: 'plus' },
  { id: 'grading', label: 'Chấm và duyệt bài', href: '/instructor?tab=grading', icon: 'clipboard', countKey: 'writing_review' },
]);

const REPORT_TABS = { 'hoat-dong': 'activity', 'luu-luong': 'traffic', 'chi-phi-ai': 'ai-cost', 'chat-luong': 'quality' };

function normalize(pathname) {
  const bare = String(pathname || '/').split(/[?#]/)[0] || '/';
  return bare.length > 1 ? bare.replace(/\/+$/, '') : bare;
}

function toRegExp(pattern) {
  const body = pattern.split('/').map((part) => (/^\[[^\]]+\]$/.test(part) ? '[^/]+' : part.replace(/[.*+?^${}()|\\]/g, '\\$&'))).join('/');
  return new RegExp(`^${body}$`);
}

const COMPILED = ADMIN_ROUTES.map((route) => ({ route, re: toRegExp(route.pattern), dynamic: route.pattern.includes('[') }));

/** The registry row of a pathname: an exact static pattern wins over a dynamic one. */
export function adminRouteFor(pathname) {
  const path = normalize(pathname);
  const hits = COMPILED.filter(({ re }) => re.test(path));
  if (!hits.length) return null;
  return (hits.find((hit) => !hit.dynamic) ?? hits[0]).route;
}

/**
 * Which sidebar entry a page belongs to (FR-007): `{ groupId, itemId }`, or
 * null outside the registry. `/admin/reports` picks its item from `?tab=`.
 */
export function adminNavMatch(pathname, search = '') {
  const route = adminRouteFor(pathname);
  if (!route || !route.group) return null;
  if (route.pattern === '/admin/reports') {
    const tab = new URLSearchParams(String(search || '').replace(/^\?/, '')).get('tab');
    return { groupId: 'reports', itemId: REPORT_TABS[tab] ?? 'activity' };
  }
  return { groupId: route.group, itemId: route.item };
}

/** True on one of the four manual import pages (FR-013). */
export function isHiddenImportRoute(pathname) {
  return adminRouteFor(pathname)?.kind === 'hidden';
}
