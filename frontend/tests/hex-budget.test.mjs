/**
 * frontend/tests/hex-budget.test.mjs — design-system consolidation governance (A4).
 *
 * A RATCHET that stops CSS colour fragmentation from growing back. The audit
 * (AUDIT_STRUCTURE_DESIGN_2026-07-03 §A4) found 234 raw hex literals across 17
 * non-token CSS files, concentrated in the post-pivot skins (reading-exam.css,
 * ielts-test-paper.css). Colour in page/skin CSS should be `var(--av-*)`.
 *
 * Contract:
 *   • Each non-exempt CSS file may hold at most `hex-budget.json[file]` hex
 *     literals. A file NOT in the budget is capped at 0 → a NEW page CSS file
 *     (or a token-clean one) may not introduce hex.
 *   • Migrating hex → tokens LOWERS a file's real count; when it drops, tighten
 *     the budget entry (or delete it at 0) so the ratchet can't slip back.
 *
 * Exempt (hex is legitimate): ONLY the token-definition file css/aver-design/
 * tokens.css (it maps --av-* → #hex) and the generated tailwind build files.
 * The rest of css/aver-design/ (components.css, admin-*.css) is shared primitive
 * CSS and IS budgeted — raw hex there is drift.
 *
 * This guards every later consolidation phase: no phase may add new hex, and the
 * budget only moves down.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.join(__dirname, '..');
const CSS_DIR = path.join(FRONTEND, 'css');

// Only the actual token-DEFINITION file (maps --av-* → #hex) and generated
// Tailwind outputs are exempt. NOT the whole aver-design/ dir — that also holds
// shared primitive CSS (components.css, admin-*.css) where raw hex IS drift and
// must be caught (Codex review: narrow the exemption to token files).
const EXEMPT_DIR_PREFIXES = [];
const EXEMPT_NAMES = new Set([
  'tokens.css',            // the --av-* token definitions (hex is legitimate here)
  'tailwind.build.css', 'tailwind.inter.css', 'tailwind.src.css',
]);

const HEX = /#[0-9a-fA-F]{3,8}\b/g;

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

function walkCss(dir, rel, out) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    const relPath = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) walkCss(full, relPath, out);
    else if (ent.name.endsWith('.css')) out.push({ full, rel: relPath });
  }
}

function isExempt(rel) {
  if (EXEMPT_NAMES.has(path.basename(rel))) return true;
  return EXEMPT_DIR_PREFIXES.some((p) => rel.startsWith(p));
}

describe('hex-budget ratchet (A4 governance)', () => {
  let budget, files;
  before(() => {
    budget = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'hex-budget.json'), 'utf8'));
    files = [];
    walkCss(CSS_DIR, '', files);
  });

  test('no CSS file exceeds its hex budget (new hex is forbidden)', () => {
    const violations = [];
    for (const { full, rel } of files) {
      if (isExempt(rel)) continue;
      const key = `css/${rel}`;
      const count = (stripComments(readFileSync(full, 'utf8')).match(HEX) || []).length;
      const allowed = budget[key] ?? 0;
      if (count > allowed) {
        violations.push(`${key}: ${count} hex > budget ${allowed} — use var(--av-*), not raw hex`);
      }
    }
    assert.equal(
      violations.length, 0,
      `\nHex budget exceeded (design-system A4 ratchet):\n  ${violations.join('\n  ')}\n` +
      `If you intentionally added a NEW page CSS file, migrate its colours to --av-* tokens.\n`,
    );
  });

  test('budget entries stay exact — reductions are sticky (no stale headroom)', () => {
    // Codex review: a budget entry left ABOVE the file's real count leaves
    // headroom for raw hex to be re-added later, so the ratchet does not make
    // reductions sticky. Require budget === current count: a migration that
    // lowers a file's hex MUST tighten (or delete) its entry, and a removed file
    // must drop out of the fixture.
    const counts = new Map(
      files.map((f) => [`css/${f.rel}`, (stripComments(readFileSync(f.full, 'utf8')).match(HEX) || []).length]),
    );
    const stale = [];
    for (const [key, allowed] of Object.entries(budget)) {
      const cur = counts.get(key);
      if (cur === undefined) stale.push(`${key}: file gone → remove the entry`);
      else if (allowed > cur) stale.push(`${key}: budget ${allowed} > actual ${cur} → tighten to ${cur} (or delete if 0)`);
    }
    assert.deepEqual(
      stale, [],
      `\nHex budget has stale headroom (design-system A4 ratchet must only move DOWN):\n  ${stale.join('\n  ')}\n`,
    );
  });
});
