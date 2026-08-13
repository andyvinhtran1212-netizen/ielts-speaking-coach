import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  averageRating,
  feedbackDeepLink,
  formatFeedbackTime,
  groupFeedbackItems,
  normalizeFeedbackFilters,
  normalizeFeedbackInbox,
} from '../lib/admin-feedback-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const CLIENT = read('app', '(authed-admin-feedback)', 'admin', 'feedback', 'admin-feedback.tsx');
const PAGE = read('app', '(authed-admin-feedback)', 'admin', 'feedback', 'page.tsx');
const LAYOUT = read('app', '(authed-admin-feedback)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-feedback-next.css');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');
const VERCEL = read('vercel.json');
const VERIFIER = read('tooling', 'verify-admin-feedback-flow.mjs');

const payload = (overrides = {}) => ({
  data_status: 'complete', snapshot_to: '2026-08-12T08:00:00Z', skill: null,
  feedback_type: null, status: 'new', test_id: null, truncated: false,
  malformed_count: 0, count: 1, groups: [], items: [{
    id: 'f1', type: 'report', skill: 'reading', status: 'new', test_id: 'SHARED',
    q_num: 3, rating_de: null, rating_audio: null, category: 'wrong_answer',
    note: '<script>alert(1)</script>', identity_kind: 'user', created_at: '2026-08-12T07:00:00Z',
  }], ...overrides,
});

describe('/admin/feedback native ownership', () => {
  test('uses backend-owned admin gate and canonical read/write endpoints', () => {
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /active="feedback"/);
    assert.match(CLIENT, /window\.api\.get<unknown>\(`\/api\/admin\/feedback/);
    assert.match(CLIENT, /window\.api\.patch<\{ id\?: string; status\?: string \}>\(`\/api\/admin\/feedback\/\$\{encodeURIComponent\(item\.id\)\}`/);
    assert.match(CLIENT, /const latestFilters = useRef\(filters\)/);
    assert.match(CLIENT, /const apply = \(next: FeedbackFilters\) => \{[\s\S]*latestFilters\.current = next/);
    assert.match(CLIENT, /const latestProfileId = useRef\(profile\.id\)/);
    assert.match(CLIENT, /const verified = await load\(latestFilters\.current\)/);
    assert.match(CLIENT, /latestProfileId\.current !== mutationProfileId/);
    assert.match(CLIENT, /pendingIds\.current\.has\(item\.id\)/);
    assert.doesNotMatch(CLIENT, /setSnapshot\(\{[^}]*status:\s*nextStatus/);
    assert.match(LAYOUT, /admin-feedback-next\.css/);
    assert.match(CHROME, /section: 'feedback',[\s\S]*href: '\/admin\/feedback'/);
    assert.doesNotMatch(VERCEL, /"source": "\/admin\/feedback"/);
  });

  test('has URL-restorable filters, degraded states and responsive controls', () => {
    assert.match(CLIENT, /searchParams\?\.get\('type'\)/);
    assert.match(CLIENT, /searchParams\?\.get\('skill'\)/);
    assert.match(CLIENT, /searchParams\?\.get\('status'\)/);
    assert.match(CLIENT, /status === 'unavailable'/);
    assert.match(CLIENT, /status === 'partial'/);
    assert.match(CLIENT, /inbox\.status === 'partial' \|\| average == null \? '—'/);
    assert.match(CLIENT, /Không kết luận từ dữ liệu thiếu/);
    assert.match(CSS, /@media\(max-width:640px\)/);
    assert.match(CSS, /min-height:44px/);
    assert.match(WORKFLOW, /frontend\/app\/\(authed-admin-feedback\)\/\*\*/);
    assert.match(WORKFLOW, /verify-admin-feedback-flow\.mjs/);
    assert.match(VERIFIER, /const desktopFilterResponse = page\.waitForResponse/);
    assert.match(VERIFIER, /await desktopFilterResponse/);
    assert.match(VERIFIER, /const desktopLayout = await page\.evaluate/);
    assert.doesNotMatch(VERIFIER, /waitForFunction\(\(\) => \{\s*const header = document\.querySelector\('\.afd-group__header'\)/);
  });
});

describe('admin feedback model truth', () => {
  test('accepts canonical payload and rejects missing/contradictory coverage', () => {
    const result = normalizeFeedbackInbox(payload());
    assert.ok(result);
    assert.equal(result.items[0].note, '<script>alert(1)</script>');
    assert.equal(normalizeFeedbackInbox({ items: [], groups: [] }), null);
    assert.equal(normalizeFeedbackInbox(payload({ count: 2 })), null);
    assert.equal(normalizeFeedbackInbox(payload({ data_status: 'unavailable', count: 0, items: [] })), null);
    assert.ok(normalizeFeedbackInbox(payload({ data_status: 'unavailable', count: null, items: [] })));
    assert.equal(normalizeFeedbackInbox(payload({ snapshot_to: 'not-a-date' })), null);
    assert.equal(normalizeFeedbackInbox(payload({ data_status: 'partial', truncated: false })), null);
    assert.equal(normalizeFeedbackInbox(payload({ data_status: 'complete', truncated: true })), null);
    assert.equal(normalizeFeedbackInbox(payload({ skill: 'speaking' })), null);
  });

  test('groups by skill plus test id and calculates valid averages only', () => {
    const item = normalizeFeedbackInbox(payload()).items[0];
    const groups = groupFeedbackItems([
      item,
      { ...item, id: 'f2', skill: 'listening' },
      { ...item, id: 'f3', type: 'rating', ratingTest: 5 },
    ]);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].items.length, 2);
    assert.equal(averageRating([5, null, 4, 9]), 4.5);
  });

  test('normalizes URL filters and deep-links without inventing broken anchors', () => {
    assert.deepEqual(normalizeFeedbackFilters({}), { type: '', skill: '', status: 'new' });
    assert.deepEqual(normalizeFeedbackFilters({ type: 'rating', skill: 'reading', status: 'all' }), { type: 'rating', skill: 'reading', status: '' });
    assert.equal(feedbackDeepLink({ skill: 'reading', testId: 'RD-1', questionNumber: 3 }), '/admin/reading/preview?test_id=RD-1#q3');
    assert.equal(feedbackDeepLink({ skill: 'reading', testId: 'RD-1', questionNumber: null }), '/admin/reading/preview?test_id=RD-1');
    assert.equal(feedbackDeepLink({ skill: 'listening', testId: 'LIS-1', questionNumber: 3 }), '/pages/admin/listening/tests.html');
    assert.equal(feedbackDeepLink({ skill: 'listening', testId: 'exercise:abc', questionNumber: null }), null);
    assert.equal(feedbackDeepLink({ skill: 'vocabulary', testId: 'vocabulary:work/career', questionNumber: null }), '/vocabulary.html?cat=work&slug=career');
    assert.equal(formatFeedbackTime('2026-08-12T07:00:00Z', new Date('2026-08-12T08:00:00Z')), '1 giờ trước');
  });
});
