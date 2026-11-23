// ADMINIA-0074 plan 5.2 (G09-T08): behaviour of the admin navigation registry.
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ADMIN_NAV_GROUPS,
  ADMIN_ROUTES,
  HIDDEN_IMPORT_ROUTES,
  INSTRUCTOR_NAV_ITEMS,
  adminNavMatch,
  adminRouteFor,
  isHiddenImportRoute,
} from '../lib/admin-nav-registry.mjs';

const APP = fileURLToPath(new URL('../app/', import.meta.url));

function pages(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return pages(full);
    return name === 'page.tsx' ? [full] : [];
  });
}

/** `app/(group)/admin/x/[id]/page.tsx` → `/admin/x/[id]`. */
function routeOf(file) {
  const parts = relative(APP, file).split(sep).slice(0, -1).filter((part) => !/^\(.*\)$/.test(part));
  return `/${parts.join('/')}`;
}

const ADMIN_PAGES = pages(APP).map(routeOf).filter((route) => route === '/admin' || route.startsWith('/admin/'));
const PATTERNS = new Set(ADMIN_ROUTES.map((route) => route.pattern));

describe('admin navigation registry', () => {
  it('(1) lists every admin page.tsx', () => {
    assert.ok(ADMIN_PAGES.length >= 75, `found ${ADMIN_PAGES.length} admin pages`);
    const missing = ADMIN_PAGES.filter((route) => !PATTERNS.has(route));
    assert.deepEqual(missing, []);
  });

  it('(2) every sidebar href is a nav route, and only unavailable items have no href', () => {
    for (const group of ADMIN_NAV_GROUPS) {
      for (const item of group.items) {
        if (item.href === null) {
          assert.equal(item.available, false, item.label);
          continue;
        }
        // A tab of one page (`/admin/reports?tab=…`, G09-T41) is matched with its query.
        const [path, query = ''] = item.href.split('?');
        const route = adminRouteFor(path);
        assert.equal(route?.kind, 'nav', `${item.label} → ${item.href}`);
        assert.deepEqual(adminNavMatch(path, query ? `?${query}` : ''), { groupId: group.id, itemId: item.id }, item.label);
      }
    }
    // An available item always points at a page that exists today.
    for (const item of ADMIN_NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.available)) {
      const path = item.href.split('?')[0];
      assert.ok(ADMIN_PAGES.includes(path), `${item.label}: ${item.href} has no page.tsx`);
    }
  });

  it('(3) matches twelve sample paths', () => {
    const cases = [
      ['/admin', '', ['overview', 'todo']],
      ['/admin/', '', ['overview', 'todo']],
      ['/admin/classes/0d6f0c4e-0000-4000-8000-000000000001', '', ['learners', 'classes']],
      ['/admin/classes/abc/exercise-book/grants', '', ['learners', 'classes']],
      ['/admin/writing/grade', '?id=1', ['grading', 'writing-queue']],
      ['/admin/writing/instructor-queue', '', ['grading', 'writing-queue']],
      ['/admin/listening/content/c1/edit', '', ['content', 'listening']],
      ['/admin/vocab/sets/s1', '', ['content', 'vocab']],
      ['/admin/speaking/sessions', '', ['reports', 'activity']],
      ['/admin/error-logs', '', ['system', 'incidents']],
      ['/admin/reports', '?tab=chi-phi-ai', ['reports', 'ai-cost']],
      ['/admin/mock-tests/e1/setup', '', ['mock', 'mock-tests']],
    ];
    for (const [path, search, [groupId, itemId]] of cases) {
      assert.deepEqual(adminNavMatch(path, search), { groupId, itemId }, path);
    }
    assert.equal(adminNavMatch('/home'), null);
    assert.equal(adminNavMatch('/admin/nope'), null);
  });

  it('(4) has the eight groups and items of plan 5.1 "Sidebar chuẩn", in order', () => {
    assert.deepEqual(ADMIN_NAV_GROUPS.map((g) => [g.label, g.items.map((i) => i.label)]), [
      ['Tổng quan', ['Việc cần làm']],
      ['Học viên và quyền truy cập', ['Học viên', 'Lớp', 'Giáo viên', 'Mã kích hoạt', 'Gửi thông báo', 'Khảo sát và nhận xét']],
      ['Khoá học và đăng ký', ['Khoá học', 'Đơn đăng ký', 'Lượt AI']],
      ['Chấm bài', ['Writing', 'Speaking', 'Yêu cầu chấm lại']],
      ['Nội dung', ['Listening', 'Reading', 'Writing', 'Speaking', 'Từ vựng', 'Ngữ pháp', 'Thư viện công khai']],
      ['Thi thử', ['Kỳ thi']],
      ['Báo cáo', ['Hoạt động học viên', 'Lưu lượng', 'Chi phí AI', 'Chất lượng nội dung']],
      ['Hệ thống', ['Hộp thư sự cố', 'AI và mô hình', 'Bảo mật', 'Công cụ QA', 'Cài đặt']],
    ]);
    const counted = ADMIN_NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.countKey).map((i) => i.countKey);
    assert.deepEqual(counted.sort(), ['enrollments_reported', 'incident_groups_open', 'regrade_new',
      'speaking_mock_pending', 'writing_review']);
    // FR-012: "Khảo sát và nhận xét" stays "Chưa mở" (no number) until GOI-13 builds the page.
    const surveys = ADMIN_NAV_GROUPS[1].items.at(-1);
    assert.equal(surveys.href, '/admin/surveys');
    assert.equal(surveys.available, false);
    assert.equal(surveys.countKey, undefined);
  });

  it('(5) no item is an import or upload page, and no "Giáo viên duyệt"', () => {
    for (const label of ADMIN_NAV_GROUPS.flatMap((g) => g.items.map((i) => i.label))) {
      assert.doesNotMatch(label, /Import|Nhập|Tải lên|Giáo viên duyệt/i, label);
    }
  });

  it('(6) Chấm bài has no "Thi thử" item', () => {
    const grading = ADMIN_NAV_GROUPS.find((g) => g.id === 'grading');
    assert.ok(grading.items.every((i) => !/Thi thử/.test(i.label)));
  });

  it('lists the four hidden import routes (FR-013)', () => {
    assert.deepEqual([...HIDDEN_IMPORT_ROUTES].sort(), [
      '/admin/listening/import-drills', '/admin/listening/import-fulltest', '/admin/vocab/content', '/admin/vocab/quiz']);
    assert.equal(isHiddenImportRoute('/admin/vocab/quiz/'), true);
    assert.equal(isHiddenImportRoute('/admin/vocab'), false);
  });

  it('gives the teacher five flat entries (CHUAN-ADMIN.md §B)', () => {
    assert.deepEqual(INSTRUCTOR_NAV_ITEMS.map((i) => [i.label, i.href]), [
      ['Việc của tôi', '/instructor?tab=today'],
      ['Lớp của tôi', '/instructor?tab=classes'],
      ['Học viên', '/instructor?tab=students'],
      ['Giao bài', '/instructor?tab=assign'],
      ['Chấm và duyệt bài', '/instructor?tab=grading'],
    ]);
  });

  it('never says "giảng viên", "thầy", "Đơn hàng", "bán" or "giá" (FR-014)', () => {
    const labels = [...ADMIN_NAV_GROUPS.flatMap((g) => [g.label, ...g.items.map((i) => i.label)]),
      ...INSTRUCTOR_NAV_ITEMS.map((i) => i.label)];
    for (const label of labels) assert.doesNotMatch(label, /giảng viên|thầy|Đơn hàng|(?<!\p{L})(bán|giá)(?!\p{L})/iu, label);
  });
});
