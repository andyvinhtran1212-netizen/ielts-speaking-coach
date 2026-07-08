/**
 * frontend/tests/sprint-18-3-1-polish.test.mjs — Sprint 18.3.1 (Visual Polish)
 *
 * Andy dogfood (2026-05-26) reported overflow on access-codes + dashboard. Root
 * cause: the admin pages never set `box-sizing: border-box` (the main-app pages
 * do, per-page), so width:100% + padding overflowed. These sentinels pin the
 * structural fix + that every in-scope admin page consumes the shared CSS that
 * carries it. Visual parity itself is confirmed by Andy's dogfood (PF-7).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const front = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');

const CSS = front('css', 'aver-design', 'admin-components.css');
// dashboard-consolidation — the ops Dashboard (its .db-card KPI tiles) merged
// into the unified Tổng quan page.
const DASH = front('pages', 'admin', 'index.html');
// Pages expected to consume admin-components.css (and thus the box-sizing reset).
// Students is excluded: Tailwind's preflight already sets border-box, and it
// migrates fully in Sprint 18.3.2. 'dashboard' dropped: it's now a redirect
// stub (the ops metrics live on the unified index page, which links the CSS).
const LINKED_PAGES = ['access-codes', 'cohorts', 'foot-traffic', 'usage', 'system'];


describe('Sprint 18.3.1 — overflow root-cause fix', () => {
  test('admin-components.css applies the border-box reset', () => {
    assert.match(CSS, /\*,\s*\*::before,\s*\*::after\s*\{\s*box-sizing:\s*border-box/);
  });
  test('table wrap is bounded so wide tables scroll, never push the page', () => {
    assert.match(CSS, /\.adm-table-wrap[\s\S]*?max-width:\s*100%/);
  });
  test('dashboard grid tile can shrink (min-width:0) — long numbers do not clip', () => {
    assert.match(DASH, /\.db-card\s*\{[\s\S]*?min-width:\s*0/);
  });
});

describe('Sprint 18.3.1 — every in-scope admin page consumes the shared CSS', () => {
  for (const page of LINKED_PAGES) {
    test(`${page} links admin-components.css`, () => {
      assert.match(front('pages', 'admin', page, 'index.html'), /\/css\/aver-design\/admin-components\.css/);
    });
  }
});

describe('Sprint 18.3.1 — Pattern #25/#26 preserved', () => {
  test('shared CSS stays token-driven (no hardcoded hex)', () => {
    assert.match(CSS, /--av-/);
    assert.doesNotMatch(CSS, /:\s*#[0-9a-fA-F]{3,6}\b/);
  });
});
