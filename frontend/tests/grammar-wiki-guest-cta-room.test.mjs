/**
 * PC-J13B — the fixed guest CTA bar (#guest-cta-bar) shows at every width,
 * but U-05 reserved room for it at the end of the article only inside the
 * phone media query. At 1280×800 the bar (top 739px) covered the
 * "Bài trước / Bài tiếp" links (#prev-next, bottom 768px) by about 29px.
 *
 * The browser measurement lives in tooling/verify-mobile-layout-flow.mjs;
 * this pins the rule's position so it cannot drift back into a media query.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const css = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public/css/grammar-wiki.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

const RULE = /body:has\(#guest-cta-bar:not\(\.hidden\)\)\s+#article-container\s*\{\s*padding-bottom:\s*([\d.]+)rem;?\s*\}/g;

// Brace depth of `index` inside the stylesheet: 0 = top level.
const depthAt = (index) => {
  let depth = 0;
  for (const ch of css.slice(0, index)) {
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
  }
  return depth;
};

test('guest CTA room is reserved at every width, not only on phones', () => {
  const matches = [...css.matchAll(RULE)];
  assert.equal(matches.length, 1, 'expected exactly one #article-container guest-bar padding rule');
  assert.equal(depthAt(matches[0].index), 0,
    'the guest-bar padding rule must sit outside any @media block — the bar is fixed on desktop too');
});

test('reserved room covers the uncompacted desktop bar (~61px: py-3 + 36px button + border)', () => {
  const [match] = [...css.matchAll(RULE)];
  assert.ok(Number(match[1]) * 16 >= 61, `${match[1]}rem is shorter than the desktop bar`);
});
