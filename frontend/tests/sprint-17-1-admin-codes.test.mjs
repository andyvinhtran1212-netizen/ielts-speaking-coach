/**
 * frontend/tests/sprint-17-1-admin-codes.test.mjs — Sprint 17.1 (Direction A)
 *
 * Functional tests of the pure admin-codes-util helpers (quota label, search,
 * sort), plus source-scan of admin-access-codes.js wiring (renders assigned
 * email + quota, lookup-failure warning, no inline styles) and the index.html
 * columns/search. No headless browser (project source-scan convention).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { quotaLabel, codeMatchesSearch, compareCodesBy, statusRank }
  from '../js/admin-codes-util.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const front = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const CTRL = front('js', 'admin-access-codes.js');
const HTML = front('pages', 'admin', 'access-codes', 'index.html');


// ── quotaLabel ──────────────────────────────────────────────────────────────
describe('Sprint 17.1 — quotaLabel', () => {
  test('with limit → used/limit · còn remaining', () => {
    assert.strictEqual(quotaLabel({ used: 3, limit: 10, remaining: 7, limit_type: 'per_user_via_code' }),
      '3/10 · còn 7');
  });
  test('unlimited → used / ∞', () => {
    assert.strictEqual(quotaLabel({ used: 4, limit: null, limit_type: 'unlimited' }), '4 / ∞');
  });
  test('missing quota → empty string (graceful)', () => {
    assert.strictEqual(quotaLabel(null), '');
    assert.strictEqual(quotaLabel(undefined), '');
  });
});

// ── codeMatchesSearch ─────────────────────────────────────────────────────────
describe('Sprint 17.1 — codeMatchesSearch', () => {
  const code = { code: 'ABCD-1234', assigned_users: [{ email: 'student@example.com' }] };
  test('empty query matches all', () => assert.ok(codeMatchesSearch(code, '')));
  test('matches code value (case-insensitive)', () => assert.ok(codeMatchesSearch(code, 'abcd')));
  test('matches assigned email', () => assert.ok(codeMatchesSearch(code, 'student@')));
  test('no match → false', () => assert.strictEqual(codeMatchesSearch(code, 'zzz'), false));
  test('no assigned_users → still searchable by code', () =>
    assert.ok(codeMatchesSearch({ code: 'XY-1' }, 'xy')));
});

// ── compareCodesBy + statusRank ───────────────────────────────────────────────
describe('Sprint 17.1 — compareCodesBy', () => {
  const a = { created_at: '2026-01-01T00:00:00Z', expires_at: null, is_active: true };
  const b = { created_at: '2026-03-01T00:00:00Z', expires_at: '2026-04-01T00:00:00Z', is_revoked: true };

  test('created_at desc → newest first', () => {
    const s = [a, b].sort(compareCodesBy('created_at', 'desc'));
    assert.strictEqual(s[0], b);
  });
  test('created_at asc → oldest first', () => {
    const s = [a, b].sort(compareCodesBy('created_at', 'asc'));
    assert.strictEqual(s[0], a);
  });
  test('expires_at: null sorts last regardless of direction', () => {
    assert.strictEqual([a, b].sort(compareCodesBy('expires_at', 'asc'))[1], a);
    assert.strictEqual([a, b].sort(compareCodesBy('expires_at', 'desc'))[1], a);
  });
  test('status rank: active < locked < revoked', () => {
    assert.strictEqual(statusRank({ is_active: true }), 0);
    assert.strictEqual(statusRank({ is_active: false }), 1);
    assert.strictEqual(statusRank({ is_revoked: true }), 2);
  });
});

// ── Controller wiring (source-scan, Pattern #34 / #26) ───────────────────────
describe('Sprint 17.1 — admin-access-codes.js wiring', () => {
  test('imports the pure util helpers', () => {
    assert.match(CTRL, /import\s*\{[^}]*quotaLabel[^}]*\}\s*from\s*'\.\/admin-codes-util\.js'/);
  });
  test('renders assigned email + quota + lookup-failure + empty placeholder', () => {
    assert.match(CTRL, /assignedCell/);
    assert.match(CTRL, /u\.email/);
    assert.match(CTRL, /quotaLabel\(u\.quota\)/);
    assert.match(CTRL, /association_lookup_failed/);
    assert.match(CTRL, /⚠ lookup failed/);
    assert.match(CTRL, /Chưa gán/);
  });
  test('escapes email (no raw interpolation of user data into the new cell)', () => {
    assert.match(CTRL, /esc\(u\.email\)/);
  });
  test('wires client-side search + sortable headers', () => {
    assert.match(CTRL, /codeMatchesSearch\(c, _search\)/);
    assert.match(CTRL, /compareCodesBy\(_sort\.field, _sort\.order\)/);
    assert.match(CTRL, /th\[data-sort\]/);
  });
  test('Pattern #26 — no inline style/color/bg literals in the controller', () => {
    assert.doesNotMatch(CTRL, /style\s*=\s*["'][^"']*color\s*:/);
    assert.doesNotMatch(CTRL, /style\s*=\s*["'][^"']*background/);
    assert.doesNotMatch(CTRL, /rgba\(\s*\d+\s*,/);
  });
});

describe('Sprint 17.1 — index.html columns + search', () => {
  test('has the search input', () => assert.match(HTML, /id="search-input"/));
  test('has Người dùng column + sortable headers', () => {
    assert.match(HTML, /Người dùng/);
    assert.match(HTML, /data-sort="status"/);
    assert.match(HTML, /data-sort="expires_at"/);
    assert.match(HTML, /data-sort="created_at"/);
  });
});
