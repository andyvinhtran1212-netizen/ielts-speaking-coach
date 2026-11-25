/**
 * frontend/tests/sprint-17-2-usage.test.mjs — Sprint 17.2 (Direction B)
 *
 * Functional tests of the usage model helpers (cost/count/date format, search,
 * sort) + source-scan of the Next /admin/usage wiring, the codes-UI drill link, and the
 * nav activation. No headless browser (project source-scan convention).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// LEGACYJS-0075 W4a: admin-usage-util.js + admin-usage.js are retired; the Next
// /admin/usage owner and lib/admin-usage-model.mjs hold these invariants.
import {
  formatUsageCost, formatUsageCount, formatUsageDate, filterUsageRows, sortUsageRows,
} from '../lib/admin-usage-model.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const front = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const USAGE = front('app', '(authed-admin)', '(usage)', 'admin', 'usage', 'admin-usage.tsx');
// LEGACYJS-0075 W3a: the codes table is the Next panel now.
const CODES = front('app', '(authed-admin)', '(users)', 'admin', 'users', 'admin-access-codes-panel.tsx');
const CHROME = front('js', 'components', 'aver-admin-chrome.js');
const HTML = front('pages', 'admin', 'usage', 'index.html');


// ── model ────────────────────────────────────────────────────────────────────
describe('Sprint 17.2 — usage model', () => {
  test('cost: null → — ; 0 → $0.0000 ; value → $x.xxxx', () => {
    assert.strictEqual(formatUsageCost(null), '—');         // degraded sub-query (Pattern #29)
    assert.strictEqual(formatUsageCost(0), '$0.0000');
    assert.strictEqual(formatUsageCost(0.03), '$0.0300');
  });
  test('count: null → — ; n → n', () => {
    assert.strictEqual(formatUsageCount(null), '—');
    assert.strictEqual(formatUsageCount(5), '5');
  });
  test('last active: missing → —', () => {
    assert.strictEqual(formatUsageDate(null), '—');
    assert.notStrictEqual(formatUsageDate('2026-01-05T00:00:00Z'), '—');
  });
  test('search: name or email, case-insensitive', () => {
    const rows = [{ name: 'Nguyen', email: 'a@x.com', userId: 'u1' }];
    assert.strictEqual(filterUsageRows(rows, 'nguy').length, 1);
    assert.strictEqual(filterUsageRows(rows, 'A@X').length, 1);
    assert.strictEqual(filterUsageRows(rows, 'zzz').length, 0);
    assert.strictEqual(filterUsageRows(rows, '').length, 1);
  });
  test('sort sessions desc → nulls last', () => {
    const sorted = sortUsageRows([{ sessions: 2 }, { sessions: null }, { sessions: 9 }], 'sessions');
    assert.strictEqual(sorted[0].sessions, 9);
    assert.strictEqual(sorted[2].sessions, null);   // degraded value never on top
  });
  test('sort name uses email fallback', () => {
    const sorted = sortUsageRows([{ email: 'b@x', userId: 'u2' }, { name: 'Anna', userId: 'u1' }], 'name');
    assert.strictEqual(sorted[0].name, 'Anna');
  });
});


// ── controller wiring (source-scan) ──────────────────────────────────────────
describe('Sprint 17.2 — Next /admin/usage wiring', () => {
  test('uses the model helpers', () => {
    assert.match(USAGE, /import \{[^}]*formatUsageCost[^}]*\} from '@\/lib\/admin-usage-model\.mjs'/);
  });
  test('branches on ?code_id (per-code) vs default (per-user list)', () => {
    assert.match(USAGE, /searchParams\?\.get\('code_id'\)/);
    assert.match(USAGE, /'\/admin\/usage\/users'/);
    assert.match(USAGE, /`\/admin\/access-codes\/\$\{encodeURIComponent\(codeId\)\}\/usage`/);
  });
  test('renders through React (no injected HTML); Pattern #26 no inline color/bg', () => {
    assert.doesNotMatch(USAGE, /dangerouslySetInnerHTML/);
    assert.doesNotMatch(USAGE, /style=\{\{[^}]*color/);
    assert.doesNotMatch(USAGE, /style=\{\{[^}]*background/);
    assert.doesNotMatch(USAGE, /rgba\(\s*\d+\s*,/);
  });
  test('handles empty states for both views (Pattern #29)', () => {
    assert.match(USAGE, /'Chưa có tài khoản nào'/);
    assert.match(USAGE, /'Mã chưa có người dùng đang gắn'/);
  });
});

describe('Sprint 17.2 — integrations', () => {
  test('codes UI drills into per-code usage via ?code_id', () => {
    assert.match(CODES, /href=\{`\/admin\/usage\?code_id=\$\{encodeURIComponent\(code\.id\)\}`\}/);
  });
  test('nav activated usage (not in PHASE_B_SECTIONS)', () => {
    // Robust to other sections also graduating (e.g. cohorts in 17.3): assert
    // `usage` is absent from the set rather than pinning exact contents.
    const m = CHROME.match(/PHASE_B_SECTIONS\s*=\s*new Set\(\[([^\]]*)\]\)/);
    assert.ok(m, 'PHASE_B_SECTIONS not found');
    assert.doesNotMatch(m[1], /'usage'/);
  });
  test('usage page has both views + sortable headers', () => {
    assert.match(HTML, /id="view-users"/);
    assert.match(HTML, /id="view-code"/);
    assert.match(HTML, /data-sort="sessions"/);
    assert.match(HTML, /id="admin-usage\.js"|admin-usage\.js/);
  });
});
