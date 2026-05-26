/**
 * frontend/tests/sprint-18-3-1-2-toolbar.test.mjs — Sprint 18.3.1.2 (toolbar overflow)
 *
 * Pattern #42: the commission's premise ("`.ac-toolbar` missing flex-wrap") was
 * empirically FALSE — `.ac-toolbar` already wraps. The real cause was a
 * non-shrinkable child: `.ac-filter { min-width:160px }` (hard floor) + filter
 * controls with no `min-width:0`, so a long #filter-cohort <select> option
 * widened the row past the toolbar and pushed "+ Tạo mã mới" off-screen. These
 * pin the actual fix (shrinkable filter columns + capped controls). Visual
 * confirmation is Andy's dogfood (no headless browser).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const front = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');

const ACCESS = front('pages', 'admin', 'access-codes', 'index.html');
const USAGE = front('pages', 'admin', 'usage', 'index.html');
const COHORTS = front('pages', 'admin', 'cohorts', 'index.html');


describe('Sprint 18.3.1.2 — Pattern #42: premise check', () => {
  // Sprint 18.3.1.3 replaced the single-row toolbar with two stacked rows, so
  // `.ac-toolbar` is now a column (no flex-wrap). The filters still wrap inside
  // their own row — that is the surviving "it already wraps" truth.
  test('filter row wraps internally (filters never overflow)', () => {
    assert.match(ACCESS, /\.ac-filter-bar\s*\{[\s\S]*?flex-wrap:\s*wrap/);
  });
});

describe('Sprint 18.3.1.2 — access-codes real fix (shrinkable filters + capped controls)', () => {
  test('.ac-filter can shrink (no hard min-width floor)', () => {
    assert.match(ACCESS, /\.ac-filter\s*\{[\s\S]*?flex:\s*1\s*1\s*160px[\s\S]*?min-width:\s*0/);
  });
  test('filter controls never exceed their column', () => {
    assert.match(ACCESS, /\.ac-filter select,\s*\.ac-filter input\[type="search"\]\s*\{[\s\S]*?min-width:\s*0[\s\S]*?max-width:\s*100%/);
  });
});

describe('Sprint 18.3.1.2 — same control-cap applied to other filter patterns (PF-3)', () => {
  test('usage search control capped', () => {
    assert.match(USAGE, /\.us-filter input\[type="search"\]\s*\{[\s\S]*?min-width:\s*0[\s\S]*?max-width:\s*100%/);
  });
  test('cohorts filter control capped', () => {
    assert.match(COHORTS, /\.co-filter select\s*\{[\s\S]*?min-width:\s*0[\s\S]*?max-width:\s*100%/);
  });
});
