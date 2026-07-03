/**
 * frontend/tests/primitive-families.test.mjs — design-system A5 governance.
 *
 * A FREEZE ratchet on button/modal class-family proliferation. The audit
 * (AUDIT_STRUCTURE_DESIGN_2026-07-03 §A5) found 13 button families
 * (.ac-btn / .adm-btn / .av-button / .aw-btn / …) and 13 modal families
 * (.av-modal / .adm-modal / .wr-modal / …) — the same widget re-implemented over
 * and over. The canonical primitives are `.av-button` and `.av-modal`
 * (css/aver-design/components.css).
 *
 * This test does NOT merge the existing families (that's a per-cluster,
 * visually-verified migration). It FREEZES the set: any NEW `*-btn` / `*-button`
 * / `*-modal` class family that isn't in fixtures/primitive-families.json fails
 * here — new UI must use the canonical `.av-*` primitive. As a legacy family is
 * fully migrated and removed, delete its allowlist entry so the set only shrinks.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_DIR = path.join(__dirname, '..', 'css');

// Match a class-family token at the START of a class selector, e.g.
// `.av-button`, `.ac-btn`, `.wr-modal--open` → family `av-button` / `ac-btn` /
// `wr-modal`. Tailwind's generated file is excluded (utilities, not families).
const FAMILY_RE = /\.([a-z][a-z0-9]*-(?:btn|button|modal))\b/g;
const EXEMPT = new Set(['tailwind.build.css', 'tailwind.inter.css', 'tailwind.src.css']);

function stripComments(t) {
  return t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

function walkCss(dir, out) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkCss(full, out);
    else if (ent.name.endsWith('.css') && !EXEMPT.has(ent.name)) out.push(full);
  }
}

describe('primitive-families freeze (A5 governance)', () => {
  let allow, files;
  before(() => {
    const fx = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'primitive-families.json'), 'utf8'));
    allow = new Set([...fx.button, ...fx.modal]);
    files = [];
    walkCss(CSS_DIR, files);
  });

  test('no NEW button/modal class family beyond the frozen allowlist', () => {
    const found = new Map(); // family -> Set(files)
    for (const f of files) {
      const css = stripComments(readFileSync(f, 'utf8'));
      let m;
      while ((m = FAMILY_RE.exec(css))) {
        const fam = m[1];
        if (!found.has(fam)) found.set(fam, new Set());
        found.get(fam).add(path.basename(f));
      }
    }
    const novel = [...found.keys()].filter((fam) => !allow.has(fam)).sort();
    assert.deepEqual(
      novel, [],
      `\nNew button/modal class families introduced (A5 freeze):\n` +
      novel.map((fam) => `  .${fam}  (in ${[...found.get(fam)].join(', ')})`).join('\n') +
      `\nUse the canonical .av-button / .av-modal primitive instead of a new family,\n` +
      `or — if this is a deliberate new primitive — add it to ` +
      `tests/fixtures/primitive-families.json with justification.\n`,
    );
  });

  test('allowlist has no stale entries (every frozen family still exists)', () => {
    const present = new Set();
    for (const f of files) {
      const css = stripComments(readFileSync(f, 'utf8'));
      let m;
      while ((m = FAMILY_RE.exec(css))) present.add(m[1]);
    }
    const stale = [...allow].filter((fam) => !present.has(fam)).sort();
    assert.deepEqual(
      stale, [],
      `Frozen families no longer in the CSS — a migration removed them; ` +
      `delete these from primitive-families.json so the freeze reflects reality: ${stale.join(', ')}`,
    );
  });
});
