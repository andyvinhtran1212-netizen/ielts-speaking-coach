// G09-T16 (ADMINIA-0074 FR-070…FR-073): incident inbox page model.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  actionsFor, bulkRefs, bulkResultText, confirmText, formatWhen, groupHref, groupsApiQuery,
  inboxQueryString, learnerHref, parseInboxQuery, undoActionFor,
} from '../lib/admin-incidents-model.mjs';
import { ADMIN_NAV_GROUPS, adminRouteFor } from '../lib/admin-nav-registry.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const FP = 'a'.repeat(40);

describe('incident inbox URL state', () => {
  it('defaults to open groups, learners first, page 1, all sources', () => {
    assert.deepEqual(parseInboxQuery(''), { source: null, status: 'open', sort: 'learners', page: 1 });
    assert.equal(inboxQueryString(parseInboxQuery('')), '');
  });

  it('keeps known values and drops unknown ones', () => {
    assert.deepEqual(parseInboxQuery('?source=grading&status=resolved&sort=count&page=3'),
      { source: 'grading', status: 'resolved', sort: 'count', page: 3 });
    assert.deepEqual(parseInboxQuery('source=x&status=y&sort=z&page=-2'),
      { source: null, status: 'open', sort: 'learners', page: 1 });
    assert.equal(inboxQueryString({ source: 'errors', status: 'all', sort: 'last', page: 2 }),
      '?source=errors&status=all&sort=last&page=2');
  });

  it('builds the API query and the group link', () => {
    assert.equal(groupsApiQuery({ source: 'feedback', status: 'open', sort: 'learners', page: 1 }).toString(),
      'status=open&sort=learners&page=1&source=feedback');
    assert.equal(groupHref({ source: 'errors', fingerprint: FP }), `/admin/incidents/errors/${FP}`);
    assert.equal(learnerHref('u-1'), '/admin/learners/u-1');
  });
});

describe('incident actions', () => {
  const groups = [
    { source: 'errors', fingerprint: FP, count: 12, last_at: '2026-11-16T02:58:00Z' },
    { source: 'grading', fingerprint: 'b'.repeat(40), count: 3, last_at: null },
  ];

  it('bulk refs carry the count and last time the page showed', () => {
    assert.deepEqual(bulkRefs(groups), [
      { source: 'errors', fingerprint: FP, expected_count: 12, expected_last_at: '2026-11-16T02:58:00Z' },
      { source: 'grading', fingerprint: 'b'.repeat(40), expected_count: 3 },
    ]);
  });

  it('the confirm text names groups and records (FR-071)', () => {
    assert.equal(confirmText('resolve', groups), 'Chuyển 2 nhóm (15 lần ghi nhận) sang Đã xử lý.');
    assert.equal(confirmText('ignore', groups.slice(1)), 'Chuyển 1 nhóm (3 lần ghi nhận) sang Bỏ qua.');
  });

  it('only closing can be undone, by reopening', () => {
    assert.equal(undoActionFor('resolve'), 'reopen');
    assert.equal(undoActionFor('ignore'), 'reopen');
    assert.equal(undoActionFor('claim'), null);
    assert.equal(undoActionFor('reopen'), null);
  });

  it('each status offers its actions; there is no note-only action (a stale no-op could close a group)', async () => {
    const model = await import('../lib/admin-incidents-model.mjs');
    assert.equal(model.noteOnlyAction, undefined);
    assert.doesNotMatch(read('app/(authed-admin)/(incidents)/admin/incidents/[source]/[fingerprint]/admin-incident-detail.tsx'), /Chỉ lưu ghi chú/);
    assert.deepEqual(actionsFor('new'), ['claim', 'resolve', 'ignore']);
    assert.deepEqual(actionsFor('resolved'), ['reopen']);
  });

  it('the result line explains conflicts in plain words', () => {
    const text = bulkResultText('resolve', { changed: 1, conflicts: [
      { code: 'count_changed' }, { code: 'not_found' }, { code: 'write_failed' }, { code: 'refused' }], dismiss_failed: ['x'] });
    assert.match(text, /^Đánh dấu đã xử lý: 1 nhóm\./);
    assert.match(text, /1 nhóm có ghi nhận mới nên chưa đổi; tải lại để xem\./);
    assert.match(text, /1 nhóm không còn\./);
    assert.match(text, /1 nhóm chưa ghi được/);
    assert.match(text, /Một số dòng lỗi cũ chưa được đánh dấu/);
    assert.match(text, /1 nhóm chưa đổi: đã có ghi nhận mới hoặc không còn/);
  });

  it('shows Vietnam time', () => {
    assert.equal(formatWhen('2026-11-16T02:58:00Z'), '16/11 09:58');
    assert.equal(formatWhen(null), '—');
    assert.equal(formatWhen('nope'), '—');
  });
});

describe('incident routes', () => {
  it('the sidebar item is open and the old routes point at a source tab', () => {
    const item = ADMIN_NAV_GROUPS.flatMap((g) => g.items).find((i) => i.id === 'incidents');
    assert.equal(item.href, '/admin/incidents');
    assert.equal(item.available, true);
    assert.equal(adminRouteFor('/admin/error-logs').redirectTo, '/admin/incidents?source=errors');
    assert.equal(adminRouteFor('/admin/system/alerts').redirectTo, '/admin/incidents?source=grading');
    assert.equal(adminRouteFor('/admin/system').redirectTo, '/admin/incidents');
    assert.equal(adminRouteFor(`/admin/incidents/errors/${FP}`).kind, 'context');
  });

  it('the three old pages redirect only under ADMIN_FRAME_V2; /admin/feedback stays', () => {
    const helper = read('lib/admin-frame-redirect.ts');
    assert.match(helper, /process\.env\.ADMIN_FRAME_V2 !== '1'/);
    for (const [page, route] of [
      ['app/(authed-admin)/(error-logs)/admin/error-logs/page.tsx', '/admin/error-logs'],
      ['app/(authed-admin-system)/admin/system/alerts/page.tsx', '/admin/system/alerts'],
      ['app/(authed-admin-system)/admin/system/page.tsx', '/admin/system'],
    ]) assert.ok(read(page).includes(`redirectUnderAdminFrameV2('${route}')`), page);
    assert.doesNotMatch(read('app/(authed-admin)/(feedback)/admin/feedback/page.tsx'), /redirectUnderAdminFrameV2/);
  });

  it('the inbox pages answer 404 while ADMIN_FRAME_V2 is off', () => {
    assert.match(read('lib/admin-frame-redirect.ts'), /export function requireAdminFrameV2\(\): void \{\n  if \(process\.env\.ADMIN_FRAME_V2 !== '1'\) notFound\(\);/);
    for (const page of ['app/(authed-admin)/(incidents)/admin/incidents/page.tsx',
      'app/(authed-admin)/(incidents)/admin/incidents/[source]/[fingerprint]/page.tsx']) {
      assert.match(read(page), /requireAdminFrameV2\(\);/, page);
    }
  });

  it('the inbox has no "Tạo lỗi test" button (moved to QA tools, G09-T18)', () => {
    const page = read('app/(authed-admin)/(incidents)/admin/incidents/admin-incidents.tsx');
    assert.doesNotMatch(page, /error-logs\/test|Tạo lỗi/);
  });
});
