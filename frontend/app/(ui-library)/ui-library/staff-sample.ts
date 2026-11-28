import type { StaffNavGroup, StaffNavItem } from '@/components/ui/shell/staff-nav';
import type { StaffSearchGroup } from '@/components/ui/shell/staff-quick-search';
import { routeFor } from '@/lib/route-registry.mjs';

// Sample data of KhungTrang2 §7–8 and CHUAN-ADMIN.md §A (UIBASE-0056 G03-T16).
// G09 supplies the real `nav`. Counts are the sheet's sample numbers, never
// real queues. Registry Q53: the library links only to live routes, so each
// entry names its planned screen and a live page standing in for it today;
// an entry with no live page yet shows as "Chưa mở" (`available: false`,
// GOI-09 FR-005) and is listed in PLANNED_ONLY.
export const SAMPLE_STAFF_ADMIN = { name: 'Vũ Thanh Tâm', email: 'thanhtam@example.com', initials: 'VT' };
export const SAMPLE_STAFF_INSTRUCTOR = { name: 'Trần Thu Hà', email: 'thuha@example.com', initials: 'TH' };

type Plan = { label: string; today: string | null; count?: number };

const isLive = (href: string) => routeFor(href)?.status === 'live';

const missing: string[] = [];

function group(id: string, label: string | undefined, icon: StaffNavGroup['icon'], plan: Plan[]): StaffNavGroup {
  const items = plan.map(({ label: itemLabel, today, count }): StaffNavItem => {
    if (today && isLive(today)) return { label: itemLabel, href: today, count };
    missing.push(label ? `${label} › ${itemLabel}` : itemLabel);
    return { label: itemLabel, href: null, available: false };
  });
  return { id, label, icon, items };
}

/** The eight fixed admin groups (AD-37), sample counts of the sheet. */
export const SAMPLE_ADMIN_NAV: readonly StaffNavGroup[] = [
  group('tq', 'Tổng quan', 'home', [{ label: 'Việc cần làm', today: '/admin' }]),
  group('hv', 'Học viên và quyền truy cập', 'users', [
    { label: 'Học viên', today: '/admin/students' },
    { label: 'Lớp', today: '/admin/classes' },
    { label: 'Giáo viên', today: '/admin/instructors' },
    { label: 'Mã kích hoạt', today: '/admin/users' },
    { label: 'Gửi thông báo', today: null },
    { label: 'Khảo sát và nhận xét', today: '/admin/feedback', count: 4 },
  ]),
  group('kh', 'Khoá học và đăng ký', 'credit-card', [
    { label: 'Khoá học', today: null },
    { label: 'Đơn đăng ký', today: null, count: 2 },
    { label: 'Lượt AI', today: '/admin/usage' },
  ]),
  group('cb', 'Chấm bài', 'clipboard', [
    { label: 'Writing', today: '/admin/writing/queue', count: 3 },
    { label: 'Speaking', today: '/admin/speaking/sessions', count: 2 },
    { label: 'Yêu cầu chấm lại', today: '/admin/writing/regrade-requests', count: 2 },
  ]),
  group('nd', 'Nội dung', 'book', [
    { label: 'Listening', today: '/admin/listening' },
    { label: 'Reading', today: '/admin/reading' },
    { label: 'Writing', today: '/admin/writing' },
    { label: 'Speaking', today: '/admin/speaking' },
    { label: 'Từ vựng', today: '/admin/vocab' },
    { label: 'Ngữ pháp', today: '/admin/grammar' },
    { label: 'Thư viện công khai', today: null },
  ]),
  group('tt', 'Thi thử', 'timer', [{ label: 'Kỳ thi', today: '/admin/mock-tests' }]),
  group('bc', 'Báo cáo', 'chart', [
    { label: 'Hoạt động học viên', today: '/admin/dashboard/reading-attempts' },
    { label: 'Lưu lượng', today: '/admin/foot-traffic' },
    { label: 'Chi phí AI', today: '/admin/system/ai-usage' },
    { label: 'Chất lượng nội dung', today: '/admin/listening/audit' },
  ]),
  group('ht', 'Hệ thống', 'settings', [
    { label: 'Hộp thư sự cố', today: '/admin/error-logs', count: 12 },
    { label: 'AI và mô hình', today: '/admin/system' },
    { label: 'Bảo mật', today: '/admin/mfa' },
    { label: 'Công cụ QA', today: null },
    { label: 'Cài đặt', today: null },
  ]),
].filter((g) => g.items.length > 0);

/** The instructor's five flat entries (AD-16), one group without a heading. */
export const SAMPLE_INSTRUCTOR_NAV: readonly StaffNavGroup[] = [
  group('gv', undefined, 'clipboard', [
    { label: 'Việc của tôi', today: '/instructor' },
    { label: 'Lớp của tôi', today: null },
    { label: 'Học viên', today: null },
    { label: 'Giao bài', today: null },
    { label: 'Chấm và duyệt bài', today: '/admin/writing/instructor-queue', count: 5 },
  ]),
].map((g) => ({ ...g, items: g.items.map((item, i) => ({ ...item, icon: i === 0 ? 'home' as const : 'pencil' as const })) }));

const SAMPLE_SEARCH: readonly StaffSearchGroup[] = [
  { group: 'Học viên', items: [
    { title: 'Nguyễn Minh Anh', meta: 'minhanh@example.com · Lớp Tue–Thu 19:30', href: '/admin/students' },
    { title: 'Trần Minh Quân', meta: 'minhquan@example.com · Lớp Mon–Wed 18:00', href: '/admin/users' },
  ] },
  { group: 'Lớp', items: [{ title: 'Lớp Tue–Thu 19:30', meta: 'có học viên Nguyễn Minh Anh', href: '/admin/classes' }] },
  { group: 'Bài nộp', items: [{ title: 'Writing Task 2 · Nguyễn Minh Anh', meta: 'nộp 15/11 · Đã trả bài', href: '/admin/writing/queue' }] },
  { group: 'Đề', items: [{ title: 'Writing Task 1 · Bản đồ khu Minh Khai', meta: 'Nội dung · Writing', href: '/admin/writing' }] },
];

/** Sample search: "minh" (or its first letters) finds the sheet's results. */
export async function sampleStaffSearch(query: string): Promise<readonly StaffSearchGroup[]> {
  const q = query.toLowerCase();
  return 'minh'.startsWith(q) || q.startsWith('minh') ? SAMPLE_SEARCH : [];
}

/** Entries whose planned screen has no live stand-in yet, for the caption. */
export const PLANNED_ONLY: readonly string[] = Object.freeze([...new Set(missing)]);
