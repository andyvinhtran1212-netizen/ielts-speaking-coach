/**
 * frontend/tests/sprint-17-2-usage.test.mjs — Sprint 17.2 (Direction B)
 *
 * Functional tests of admin-usage-util helpers (cost/count/date format, search,
 * sort) + source-scan of admin-usage.js wiring, the codes-UI drill link, and the
 * nav activation. No headless browser (project source-scan convention).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { usdLabel, countLabel, lastActiveLabel, userMatchesSearch, compareUsersBy }
  from '../js/admin-usage-util.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const front = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const USAGE = front('js', 'admin-usage.js');
const CODES = front('js', 'admin-access-codes.js');
const CHROME = front('js', 'components', 'aver-admin-chrome.js');
const HTML = front('pages', 'admin', 'usage', 'index.html');


// ── util ─────────────────────────────────────────────────────────────────────
describe('Sprint 17.2 — usage util', () => {
  test('usdLabel: null → — ; 0 → $0 ; value → $x.xxxx', () => {
    assert.strictEqual(usdLabel(null), '—');         // degraded sub-query (Pattern #29)
    assert.strictEqual(usdLabel(0), '$0');
    assert.strictEqual(usdLabel(0.03), '$0.0300');
  });
  test('countLabel: null → — ; n → n', () => {
    assert.strictEqual(countLabel(null), '—');
    assert.strictEqual(countLabel(5), '5');
  });
  test('lastActiveLabel: missing → —', () => {
    assert.strictEqual(lastActiveLabel(null), '—');
    assert.notStrictEqual(lastActiveLabel('2026-01-05T00:00:00Z'), '—');
  });
  test('userMatchesSearch: name or email, case-insensitive', () => {
    const u = { name: 'Nguyen', email: 'a@x.com' };
    assert.ok(userMatchesSearch(u, 'nguy'));
    assert.ok(userMatchesSearch(u, 'a@x'));
    assert.strictEqual(userMatchesSearch(u, 'zzz'), false);
    assert.ok(userMatchesSearch(u, ''));
  });
  test('compareUsersBy sessions desc → nulls last', () => {
    const rows = [{ sessions: 2 }, { sessions: null }, { sessions: 9 }];
    const sorted = rows.slice().sort(compareUsersBy('sessions', 'desc'));
    assert.strictEqual(sorted[0].sessions, 9);
    assert.strictEqual(sorted[2].sessions, null);   // degraded value never on top
  });
  test('compareUsersBy name uses email fallback', () => {
    const rows = [{ email: 'b@x' }, { name: 'Anna' }];
    assert.strictEqual(rows.slice().sort(compareUsersBy('name', 'asc'))[0].name, 'Anna');
  });
});


// ── controller wiring (source-scan) ──────────────────────────────────────────
describe('Sprint 17.2 — admin-usage.js wiring', () => {
  test('imports the util helpers', () => {
    assert.match(USAGE, /import\s*\{[^}]*usdLabel[^}]*\}\s*from\s*'\.\/admin-usage-util\.js'/);
  });
  test('branches on ?code_id (per-code) vs default (per-user list)', () => {
    assert.match(USAGE, /URLSearchParams\(window\.location\.search\)\.get\('code_id'\)/);
    assert.match(USAGE, /\/admin\/usage\/users/);
    assert.match(USAGE, /\/admin\/access-codes\/'\s*\+\s*encodeURIComponent\(codeId\)\s*\+\s*'\/usage/);
  });
  test('escapes user-derived strings; Pattern #26 no inline color/bg', () => {
    assert.match(USAGE, /esc\(/);
    assert.doesNotMatch(USAGE, /style\s*=\s*["'][^"']*color\s*:/);
    assert.doesNotMatch(USAGE, /style\s*=\s*["'][^"']*background/);
    assert.doesNotMatch(USAGE, /rgba\(\s*\d+\s*,/);
  });
  test('handles empty states (Pattern #29)', () => {
    assert.match(USAGE, /usage-empty/);
    assert.match(USAGE, /code-usage-empty/);
  });
});

describe('Sprint 17.2 — integrations', () => {
  test('codes UI drills into per-code usage via ?code_id', () => {
    assert.match(CODES, /\/pages\/admin\/usage\/index\.html\?code_id=\$\{c\.id\}/);
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
