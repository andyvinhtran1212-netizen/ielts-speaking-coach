/**
 * frontend/tests/sprint-17-3-cohorts.test.mjs — Sprint 17.3 (Direction C)
 *
 * Source-scan of the cohort management UI wiring + nav graduation. The cohort
 * controller reuses the (already unit-tested) Sprint 17.2 usage-util formatters,
 * so this file pins the wiring + Pattern #26 rather than re-testing pure logic.
 * No headless browser (project source-scan convention).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Confirms the reused util still exports what the controller imports.
import { usdLabel, countLabel, lastActiveLabel } from '../js/admin-usage-util.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const front = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const CTRL = front('js', 'admin-cohorts.js');
const CHROME = front('js', 'components', 'aver-admin-chrome.js');
const HTML = front('pages', 'admin', 'cohorts', 'index.html');


describe('Sprint 17.3 — reused usage-util still exports formatters', () => {
  test('usdLabel / countLabel / lastActiveLabel are callable', () => {
    assert.strictEqual(typeof usdLabel, 'function');
    assert.strictEqual(countLabel(null), '—');
    assert.strictEqual(lastActiveLabel(null), '—');
  });
});

describe('Sprint 17.3 — admin-cohorts.js wiring', () => {
  test('imports the usage-util formatters', () => {
    assert.match(CTRL, /import\s*\{[^}]*usdLabel[^}]*\}\s*from\s*'\.\/admin-usage-util\.js'/);
  });
  test('branches on ?cohort_id (member roster) vs default (list)', () => {
    assert.match(CTRL, /URLSearchParams\(window\.location\.search\)\.get\('cohort_id'\)/);
    assert.match(CTRL, /\/admin\/cohorts\/'\s*\+\s*encodeURIComponent\(cohortId\)\s*\+\s*'\/members/);
    assert.match(CTRL, /\/admin\/cohorts/);
  });
  test('create + archive/restore wired (PATCH is_active)', () => {
    assert.match(CTRL, /api\.post\('\/admin\/cohorts'/);
    assert.match(CTRL, /is_active:\s*isActive/);
    assert.match(CTRL, /data-action="archive"|data-action="restore"/);
  });
  test('renders member roster with escaped email + formatters', () => {
    assert.match(CTRL, /esc\(m\.email\)/);
    assert.match(CTRL, /countLabel\(m\.sessions\)/);
    assert.match(CTRL, /usdLabel\(m\.ai_cost_usd\)/);
  });
  test('Pattern #26 — no inline color/bg/hex literals', () => {
    assert.doesNotMatch(CTRL, /style\s*=\s*["'][^"']*color\s*:/);
    assert.doesNotMatch(CTRL, /style\s*=\s*["'][^"']*background/);
    assert.doesNotMatch(CTRL, /rgba\(\s*\d+\s*,/);
  });
});

describe('Sprint 17.3 — integrations', () => {
  test('nav graduated cohorts (PHASE_B_SECTIONS now empty)', () => {
    assert.match(CHROME, /PHASE_B_SECTIONS\s*=\s*new Set\(\[\]\)/);
    assert.doesNotMatch(CHROME, /new Set\(\[\s*'cohorts'/);
  });
  test('page has list + detail views, member table, create modal', () => {
    assert.match(HTML, /id="view-list"/);
    assert.match(HTML, /id="view-detail"/);
    assert.match(HTML, /id="members-tbody"/);
    assert.match(HTML, /id="cohort-modal-backdrop"/);
  });
});
