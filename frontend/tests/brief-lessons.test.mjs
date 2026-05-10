/**
 * frontend/tests/brief-lessons.test.mjs
 *
 * Run with: node --test frontend/tests/brief-lessons.test.mjs
 *
 * Pins the cumulative lessons captured in UNIFIED_DESIGN_BRIEF.md so
 * future per-page redesigns (Sprint 6.6+) can lean on them without
 * re-discovering the bugs.
 *
 *   • Lesson 1 — color migration semantic mapping (Sprint 6.4.1 → 6.4.2)
 *     Already pinned in `brief-contrast-guidance.test.mjs` (PR #126).
 *     This file ADDS the inventory-table augmentation pin: the table
 *     now includes practice.html distributions from Sprint 6.5 + 6.5.1.
 *
 *   • Lesson 2 — ds.css legacy override pattern (Sprint 6.5.1)
 *     New § 12 in the brief codifies: when a redesigned page links
 *     `ds.css` for legacy chrome (`.ds-question-card`, `.ds-cue-bullet`,
 *     etc.), it MUST scope an override block under `body.av-page` that
 *     re-paints the affected selectors with `--av-*` tokens. Don't
 *     edit `ds.css` directly — it would ripple to un-redesigned pages.
 *
 * If a future docs cleanup deletes the section or the inventory table,
 * CI fails. That's the point — the lesson dies the day the brief stops
 * teaching it.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BRIEF_PATH = path.join(
  __dirname, '..', 'css', 'aver-design', 'UNIFIED_DESIGN_BRIEF.md',
);
const SYSTEM_PATH = path.join(
  __dirname, '..', 'css', 'aver-design', 'DESIGN_SYSTEM.md',
);


let brief;
let system;
function _read(p) { return readFileSync(p, 'utf8'); }


// ── Lesson 1 augmentation: inventory table includes shipped sprints ──


describe('UNIFIED_DESIGN_BRIEF.md / shipped-sprint inventory table', () => {
  test('setup: brief loads', () => {
    brief = _read(BRIEF_PATH);
    assert.ok(brief.length > 0);
  });

  test('inventory section lists practice.html distributions (6.5 + 6.5.1)', () => {
    // The reference table in § 11.5 should include per-page rows for
    // every shipped redesign. New sprints look up where their own
    // numbers land relative to peers — a wildly off-trend faint count
    // is the early-warning the table exists to surface.
    assert.match(
      brief,
      /practice\.html[\s\S]{0,80}6\.5\b/,
      'inventory table must include the practice.html (Sprint 6.5) row',
    );
    assert.match(
      brief,
      /practice\.html[\s\S]{0,80}6\.5\.1/,
      'inventory table must include the practice.html (Sprint 6.5.1) row to show the faint-stays-flat delta',
    );
  });

  test('inventory section lists speaking.html (Sprint 6.4.2) reference numbers', () => {
    assert.match(
      brief,
      /speaking\.html[\s\S]{0,80}6\.4\.2/,
      'inventory table must include speaking.html as the canonical Sprint 6.4.2 reference',
    );
  });
});


// ── Lesson 2: ds.css legacy override pattern ─────────────────────


describe('UNIFIED_DESIGN_BRIEF.md / ds.css legacy override pattern (§ 12)', () => {
  test('declares the ds.css override pattern as a top-level section', () => {
    // The pattern must be discoverable from the table of contents —
    // anchor on a top-level heading that names ds.css explicitly.
    assert.match(
      brief,
      /^##\s+\d+\.\s+ds\.css.*override/im,
      'brief must contain a top-level "ds.css … override" section so it surfaces in the TOC',
    );
  });

  test('cites Sprint 6.5.1 as the originating lesson', () => {
    assert.match(
      brief,
      /Sprint 6\.5\.1/,
      'brief must cite Sprint 6.5.1 so the rationale is traceable',
    );
  });

  test('warns against modifying ds.css directly', () => {
    // The whole reason for the override pattern. If this rule isn't
    // explicit, future sprints will "just fix ds.css" and rip out
    // legacy-page colors.
    assert.match(
      brief,
      /(don'?t.*modify.*ds\.css|don'?t.*edit.*ds\.css|ds\.css.*shared infrastructure)/i,
      'brief must explicitly warn against modifying / editing ds.css directly',
    );
  });

  test('teaches the body.av-page scoping convention', () => {
    assert.match(
      brief,
      /body\.av-page\s+\.ds-/,
      'brief must show the body.av-page scoping convention with a concrete ds-* example',
    );
  });

  test('lists the canonical bug examples (.ds-q-text + cue/strength/improve)', () => {
    // The four selectors Sprint 6.5.1 had to override are the canonical
    // example set. A reader should see them in the brief.
    for (const sel of [
      '.ds-q-text',
      '.ds-cue-bullet',
      '.ds-strength-item',
      '.ds-improve-item',
    ]) {
      assert.ok(
        brief.includes(sel),
        `brief must reference ${sel} as part of the override checklist`,
      );
    }
  });

  test('shows the canonical override → token mapping (q-text → text-primary)', () => {
    // The single most important override: question text (the one Andy's
    // smoke test caught). If this disappears from the brief, the lesson
    // is half-told.
    assert.match(
      brief,
      /\.ds-q-text[\s\S]{0,200}var\(--av-text-primary\)/,
      'brief must show the .ds-q-text → --av-text-primary override (the Sprint 6.5.1 canonical fix)',
    );
  });

  test('teaches identification grep recipes', () => {
    // A new sprint needs a way to find which ds-* classes their page
    // consumes + which ones in ds.css have hardcoded whites. The brief
    // should show both grep one-liners.
    assert.match(
      brief,
      /grep[\s\S]{0,200}ds-\[a-z-\]\+/,
      'brief must show the "find ds-* class names in markup" grep recipe',
    );
    assert.match(
      brief,
      /grep[\s\S]{0,300}rgba\(255/,
      'brief must show the "find hardcoded whites in ds.css" grep recipe',
    );
  });

  test('teaches the verification checklist + pin-test pointer', () => {
    // Pattern + verification + test pin = the three legs that keep this
    // lesson durable. Pin the pointer to the practice-redesign suite.
    assert.match(
      brief,
      /practice-redesign\.test\.mjs/,
      'brief must point at frontend/tests/practice-redesign.test.mjs as the existing pin reference',
    );
    assert.match(
      brief,
      /(both themes|light theme.*dark theme|dark theme.*light theme)/i,
      'brief must require verification in both themes',
    );
  });

  test('teaches future-proofing — when ds.css can be retired', () => {
    // Without an exit criterion this section ossifies. The brief should
    // tell future readers when the override pattern stops being needed.
    assert.match(
      brief,
      /(retire|cleanup sprint|ds\.css.*delete|delete.*ds\.css)/i,
      'brief should describe when ds.css can be retired (the override pattern\'s exit criterion)',
    );
  });
});


// ── DESIGN_SYSTEM.md cross-reference ─────────────────────────────


describe('DESIGN_SYSTEM.md / cross-reference to override pattern', () => {
  test('setup: design system loads', () => {
    system = _read(SYSTEM_PATH);
    assert.ok(system.length > 0);
  });

  test('migration § references the ds.css override pattern in the brief', () => {
    // The systems doc needs at minimum a pointer so a reader who only
    // opens it doesn't miss the pattern. Pin the cross-reference.
    assert.match(
      system,
      /UNIFIED_DESIGN_BRIEF\.md[\s\S]{0,80}§\s*12/,
      'DESIGN_SYSTEM.md must cross-reference UNIFIED_DESIGN_BRIEF.md § 12 for the override pattern',
    );
  });

  test('warns that redesigned pages may still link ds.css', () => {
    assert.match(
      system,
      /redesigned[\s\S]{0,150}ds\.css/i,
      'DESIGN_SYSTEM.md must call out that redesigned pages may still consume ds.css',
    );
  });

  test('cites Sprint 6.5.1 as the reference case', () => {
    assert.match(
      system,
      /Sprint 6\.5\.1/,
      'DESIGN_SYSTEM.md must reference Sprint 6.5.1 as the canonical override case',
    );
  });
});
