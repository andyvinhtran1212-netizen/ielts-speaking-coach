/**
 * frontend/tests/sprint-6-9-1-audit-closure.test.mjs — Sprint 6.9.1.
 *
 * Run with: node --test frontend/tests/sprint-6-9-1-audit-closure.test.mjs
 *
 * Closes Codex audit Phase 2 (CODEX_AUDIT_PHASE_2.md, repo root):
 *   AMBER #1 — brief writing-result.html row was "TBD" + DESIGN_SYSTEM.md
 *              Phase table had TBD PR refs.
 *   AMBER #2 — Phase 2 architectural insights lived only in pin-test
 *              comments; the central brief was silent.
 *   Pattern formalization #1 — pre-work discipline (Sprint 6.7/6.8/6.9
 *              precedent) is now § 15 of DESIGN_SYSTEM.md.
 *   Pattern formalization #2 — Chart.js A.2 theme-aware recipe (Sprint
 *              6.4.1 → 6.9 reuse) is now § 16 of DESIGN_SYSTEM.md.
 *
 * These pins keep the central docs in sync with the shipped Phase 2
 * contracts so the next contributor doesn't have to reverse-engineer
 * them from `*.test.mjs` comments.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');


let brief;
let designSystem;

before(() => {
  brief = readFileSync(
    path.join(REPO_ROOT, 'frontend/css/aver-design/UNIFIED_DESIGN_BRIEF.md'),
    'utf8',
  );
  designSystem = readFileSync(
    path.join(REPO_ROOT, 'frontend/css/aver-design/DESIGN_SYSTEM.md'),
    'utf8',
  );
});


// ── AMBER #1: writing-result.html no longer TBD ──────────────────


describe('AMBER #1 — writing-result.html row updated in brief + Phase table', () => {
  test('brief writing-result.html row references Sprint 6.8 / PR #135', () => {
    // The lock-state inventory row (§ 3.6.1) was "TBD — verify before
    // redesign | TBD | TBD" before Sprint 6.9.1. The shipped row must
    // reference Sprint 6.8 / PR #135.
    const row = brief.match(/\|\s*`?pages\/writing-result\.html`?\s*\|[\s\S]{0,800}/);
    assert.ok(row, 'writing-result.html lock-state row not found in brief');
    assert.match(
      row[0],
      /Sprint 6\.8|PR #135/,
      'writing-result.html row must reference Sprint 6.8 / PR #135',
    );
  });

  test('brief writing-result.html lock row is no longer TBD', () => {
    // Extract only the writing-result row, NOT any subsequent table
    // rows (which may legitimately still say TBD for unrelated pages).
    const m = brief.match(/\|\s*`?pages\/writing-result\.html`?\s*\|([^\n]*)\n/);
    assert.ok(m, 'writing-result.html row not found');
    assert.ok(
      !/\bTBD\b/.test(m[1]),
      `writing-result.html row still says TBD: "${m[1].trim()}"`,
    );
  });

  test('DESIGN_SYSTEM.md Phase table references PR #135 for writing-result', () => {
    assert.match(
      designSystem,
      /writing-result\.html[\s\S]{0,300}#135/,
      'DESIGN_SYSTEM.md § 14.1 missing PR #135 for writing-result.html',
    );
  });

  test('DESIGN_SYSTEM.md Phase table references PR #136 for full-test-result', () => {
    assert.match(
      designSystem,
      /full-test-result\.html[\s\S]{0,300}#136/,
      'DESIGN_SYSTEM.md § 14.1 missing PR #136 for full-test-result.html',
    );
  });

  test('DESIGN_SYSTEM.md § 14.1 Phase table has no TBD PRs for Phase 2 rows', () => {
    // Isolate § 14.1 — between "### 14.1" and the next "### " heading.
    const sectionMatch = designSystem.match(/### 14\.1[\s\S]*?(?=\n### 14\.\d)/);
    assert.ok(sectionMatch, '§ 14.1 section not found');
    const phase2Rows = sectionMatch[0].match(/^\| 2 \|[^\n]*$/gm) || [];
    for (const row of phase2Rows) {
      assert.ok(
        !/\bTBD\b/.test(row),
        `Phase 2 row still has TBD PR ref: ${row}`,
      );
    }
  });
});


// ── AMBER #2: Writing flow asymmetries central section ───────────


describe('AMBER #2 — Writing flow asymmetries section', () => {
  test('brief has a central "Writing flow asymmetries" section', () => {
    assert.match(
      brief,
      /Writing flow asymmetries/,
      'Brief missing "Writing flow asymmetries" central section',
    );
  });

  test('section documents Era A/B reconcile premise falsified', () => {
    assert.match(
      brief,
      /Era A\/B reconcile.*non-issue|Era A\/B.*falsified|reconcile.*non-issue|falsified/i,
      'Section should document the Era A/B reconcile falsification (Sprint 6.8 finding)',
    );
  });

  test('section cites the Sprint 6.8 evidence trail', () => {
    assert.match(
      brief,
      /Sprint 2\.6\.2|Migration 045|045_quick_to_standard/,
      'Section should cite Sprint 2.6.2 stamping / migration 045 evidence',
    );
  });

  test('section documents permission gating asymmetry (dashboard vs result)', () => {
    assert.match(
      brief,
      /permission gating asymmetry|writing-preview-banner[\s\S]{0,400}server-authoritative|server-authoritative[\s\S]{0,400}writing-preview-banner/i,
      'Section should document the dashboard-vs-result permission asymmetry',
    );
  });

  test('section documents writing-renderers.css de-facto single-consumer', () => {
    assert.match(
      brief,
      /writing-renderers\.css[\s\S]{0,300}(de-facto|single-consumer)|(de-facto|single-consumer)[\s\S]{0,300}writing-renderers/i,
      'Section should document writing-renderers.css de-facto single-consumer status',
    );
  });

  test('section has discovery checklist for future Writing redesigns', () => {
    assert.match(
      brief,
      /Discovery checklist|Before redesigning any Writing page/i,
      'Section should have discovery checklist for future Writing pages',
    );
  });

  test('discovery checklist references the four grep patterns', () => {
    // The four checklist commands target: Era version stamping,
    // permission pattern, CSS consumption breadth, renderer dispatch.
    assert.match(brief, /stamp|version|v2\.1|era_/);
    assert.match(brief, /permission|preview-banner|hasWriting/);
    assert.match(brief, /writing-renderers\.css/);
    assert.match(brief, /SECTION_RENDERERS|renderSection/);
  });
});


// ── Pattern formalization #1: Pre-work discipline ────────────────


describe('Pre-work discipline pattern formalized in DESIGN_SYSTEM.md', () => {
  test('DESIGN_SYSTEM.md has a pre-work discipline section', () => {
    assert.match(
      designSystem,
      /Pre-work discipline pattern|pre-work checklist/i,
      'DESIGN_SYSTEM.md should formalize pre-work discipline pattern',
    );
  });

  test('section lists the 7 checklist steps', () => {
    // The spec mandates 7 steps; pin at least 5 to allow minor copy
    // edits that might collapse two related steps.
    const stepCount = (designSystem.match(/Step\s*\d+\s*[-—:]/g) || []).length;
    assert.ok(
      stepCount >= 5,
      `Pre-work pattern should list multiple Step N entries; found ${stepCount}`,
    );
  });

  test('section documents output format (## Pre-work findings template)', () => {
    assert.match(
      designSystem,
      /Pre-work findings|## Pre-work findings/i,
      'Pre-work pattern should document the output format template',
    );
  });

  test('section references Sprint 6.7 / 6.8 / 6.9 outcome evidence', () => {
    // All three sprints should appear as outcome examples.
    assert.match(designSystem, /Sprint 6\.7/, 'missing Sprint 6.7 outcome');
    assert.match(designSystem, /Sprint 6\.8/, 'missing Sprint 6.8 outcome');
    assert.match(designSystem, /Sprint 6\.9/, 'missing Sprint 6.9 outcome');
  });

  test('section includes an Anti-pattern note', () => {
    // Find the pre-work section and assert it contains anti-pattern guidance.
    const section = designSystem.match(/Pre-work discipline pattern[\s\S]*?(?=\n## 16|\n## \d|$)/i);
    assert.ok(section, 'Pre-work section not found');
    assert.match(
      section[0],
      /Anti-pattern|don't skip|do not skip/i,
      'Pre-work pattern should include anti-pattern guidance',
    );
  });
});


// ── Pattern formalization #2: Chart.js A.2 canonical recipe ──────


describe('Chart.js A.2 canonical recipe formalized in DESIGN_SYSTEM.md', () => {
  test('DESIGN_SYSTEM.md documents the Chart.js theme-aware recipe', () => {
    assert.match(
      designSystem,
      /Chart\.js theme-aware|Chart\.js[\s\S]{0,200}A\.2|A\.2 pattern/i,
      'DESIGN_SYSTEM.md should formalize the Chart.js A.2 canonical recipe',
    );
  });

  test('recipe documents the _tokenColor() helper / getComputedStyle pattern', () => {
    assert.match(
      designSystem,
      /_tokenColor|getComputedStyle\(\s*document\.documentElement\s*\)/,
      'Recipe should document _tokenColor() helper or getComputedStyle pattern',
    );
  });

  test('recipe documents the MutationObserver theme listener', () => {
    assert.match(
      designSystem,
      /MutationObserver[\s\S]{0,500}data-theme|data-theme[\s\S]{0,500}MutationObserver/,
      'Recipe should document MutationObserver wired to [data-theme]',
    );
  });

  test('recipe documents the A.1 vs A.2 tradeoff', () => {
    assert.match(
      designSystem,
      /A\.1[\s\S]{0,400}(literal|hardcode|leave|DEBT)|(literal|hardcode|leave|DEBT)[\s\S]{0,400}A\.1/i,
      'Recipe should document the A.1 alternative (leave literals + DEBT)',
    );
  });

  test('recipe references the Sprint 6.4.1 → 6.9 reuse precedent', () => {
    assert.match(
      designSystem,
      /Sprint 6\.4\.1[\s\S]{0,800}Sprint 6\.9|6\.4\.1[\s\S]{0,400}(reuse|precedent)[\s\S]{0,200}6\.9/i,
      'Recipe should reference the Sprint 6.4.1 → 6.9 reuse precedent',
    );
  });

  test('recipe includes a token reference table for chart styling', () => {
    // The recipe should map at least the primary dataset + grid + ticks
    // tokens. Check for the column header pattern.
    assert.match(
      designSystem,
      /Token reference[\s\S]{0,200}chart|Chart element[\s\S]{0,200}\|/i,
      'Recipe should include a token reference table',
    );
  });
});
