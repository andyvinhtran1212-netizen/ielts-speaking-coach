// G09-T10 (ADMINIA-0074 FR-020, FR-021, FR-034, FR-035): learner directory model.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  assignableIds, cohortsText, creditsText, directoryApiQuery, directoryCsv, directoryQueryString,
  kindText, lastActiveText, notifyHref, parseDirectoryQuery, summaryLines,
} from '../lib/admin-learners-model.mjs';
import { ADMIN_NAV_GROUPS, adminRouteFor } from '../lib/admin-nav-registry.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const C = '30000000-0000-0000-0000-000000000001';
const row = (extra = {}) => ({
  ref: 'u-1', student_id: 's1', name: 'Lan', email: 'lan@example.test', student_code: 'HV001',
  account_state: 'active', profile_state: 'active', kind: null, courses: null, credits_left: null,
  cohorts: [{ id: C, name: 'Tue–Thu 19:30' }], attention: [], last_active_at: null, ...extra,
});

describe('directory URL state (FR-021)', () => {
  it('defaults to learners, page 1, no filter', () => {
    assert.deepEqual(parseDirectoryQuery(''), { q: '', cohort: '', status: '', attention: '', role: 'user,student', page: 1 });
    assert.equal(directoryQueryString(parseDirectoryQuery('')), '');
  });

  it('keeps the filters the API answers and drops the ones that need G04', () => {
    const s = parseDirectoryQuery(`?q=lan&cohort=${C}&status=archived&attention=late_streak&role=instructor&page=2`);
    assert.deepEqual(s, { q: 'lan', cohort: C, status: 'archived', attention: 'late_streak', role: 'instructor', page: 2 });
    assert.equal(directoryApiQuery(s).toString(),
      `role=instructor&page=2&q=lan&cohort_id=${C}&status=archived&attention=late_streak`);
    const g04 = parseDirectoryQuery('?status=expiring&attention=low_credits&cohort=nope&page=0');
    assert.equal(g04.status, ''); assert.equal(g04.attention, ''); assert.equal(g04.cohort, ''); assert.equal(g04.page, 1);
  });
});

describe('columns (FR-020)', () => {
  it('says which half of the person is missing, and "chưa có" for G04 fields', () => {
    assert.equal(kindText(row({ account_state: 'none' })), 'Chưa có tài khoản');
    assert.equal(kindText(row({ profile_state: 'none' })), 'Chưa có hồ sơ học viên');
    assert.equal(kindText(row()), 'chưa có');
    assert.equal(creditsText(row()), 'chưa có');
    assert.equal(creditsText(row({ credits_left: 0 })), '0');
    assert.equal(cohortsText(row({ cohorts: null })), 'Không đọc được lớp');
    assert.equal(cohortsText(row({ cohorts: [] })), 'Không thuộc lớp');
  });

  it('last activity reads in days, Vietnam time', () => {
    const now = new Date('2026-11-23T10:00:00Z');
    assert.equal(lastActiveText(null, now), 'Chưa hoạt động');
    assert.equal(lastActiveText('2026-11-23T01:00:00Z', now), 'Hôm nay');
    assert.equal(lastActiveText('2026-11-22T10:00:00Z', now), 'Hôm qua');
    assert.equal(lastActiveText('2026-11-16T10:00:00Z', now), '7 ngày trước');
  });
});

describe('bulk actions (FR-035)', () => {
  it('CSV has only the visible columns and defuses spreadsheet formulas', () => {
    const csv = directoryCsv([row({ name: '=HYPERLINK("x")' })]);
    const [head, line] = csv.replace(/^\uFEFF/, '').split('\r\n');
    assert.equal(head, 'Học viên,Email,Mã học viên,Dạng,Khoá và hạn,Lớp,Lượt chấm còn,Hoạt động gần nhất,Cần chú ý');
    assert.ok(line.startsWith(`"'=HYPERLINK(""x"")"`), line);
    assert.doesNotMatch(csv, /s1|u-1/);
  });

  it('the reminder hand-off puts refs in the URL, never emails', () => {
    const href = notifyHref([row(), row({ ref: 's-9', email: null })]);
    assert.equal(href, '/admin/notifications?from=learners&template=renewal&ids=u-1%2Cs-9');
    assert.doesNotMatch(href, /@/);
  });

  it('class add takes profile ids and names who was left out', () => {
    assert.deepEqual(assignableIds([row(), row({ ref: 'u-2', student_id: null, name: 'Châu' })]),
      { ids: ['s1'], skipped: ['Châu'] });
  });
});

describe('shared learner block (FR-034)', () => {
  it('shows seven fields and never reads an unreadable source as fine', () => {
    const lines = summaryLines({
      name: 'Lan', cohorts: [], courses: null, status: { level: null, reasons: [] },
      goal: { target_band: 6.5, exam_date: '2026-12-20', source: 'conflict' }, overdue: null,
      recent_bands: { writing: [], speaking: null }, last_active_at: null, latest_note: null,
    });
    assert.equal(lines.status, 'Chưa xác định được (một nguồn chưa đọc được)');
    assert.equal(lines.goal, 'Band 6.5, thi 20/12/2026');
    assert.equal(lines.goalNote, 'Hai nguồn lệch nhau');
    assert.equal(lines.overdue, 'chưa có');
    assert.equal(lines.bandW, 'Writing: Chưa có bài đã trả');
    assert.equal(lines.bandS, 'Speaking: chưa có');
    assert.equal(lines.where, 'Không thuộc lớp · Khoá: chưa có');
  });
});

describe('routes', () => {
  it('the sidebar item is open; /admin/students redirects only under the flag and keeps ?q=', () => {
    const item = ADMIN_NAV_GROUPS.flatMap((g) => g.items).find((i) => i.id === 'learners');
    assert.equal(item.href, '/admin/learners'); assert.equal(item.available, true);
    assert.equal(adminRouteFor('/admin/students').redirectTo, '/admin/learners');
    const page = read('app/(authed-admin)/(students)/admin/students/page.tsx');
    assert.match(page, /redirectUnderAdminFrameV2\('\/admin\/students', \{ q:/);
    assert.match(read('lib/admin-frame-redirect.ts'), /process\.env\.ADMIN_FRAME_V2 !== '1'/);
    assert.match(read('app/(authed-admin)/(learners)/admin/learners/page.tsx'), /requireAdminFrameV2\(\);/);
    // /admin/users keeps role changes, account lock and codes until T11b and T12.
    assert.doesNotMatch(read('app/(authed-admin-users)/admin/users/page.tsx'), /redirectUnderAdminFrameV2/);
  });

  it('no dangerous action in a row or in the bulk bar', () => {
    const page = read('app/(authed-admin)/(learners)/admin/learners/admin-learners.tsx');
    assert.doesNotMatch(page, /window\.api\.(delete|patch)|\/active\b|\/role\b|\/restore\b|students\/\$\{/);
  });
});
