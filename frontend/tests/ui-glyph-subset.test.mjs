/**
 * frontend/tests/ui-glyph-subset.test.mjs — v2 components draw no glyph the
 * loaded font subset lacks (CR-2409-R2 nit, Q46).
 *
 * Source Sans 3 is loaded as latin / latin-ext / vietnamese. Arrows, maths
 * operators, technical and geometric symbols, dingbats and emoji are outside
 * that subset, so the browser falls back to a system font: the look then
 * depends on the machine and visual baselines drift (run 44715027101, three
 * breadcrumb/tabs shots ~1 % off). Draw those with an Icon (SVG) instead.
 * Comments are ignored; ‹ › (U+2039/U+203A) are in the subset and allowed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const UI = path.join(FRONTEND, 'components', 'ui');

// U+2190–21FF arrows, U+2200–23FF maths + technical, U+25A0–27BF geometric,
// misc symbols and dingbats, U+2B00–2BFF misc arrows, emoji planes.
export const OUTSIDE_SUBSET = /[←-⇿∀-⏿■-➿⬀-⯿]|[\u{1F300}-\u{1FAFF}]/u;

/** Drop block and line comments; keep strings (a URL's `//` stays). */
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(tsx?|css)$/.test(name) ? [full] : [];
  });
}

test('v2 components use no glyph outside the loaded font subset', () => {
  const hits = [];
  for (const file of files(UI)) {
    stripComments(readFileSync(file, 'utf8')).split('\n').forEach((line, i) => {
      const m = line.match(OUTSIDE_SUBSET);
      if (m) {
        const cp = m[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
        hits.push(`${path.relative(FRONTEND, file)}:${i + 1} U+${cp}`);
      }
    });
  }
  assert.deepEqual(hits, [], 'draw these with an Icon (SVG), or widen the font subset');
});

test('the guard catches rendered text and ignores comments', () => {
  assert.ok(OUTSIDE_SUBSET.test(stripComments('<span>Next →</span>')));
  assert.ok(OUTSIDE_SUBSET.test(stripComments("const label = '✓ Done';")));
  assert.ok(OUTSIDE_SUBSET.test(stripComments('<b>😀</b>')));
  assert.ok(!OUTSIDE_SUBSET.test(stripComments('/** ←/→ move */\n// a → b\nconst x = 1;')));
  assert.ok(!OUTSIDE_SUBSET.test(stripComments('<a href="https://x.test/a">‹ Back</a>')));
  assert.ok(!OUTSIDE_SUBSET.test('Tiếng Việt – “ngoặc” … ₫ €'));
});
