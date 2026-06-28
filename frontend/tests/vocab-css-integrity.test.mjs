/**
 * frontend/tests/vocab-css-integrity.test.mjs
 *
 * Guards vocabulary.css against the merge corruption that broke
 * #vocab-topics in production: two PRs edited the same .vtc-actions /
 * .vtc-act block (flex vs grid) and the merge left duplicate `display`
 * declarations + a malformed `.selector { .selector { … }` nesting, which
 * a browser CSS parser drops — rendering the topic cards unstyled.
 *
 * These are cheap structural checks (not a full CSS parse) that catch that
 * exact failure shape on any future merge.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(__dirname, '..', 'css', 'vocabulary.css'), 'utf8');

describe('vocabulary.css is well-formed (merge-corruption guard)', () => {
  test('braces are balanced', () => {
    const opens = (CSS.match(/\{/g) || []).length;
    const closes = (CSS.match(/\}/g) || []).length;
    assert.equal(opens, closes, 'unbalanced { } in vocabulary.css');
  });

  test('.vtc-actions declares exactly one display', () => {
    const m = CSS.match(/\.vtc-actions\s*\{[^}]*\}/);
    assert.ok(m, '.vtc-actions rule not found');
    const displays = (m[0].match(/display\s*:/g) || []).length;
    assert.equal(displays, 1, `.vtc-actions has ${displays} display declarations (merge artifact)`);
  });

  test('no malformed nesting — a selector never opens directly inside a .vtc-act rule', () => {
    // The corruption looked like: `.vtc-act--study, .vtc-act--ex {  .vtc-act--browse { … }`
    assert.doesNotMatch(CSS, /\.vtc-act[^{}]*\{\s*\.[a-z-]+[^{}]*\{/);
  });
});
