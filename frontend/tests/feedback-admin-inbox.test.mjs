/**
 * feedback-admin-inbox.test.mjs — Feedback PR-3 (admin inbox).
 *
 * Pins the admin Feedback page: nav registration, the box-sizing-safe link set,
 * filter + group-by-test + status-PATCH + deep-link contract, and the
 * token-mapped CSS. The pure helpers are EXECUTED from
 * lib/admin-feedback-model.mjs; the rest are source-assertion sentinels.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...rel) => readFileSync(join(__dirname, '..', ...rel), 'utf8');

const HTML = read('pages', 'admin', 'feedback', 'index.html');
// LEGACYJS-0075 W4a — admin-feedback.js is retired; the Next inbox owner and its
// model hold the endpoint + helper contract.
const TSX = read('app', '(authed-admin)', '(feedback)', 'admin', 'feedback', 'admin-feedback.tsx');
const M = await import(join(__dirname, '..', 'lib', 'admin-feedback-model.mjs'));
const CSS = read('css', 'admin-feedback.css');
const CHROME = read('js', 'components', 'aver-admin-chrome.js');


describe('Admin feedback — nav registration', () => {
  it('chrome registers a "feedback" section + nav item + message icon', () => {
    assert.match(CHROME, /'feedback'/);                                  // VALID_ACTIVE
    assert.match(CHROME, /section:\s*'feedback'[\s\S]*?href:\s*'\/admin\/feedback'[\s\S]*?icon:\s*'message'/);
    assert.match(CHROME, /message:\s*'<path/);                            // icon glyph added
  });
});


describe('Admin feedback — page shell (box-sizing-safe)', () => {
  it('mounts aver-admin-chrome active="feedback" + loads admin-feedback.js', () => {
    assert.match(HTML, /<aver-admin-chrome\s+active="feedback">/);
    assert.match(HTML, /src="\/js\/admin-feedback\.js"/);
    assert.match(HTML, /src="\/js\/components\/aver-admin-chrome\.js"/);
  });
  it('links admin-status.css but NOT admin-components.css (box-sizing gotcha)', () => {
    assert.match(HTML, /href="\/css\/aver-design\/admin-status\.css"/);
    assert.match(HTML, /href="\/css\/admin-feedback\.css"/);
    assert.doesNotMatch(HTML, /href="[^"]*admin-components\.css"/);   // the box-model-flipping reset
  });
  it('has the segmented type filter + skill + status selects + count badge', () => {
    assert.match(HTML, /id="fbx-type"[\s\S]*?data-type=""[\s\S]*?data-type="report"[\s\S]*?data-type="flag"[\s\S]*?data-type="rating"/);
    assert.match(HTML, /id="fbx-skill"[\s\S]*?value="reading"[\s\S]*?value="listening"[\s\S]*?value="vocabulary"/);
    assert.match(HTML, /id="fbx-status"[\s\S]*?value="new"[\s\S]*?value="resolved"/);
    assert.match(HTML, /id="fbx-count-n"/);
  });
});


describe('Admin feedback — endpoint contract (#458), Next owner', () => {
  it('GETs the grouped list + PATCHes status', () => {
    assert.match(TSX, /window\.api\.get<unknown>\(`\/api\/admin\/feedback\$\{suffix\}`\)/);
    assert.match(TSX, /window\.api\.patch<[^>]+>\(`\/api\/admin\/feedback\/\$\{encodeURIComponent\(item\.id\)\}`, \{ status: nextStatus \}\)/);
  });
  it('status toggle waits for the server and re-reads canonical state (no optimistic flip)', () => {
    assert.match(TSX, /if \(result\?\.id !== item\.id \|\| result\?\.status !== nextStatus\) throw/);
    assert.match(TSX, /const verified = await load\(latestFilters\.current\)/);
    assert.doesNotMatch(TSX, /\/\/ optimistic/);
  });
  it('preserves unavailable and partial read truth', () => {
    assert.match(TSX, /inbox\?\.status === 'unavailable' &&[^\n]*Không hiển thị số 0/);
    assert.match(TSX, /inbox\?\.status === 'partial' &&[^\n]*cận dưới/);
    assert.match(TSX, /const lowerBound = inbox\?\.status === 'partial' \? '≥ ' : ''/);
    assert.match(TSX, /inbox && inbox\.status !== 'unavailable' && </);
    assert.match(CSS, /\.adm-banner\.is-warning/);   // retired page style kept
  });
  it('consumes privacy-minimized identity_kind, not removed user UUIDs', () => {
    assert.match(TSX, /item\.identityKind === 'anonymous'/);
    assert.doesNotMatch(TSX, /created_by/);
    const inbox = M.normalizeFeedbackInbox({
      data_status: 'complete', snapshot_to: '2026-11-23T00:00:00Z', count: 1, groups: [],
      items: [{ id: 'f1', type: 'flag', skill: 'reading', status: 'new', identity_kind: 'user', created_by: 'uuid-x' }],
    });
    assert.equal(inbox.items[0].identityKind, 'user');
    assert.equal('createdBy' in inbox.items[0], false);
  });
});


describe('Admin feedback — pure helpers (executed from the model)', () => {
  const base = { snapshot_to: '2026-11-23T00:00:00Z', groups: [] };

  it('filters normalize type + status + skill (default status "new")', () => {
    assert.deepEqual(M.normalizeFeedbackFilters({}), { type: '', skill: '', status: 'new' });
    assert.deepEqual(M.normalizeFeedbackFilters({ type: 'flag', skill: 'listening', status: 'all' }), { type: 'flag', skill: 'listening', status: '' });
    assert.deepEqual(M.normalizeFeedbackFilters({ type: 'x', skill: 'y', status: 'resolved' }), { type: '', skill: '', status: 'resolved' });
  });
  it('groups rows under skill + test_id', () => {
    const groups = M.groupFeedbackItems([
      { testId: 'A', skill: 'listening', type: 'rating', status: 'new' },
      { testId: 'A', skill: 'listening', type: 'flag', status: 'resolved' },
      { testId: 'B', skill: 'reading', type: 'report', status: 'new' },
    ]);
    assert.equal(groups.length, 2);
    const a = groups.find((g) => g.testId === 'A');
    assert.equal(a.items.length, 2);
    assert.equal(a.newCount, 1);
  });
  it('deep link targets the right admin page per skill', () => {
    assert.equal(M.feedbackDeepLink({ skill: 'reading', testId: 'RD-1', questionNumber: 3 }), '/admin/reading/preview?test_id=RD-1#q3');
    assert.equal(M.feedbackDeepLink({ skill: 'listening', testId: 'LIS-1' }), '/admin/listening/tests');
    assert.equal(M.feedbackDeepLink({ skill: 'vocabulary', testId: 'vocabulary:work/career-path' }),
      '/vocabulary?cat=work&slug=career-path');
    assert.equal(M.feedbackDeepLink({ skill: 'listening', testId: null }), null);   // no test_id → no link
  });
  it('average ignores nulls and out-of-range values', () => {
    assert.equal(M.averageRating([5, null, 4]), 4.5);
    assert.equal(M.averageRating([null, null]), null);
    assert.equal(M.averageRating([9, 0]), null);
  });
  it('first-page failure is unavailable, never a canonical empty inbox', () => {
    const inbox = M.normalizeFeedbackInbox({ ...base, data_status: 'unavailable', count: null, items: [] });
    assert.equal(inbox.status, 'unavailable');
    assert.equal(inbox.count, null);
    assert.equal(M.normalizeFeedbackInbox({ ...base, data_status: 'unavailable', count: 0, items: [] }), null);
  });
  it('later-page failure keeps rows but is marked partial (lower bound)', () => {
    const inbox = M.normalizeFeedbackInbox({
      ...base, data_status: 'partial', truncated: true, count: 1,
      items: [{ id: 'f1', type: 'flag', skill: 'reading', status: 'new' }],
    });
    assert.equal(inbox.status, 'partial');
    assert.equal(inbox.items.length, 1);
    assert.equal(M.normalizeFeedbackInbox({ ...base, data_status: 'partial', truncated: false, count: 0, items: [] }), null);
  });
});


describe('Admin feedback — CSS (real tokens, scoped box-sizing, a11y)', () => {
  it('scopes border-box to .fbx (no global reset) + maps to --av-*', () => {
    assert.match(CSS, /\.fbx,\s*\.fbx \* \{ box-sizing: border-box;/);
    assert.match(CSS, /--fbx-surface:\s*var\(--av-surface-card\)/);
    assert.match(CSS, /--fbx-brand:\s*var\(--av-primary\)/);
  });
  it('terracotta flag scoped token with dark override + reduced-motion + focus', () => {
    assert.match(CSS, /--fbx-flag:\s*#d8643b/);
    assert.match(CSS, /\[data-theme="dark"\]\s*\.fbx\s*\{[\s\S]*?--fbx-flag:\s*#e8794f/);
    assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(CSS, /:focus-visible/);
  });
});
