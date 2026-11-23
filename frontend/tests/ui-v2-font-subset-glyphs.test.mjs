/**
 * ui-v2-font-subset-glyphs.test.mjs — Q46 (CR-2409-R2 nit).
 *
 * The root layout loads its fonts with `subsets: ['latin', 'vietnamese']`.
 * A v2 component under `components/ui/` that renders a character outside
 * those subsets (an arrow such as U+2190/U+2192, a maths symbol, …) falls
 * back to the machine's system font, so the baseline screenshots start to
 * depend on the runner. Such glyphs must be drawn with `<Icon>` (SVG) or the
 * subset must be widened deliberately.
 *
 * Ranges mirror the Google Fonts `latin` and `vietnamese` unicode-range sets.
 * Comments are stripped first: a `→` in JSDoc is never rendered.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(__dirname, '..');
const UI_DIR = join(FRONTEND, 'components', 'ui');

const LATIN = [
  [0x0000, 0x00ff], [0x0131, 0x0131], [0x0152, 0x0153], [0x02bb, 0x02bc],
  [0x02c6, 0x02c6], [0x02da, 0x02da], [0x02dc, 0x02dc], [0x0304, 0x0304],
  [0x0308, 0x0308], [0x0329, 0x0329], [0x2000, 0x206f], [0x20ac, 0x20ac],
  [0x2122, 0x2122], [0x2191, 0x2191], [0x2193, 0x2193], [0x2212, 0x2212],
  [0x2215, 0x2215], [0xfeff, 0xfeff], [0xfffd, 0xfffd],
];
const VIETNAMESE = [
  [0x0102, 0x0103], [0x0110, 0x0111], [0x0128, 0x0129], [0x0168, 0x0169],
  [0x01a0, 0x01a1], [0x01af, 0x01b0], [0x0300, 0x0301], [0x0303, 0x0304],
  [0x0308, 0x0309], [0x0323, 0x0323], [0x0329, 0x0329], [0x1ea0, 0x1ef9],
  [0x20ab, 0x20ab],
];
const ALLOWED = [...LATIN, ...VIETNAMESE];
const inSubset = (cp) => ALLOWED.some(([lo, hi]) => cp >= lo && cp <= hi);

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|mjs|js)$/.test(name) ? [path] : [];
  });
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

test('root layout still loads only the latin + vietnamese subsets', () => {
  const layout = readFileSync(join(FRONTEND, 'app', 'layout.tsx'), 'utf8');
  const subsets = [...layout.matchAll(/subsets:\s*\[([^\]]*)\]/g)].map((m) => m[1].replace(/\s/g, ''));
  assert.ok(subsets.length > 0, 'expected next/font subsets in app/layout.tsx');
  for (const s of subsets) {
    assert.equal(s, "'latin','vietnamese'", 'subset changed: update the ranges in this test to match');
  }
});

test('v2 components render no glyph outside the loaded font subsets', () => {
  const offenders = [];
  for (const file of sourceFiles(UI_DIR)) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const ch of new Set(code)) {
      const cp = ch.codePointAt(0);
      if (!inSubset(cp)) {
        offenders.push(`${relative(FRONTEND, file)}: U+${cp.toString(16).toUpperCase().padStart(4, '0')} "${ch}"`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'use <Icon> (SVG) instead of these characters, or widen the font subset deliberately');
});
