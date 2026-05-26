/**
 * frontend/tests/sprint-18-3-1-1-overflow.test.mjs — Sprint 18.3.1.1 (overflow hotfix)
 *
 * #301's box-sizing reset was the right pattern but not the whole cause: the
 * cohorts *detail* header was an inline `display:flex; justify-content:
 * space-between` with NO flex-wrap and no min-width:0 on the title side, so a
 * long title/meta pushed "+ Thêm học viên" off-screen (flex overflow, h2/h4).
 * These pin the structural fix: action buttons stay whole, and the header
 * reflows. Visual confirmation is Andy's dogfood (no headless browser).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const front = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');

const CSS = front('css', 'aver-design', 'admin-components.css');
const COHORTS = front('pages', 'admin', 'cohorts', 'index.html');
const ACCESS = front('pages', 'admin', 'access-codes', 'index.html');


describe('Sprint 18.3.1.1 — action buttons stay whole', () => {
  test('shared button classes never wrap/clip their label', () => {
    assert.match(CSS, /\.adm-btn-primary,\s*\.adm-btn-secondary,\s*\.adm-btn-danger\s*\{\s*white-space:\s*nowrap/);
  });
});

describe('Sprint 18.3.1.1 — cohorts detail header reflows (root cause)', () => {
  test('header uses the wrapping .co-detail-head class, not a no-wrap inline flex', () => {
    assert.match(COHORTS, /class="co-header co-detail-head"/);
    assert.doesNotMatch(COHORTS, /style="display:flex;align-items:flex-start;justify-content:space-between/);
  });
  test('.co-detail-head wraps + lets the title side shrink', () => {
    assert.match(COHORTS, /\.co-detail-head\s*\{[\s\S]*?flex-wrap:\s*wrap/);
    assert.match(COHORTS, /\.co-detail-head\s*>\s*div\s*\{\s*min-width:\s*0/);
  });
});

describe('Sprint 18.3.1.1 — access-codes toolbar hardened', () => {
  test('filter bar can shrink so the action button is never pushed off', () => {
    assert.match(ACCESS, /\.ac-filter-bar\s*\{[\s\S]*?min-width:\s*0/);
  });
});

describe('Sprint 18.3.1.1 — no remaining no-wrap space-between header in scope', () => {
  for (const [page, html] of [['cohorts', COHORTS], ['access-codes', ACCESS]]) {
    test(`${page} has no inline space-between flex header without wrap`, () => {
      assert.doesNotMatch(html, /style="[^"]*justify-content:space-between[^"]*"/);
    });
  }
});
