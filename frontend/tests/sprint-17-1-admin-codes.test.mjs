/**
 * frontend/tests/sprint-17-1-admin-codes.test.mjs — Sprint 17.1 (Direction A)
 *
 * LEGACYJS-0075 W3a: `public/js/admin-codes-util.js` and
 * `admin-access-codes.js` are retired. The same helpers live in
 * `lib/admin-users-model.mjs` (`quotaLabel`, `selectCodes`, `codeStatusRank`)
 * and the wiring in the Next codes panel; this file now pins those.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { quotaLabel, selectCodes, codeStatusRank } from '../lib/admin-users-model.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const front = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const CTRL = front('app', '(authed-admin)', '(users)', 'admin', 'users', 'admin-access-codes-panel.tsx');
const HTML = front('pages', 'admin', 'access-codes', 'index.html');

const searchCodes = (codes, search) => selectCodes(codes, { search }, { field: 'created_at', order: 'desc' });
const sortCodes = (codes, field, order) => selectCodes(codes, {}, { field, order });


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

// ── search (selectCodes) ─────────────────────────────────────────────────────
describe('Sprint 17.1 — code search', () => {
  const code = { code: 'ABCD-1234', assigned_users: [{ email: 'student@example.com' }] };
  test('empty query matches all', () => assert.deepStrictEqual(searchCodes([code], ''), [code]));
  test('matches code value (case-insensitive)', () => assert.deepStrictEqual(searchCodes([code], 'abcd'), [code]));
  test('matches assigned email', () => assert.deepStrictEqual(searchCodes([code], 'student@'), [code]));
  test('no match → empty', () => assert.deepStrictEqual(searchCodes([code], 'zzz'), []));
  test('no assigned users → still searchable by code', () => {
    const bare = { code: 'XY-1', assigned_users: [] };
    assert.deepStrictEqual(searchCodes([bare], 'xy'), [bare]);
  });
});

// ── sort (selectCodes) + codeStatusRank ──────────────────────────────────────
describe('Sprint 17.1 — code sort', () => {
  const a = { code: 'A', assigned_users: [], created_at: '2026-01-01T00:00:00Z', expires_at: null, is_active: true };
  const b = { code: 'B', assigned_users: [], created_at: '2026-03-01T00:00:00Z', expires_at: '2026-04-01T00:00:00Z', is_active: false };

  test('created_at desc → newest first', () => {
    assert.strictEqual(sortCodes([a, b], 'created_at', 'desc')[0], b);
  });
  test('created_at asc → oldest first', () => {
    assert.strictEqual(sortCodes([a, b], 'created_at', 'asc')[0], a);
  });
  test('expires_at: null sorts last regardless of direction', () => {
    assert.strictEqual(sortCodes([a, b], 'expires_at', 'asc')[1], a);
    assert.strictEqual(sortCodes([a, b], 'expires_at', 'desc')[1], a);
  });
  test('status rank: active < locked < revoked', () => {
    assert.strictEqual(codeStatusRank({ is_active: true }), 0);
    assert.strictEqual(codeStatusRank({ is_active: false }), 1);
    assert.strictEqual(codeStatusRank({ is_revoked: true }), 2);
  });
});

// ── Panel wiring (source-scan) ───────────────────────────────────────────────
describe('Sprint 17.1 — codes panel wiring', () => {
  test('imports the model helpers', () => {
    assert.match(CTRL, /import \{[^}]*quotaLabel[^}]*selectCodes[^}]*\} from '@\/lib\/admin-users-model\.mjs'/);
  });
  test('renders assigned email + quota + lookup-failure + empty placeholder', () => {
    assert.match(CTRL, /user\.email/);
    assert.match(CTRL, /quotaLabel\(user\.quota\)/);
    assert.match(CTRL, /association_lookup_failed/);
    assert.match(CTRL, /⚠ lookup failed/);
    assert.match(CTRL, /Chưa gán/);
  });
  test('never injects HTML (React escapes the email)', () => {
    assert.doesNotMatch(CTRL, /dangerouslySetInnerHTML|\.innerHTML/);
  });
  test('wires client-side search + sort through selectCodes', () => {
    // #2644: selectCodes sorts and searches; the ledger state filters after it.
    assert.match(CTRL, /selectCodes\(codes, \{ type, status: 'all', cohort, search \}, sort\)/);
    assert.match(CTRL, /ledger\.get\(code\.id\)\?\.state === status/);
    assert.match(CTRL, /placeholder="Mã hoặc email…"/);
  });
  test('Pattern #26 — no inline color/background literals in the panel', () => {
    assert.doesNotMatch(CTRL, /style=\{\{[^}]*color\s*:/);
    assert.doesNotMatch(CTRL, /style=\{\{[^}]*background/);
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
