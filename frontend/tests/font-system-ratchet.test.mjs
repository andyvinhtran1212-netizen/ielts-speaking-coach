/**
 * font-system-ratchet.test.mjs — DEBT-2026-07-24-J governance.
 *
 * The 2026-07-24 brand session found the type system was not one system. Measured
 * on main 2026-07-25: SEVEN Google Font families across FOUR stacks —
 * Plus Jakarta + JetBrains (canonical), DM Sans + Lora (grammar), Hanken Grotesk
 * + Fraunces + DM Mono (vocab), Manrope + Fraunces (legacy ds.css). A reader saw
 * a serif heading on Grammar and a sans one on Landing for the same thing.
 *
 * Decision 2026-07-25: ONE sans (Plus Jakarta), ONE mono (JetBrains), and ONE
 * controlled serif (Lora) reserved for long-form reading — all reached through
 * `--av-font-*`, never named literally in page CSS.
 *
 * This is a RATCHET, in the same shape as hex-budget.test.mjs: it does not
 * demand the whole cleanup at once, it pins what is already converged so a
 * fifth subsystem cannot appear. As each file in ALLOWED_LITERALS is migrated,
 * delete its entry — the budget only moves down.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.join(__dirname, '..');
const CSS_DIR = path.join(FRONTEND, 'css');
const PUBLIC = path.join(FRONTEND, 'public');

// The only families the system sanctions, and the token each is reached by.
const SANCTIONED = {
  'Plus Jakarta Sans': '--av-font-sans / --av-font-display',
  'JetBrains Mono': '--av-font-mono',
  Lora: '--av-font-serif (long-form reading only)',
};

// Families still present in not-yet-migrated corners. Every entry is debt.
// DEBT-2026-07-24-J step (c) empties the vocab rows; the ds.css row is the
// tail of the separate --ds-* → --av-* migration.
const ALLOWED_LITERALS = {
  // vocab-wiki.css cleared 2026-07-25 (J step c) — Fraunces / DM Mono /
  // Hanken Grotesk all left the system. The row is deleted, not emptied:
  // the budget only moves down.
  'ds.css': ['Manrope', 'Fraunces'],   // tail of the legacy --ds-* migration
};

const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
const FONT_FAMILY = /font-family:\s*([^;}]+)/g;
// Generic CSS keywords are not font families.
const GENERIC = new Set([
  'inherit', 'initial', 'unset', 'revert', 'serif', 'sans-serif', 'monospace',
  'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace',
  'ui-rounded', 'Georgia', 'Menlo', 'Times New Roman', 'SF Mono', '-apple-system',
  'BlinkMacSystemFont', 'Segoe UI', 'Helvetica', 'Arial', 'Courier New',
]);

function namedFamilies(css) {
  const out = new Set();
  for (const m of stripComments(css).matchAll(FONT_FAMILY)) {
    const value = m[1];
    if (value.includes('var(--av-font-')) continue;   // reached by token — fine
    for (const part of value.split(',')) {
      const name = part.trim().replace(/^['"]|['"]$/g, '');
      if (!name || name.startsWith('var(') || GENERIC.has(name)) continue;
      out.add(name);
    }
  }
  return out;
}

function walk(dir, exts, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => ent.name.endsWith(e))) out.push(full);
  }
  return out;
}

describe('font-system ratchet (DEBT-2026-07-24-J)', () => {
  test('the three sanctioned families each have a token', () => {
    const tokens = readFileSync(path.join(CSS_DIR, 'aver-design/tokens.css'), 'utf8');
    assert.match(tokens, /--av-font-sans:\s*'Plus Jakarta Sans'/);
    assert.match(tokens, /--av-font-mono:\s*'JetBrains Mono'/);
    assert.match(tokens, /--av-font-serif:\s*'Lora'/);
    // The serif is deliberately NOT the display font — display stays sans so a
    // page cannot drift into serif chrome.
    assert.match(tokens, /--av-font-display:\s*'Plus Jakarta Sans'/);
  });

  test('no CSS file names a font family outside the allowed set', () => {
    const violations = [];
    for (const file of walk(CSS_DIR, ['.css'])) {
      const rel = path.relative(CSS_DIR, file);
      if (/^tailwind\.(build|inter|src)\.css$/.test(rel)) continue;   // generated
      if (rel === 'aver-design/tokens.css') continue;                 // defines them
      const allowed = ALLOWED_LITERALS[path.basename(rel)] || [];
      for (const fam of namedFamilies(readFileSync(file, 'utf8'))) {
        if (fam in SANCTIONED || allowed.includes(fam)) continue;
        violations.push(`css/${rel}: '${fam}'`);
      }
    }
    assert.deepEqual(
      violations, [],
      '\nUnsanctioned font family in page CSS — reach for var(--av-font-sans|mono|serif).\n'
      + 'If a corner genuinely still needs a literal, add it to ALLOWED_LITERALS with the\n'
      + 'debt item that will remove it — do not widen SANCTIONED.\n',
    );
  });

  test('grammar pages are fully converged — DM Sans is gone site-wide', () => {
    const pages = walk(PUBLIC, ['.html']).filter((f) => !f.includes('legacy'));
    const stillLinking = pages
      .filter((f) => /family=DM\+Sans/.test(readFileSync(f, 'utf8')))
      .map((f) => path.basename(f));
    assert.deepEqual(stillLinking, [], 'DM Sans must no longer be downloaded anywhere');

    const gw = stripComments(readFileSync(path.join(CSS_DIR, 'grammar-wiki.css'), 'utf8'));
    assert.ok(!/DM Sans/.test(gw), 'grammar-wiki.css must not name DM Sans');
    // Lora survives — it IS the sanctioned serif — but only through the token.
    assert.ok(!/'Lora'/.test(gw), 'grammar-wiki.css must reach Lora via --av-font-serif');
    assert.match(gw, /font-family:\s*var\(--av-font-serif\)/);
  });

  test('every page that links a family also has a rule that can use it', () => {
    // Catches the failure this change fixed: the grammar pages named
    // --av-font-sans in CSS but never linked Plus Jakarta, so the token
    // silently fell back to ui-sans-serif.
    for (const file of walk(PUBLIC, ['.html'])) {
      const html = readFileSync(file, 'utf8');
      if (!/css\/grammar-wiki\.css/.test(html)) continue;
      const base = path.basename(file);
      assert.match(html, /family=Plus\+Jakarta\+Sans/,
        `${base} loads grammar-wiki.css (which uses --av-font-sans) but never links Plus Jakarta`);
      assert.match(html, /family=JetBrains\+Mono/,
        `${base} uses --av-font-mono but never links JetBrains Mono`);
    }
  });
});
