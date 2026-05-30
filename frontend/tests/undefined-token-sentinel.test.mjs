/**
 * frontend/tests/undefined-token-sentinel.test.mjs — Lesson 16 governance.
 *
 * Flags any `var(--av-*)` reference whose token is NOT defined in the canonical
 * token source (tokens.css). `var(--undefined)` fails SILENTLY — the property
 * is dropped (or the fallback masks it), so the drift is invisible until a
 * manual audit. This bug class cost three separate sprints to find ad-hoc:
 *   • --av-color-error  (#360, danger button → muted text)
 *   • --av-critical     (#362, reading error text → hardcoded red, no dark)
 *   • --av-space-5      (#366, dashboard tiles → no padding; scale skips 5)
 * spanning colour AND spacing. This makes the token contract enforceable
 * (Lesson 4: claim → enforced) and guards the class forever.
 *
 * A fallback does NOT excuse a missing token: `var(--av-x, red)` with an
 * undefined --av-x is exactly the --av-critical bug (the fallback hid the
 * drift), so it is flagged too.
 *
 * Scope: the --av-* design-system namespace. Scans .css + .html (inline
 * <style> and style="…") + .js (injected styles). The complete-reference
 * regex (token must be closed by `)` or `,`) ignores dynamic constructions
 * like `'var(--av-' + name + ')'`.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.join(__dirname, '..');

// Canonical token source(s). tokens.css is the sole definer of --av-* (every
// :root / [data-theme] / @media block). If a future sprint adds a second
// definer, list it here.
const TOKEN_SOURCES = ['css/aver-design/tokens.css'];

// Rare intentional exceptions, each documented. Entries are bare token names
// (e.g. 'av-x') OR 'relative/path.css::av-x'. Keep this minimal — prefer
// fixing the reference to a real token.
const ALLOWLIST = new Set([
  // (none — all known undefined references are fixed)
]);

// Blank comment bodies while preserving newlines so line numbers stay accurate.
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
}

function walk(dir, exts, out) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => ent.name.endsWith(e))) out.push(full);
  }
}

let defined, refs;

before(() => {
  // 1) Defined tokens: `--av-name:` (a colon = a declaration, not a var() ref).
  defined = new Set();
  for (const rel of TOKEN_SOURCES) {
    const src = stripComments(readFileSync(path.join(FRONTEND, rel), 'utf8'));
    for (const m of src.matchAll(/--av-([a-z0-9-]+)\s*:/g)) defined.add('av-' + m[1]);
  }

  // 2) References: every `var(--av-NAME)` / `var(--av-NAME, …)` across the tree.
  //    Token must be closed by `)` or `,` → ignores `'var(--av-' + x + ')'`.
  const files = [];
  walk(path.join(FRONTEND, 'css'), ['.css'], files);
  walk(path.join(FRONTEND, 'js'), ['.js'], files);
  walk(path.join(FRONTEND, 'pages'), ['.html'], files);
  for (const f of readdirSync(FRONTEND)) {
    if (f.endsWith('.html')) files.push(path.join(FRONTEND, f));
  }

  const REF_RE = /var\(\s*--(av-[a-z0-9-]+?)\s*[),]/g;
  refs = [];
  for (const file of files) {
    const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(REF_RE)) {
        refs.push({ token: m[1], file: path.relative(FRONTEND, file), line: i + 1 });
      }
    });
  }
});


describe('undefined-token sentinel (Lesson 16)', () => {
  test('tokens.css defines a healthy set of --av-* tokens (sanity)', () => {
    assert.ok(defined.size > 80, `expected >80 defined --av-* tokens, got ${defined.size}`);
    assert.ok(defined.has('av-error') && defined.has('av-space-6') && defined.has('av-primary'));
  });

  test('found a meaningful number of var(--av-*) references (sanity)', () => {
    assert.ok(refs.length > 200, `expected many --av-* references, got ${refs.length}`);
  });

  test('every var(--av-*) reference points to a defined token', () => {
    const bad = refs.filter((r) =>
      !defined.has(r.token) &&
      !ALLOWLIST.has(r.token) &&
      !ALLOWLIST.has(`${r.file}::${r.token}`),
    );
    if (bad.length) {
      const lines = bad
        .map((r) => `  --${r.token}  ←  ${r.file}:${r.line}`)
        .sort();
      assert.fail(
        `Undefined --av-* token references (define the token in tokens.css, fix the ` +
        `reference, or allowlist with justification):\n${[...new Set(lines)].join('\n')}`,
      );
    }
  });

  test('the three historically-fixed bugs stay fixed (regression pins)', () => {
    assert.ok(!defined.has('av-color-error'), 'av-color-error was never a real token');
    assert.ok(!defined.has('av-critical'), 'av-critical was never a real token');
    assert.ok(!defined.has('av-space-5'), 'the spacing scale skips 5');
    for (const ghost of ['av-color-error', 'av-critical', 'av-space-5']) {
      const hits = refs.filter((r) => r.token === ghost);
      assert.equal(hits.length, 0,
        `${ghost} reference re-introduced at: ${hits.map((h) => h.file + ':' + h.line).join(', ')}`);
    }
  });
});
