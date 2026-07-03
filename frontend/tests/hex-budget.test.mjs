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
 * Exempt (hex is legitimate): the token DEFINITIONS in css/aver-design/** (they
 * map --av-* → #hex) and the generated tailwind build files.
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

const EXEMPT_DIR_PREFIXES = ['aver-design/'];               // token definitions
const EXEMPT_NAMES = new Set(['tailwind.build.css', 'tailwind.inter.css', 'tailwind.src.css']);

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

  test('budget entries are not stale (a file must still hold ≥ its recorded excess is allowed, but 0-budget files stay clean)', () => {
    // Soft ratchet health: flag budget entries whose file no longer exists or is
    // already under budget by a lot, so we remember to tighten them. Non-fatal:
    // only fails if a budget key points at a missing file (keeps the fixture honest).
    const present = new Set(files.map((f) => `css/${f.rel}`));
    const missing = Object.keys(budget).filter((k) => !present.has(k));
    assert.deepEqual(missing, [], `Stale hex-budget entries (file gone) — remove them: ${missing.join(', ')}`);
  });
});
