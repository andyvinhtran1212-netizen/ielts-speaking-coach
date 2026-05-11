/**
 * frontend/tests/brief-hardcoded-color-lesson.test.mjs — Sprint 6.7.1 follow-up.
 *
 * Run with: node --test frontend/tests/brief-hardcoded-color-lesson.test.mjs
 *
 * Pins the cumulative color-lesson appended to UNIFIED_DESIGN_BRIEF.md
 * § 12 ("Hardcoded colors = silent theme bugs") after the Sprint 6.7.1
 * dark-theme contrast discovery. Sprint 6.7.1 (PR #133) initially looked
 * like discipline drift; Code investigation surfaced a real WCAG AA
 * failure in dark theme (white text on bright teal fails ~1.6:1).
 *
 * These pins guard against the lesson being trimmed or paraphrased to
 * the point where future redesign sprints could repeat the silent bug.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');


describe('UNIFIED_DESIGN_BRIEF.md / hardcoded color lesson (Sprint 6.7.1)', () => {
  const brief = readFileSync(
    path.join(REPO_ROOT, 'frontend/css/aver-design/UNIFIED_DESIGN_BRIEF.md'),
    'utf8',
  );

  test('has a § 12 "Hardcoded colors = silent theme bugs" section', () => {
    assert.match(
      brief,
      /^## 12\. Hardcoded colors = silent theme bugs/m,
      'UNIFIED_DESIGN_BRIEF.md must have a § 12 section titled "Hardcoded colors = silent theme bugs"',
    );
  });

  test('references Sprint 6.7.1 / PR #133 (the discovery sprint)', () => {
    assert.match(
      brief,
      /Sprint 6\.7\.1|PR\s*#?\s*133/,
      'Brief must reference Sprint 6.7.1 or PR #133 so the silent-bug discovery is traceable',
    );
  });

  test('includes a detection grep command for future PRs', () => {
    // The grep command is what reviewers + future redesign sprints
    // actually run. Trimming it to prose erodes the enforcement.
    assert.match(
      brief,
      /grep[\s\S]{0,200}color:\\?s\*#\[0-9a-fA-F\]/,
      'Brief must include the literal grep command for detecting hardcoded color literals in page CSS',
    );
  });

  test('names --av-text-on-primary as the canonical inverse-on-brand token', () => {
    assert.match(
      brief,
      /--av-text-on-primary/,
      'Brief § 12 must name the --av-text-on-primary token (Sprint 6.7.1 fix used it)',
    );
  });

  test('shows the wrong-vs-right anti-pattern code examples', () => {
    // Wrong example must contain `color: #ffffff`; right example must
    // contain `color: var(--av-text-on-primary)`. Both must be present
    // so a reader sees the exact swap.
    assert.match(
      brief,
      /color:\s*#ffffff/,
      'Brief § 12 must show color:#ffffff as the wrong example',
    );
    assert.match(
      brief,
      /color:\s*var\(--av-text-on-primary\)/,
      'Brief § 12 must show color: var(--av-text-on-primary) as the right example',
    );
  });

  test('documents the contrast math (light passes, dark fails AA)', () => {
    // The number is what makes "silent theme bug" credible — without
    // the ratio, the lesson reads like opinion. Pin the contrast table.
    assert.match(
      brief,
      /fails\s*AA|fail\s*WCAG\s*AA/i,
      'Brief § 12 must state explicitly that hardcoded #ffffff fails AA in dark theme',
    );
  });

  test('lists all 3 cumulative color lessons (6.4.1/6.4.2, 6.5.1, 6.7.1)', () => {
    // The point of the cumulative table is that each redesign sprint
    // inherits prior lessons. If a sprint reference goes missing, the
    // history is broken.
    assert.match(brief, /6\.4\.1|6\.4\.2/, 'Brief must reference Sprint 6.4.1 / 6.4.2 (semantic-role mapping lesson)');
    assert.match(brief, /6\.5\.1/, 'Brief must reference Sprint 6.5.1 (ds.css override pattern lesson)');
    assert.match(brief, /6\.7\.1/, 'Brief must reference Sprint 6.7.1 (silent theme bug lesson)');
  });

  test('explains WHY token discipline IS contrast discipline', () => {
    // The "why" line is what stops a future reviewer from waving off
    // a hardcoded literal as "just style". Without it, the lesson reads
    // like opinion. Pin a key clause.
    assert.match(
      brief,
      /semantic\s+bug|bypass[\s\S]{0,80}theme\s+system|contrast\s+(guarantee|discipline)/i,
      'Brief § 12 must explain why hardcoded literals are semantic bugs, not style drift',
    );
  });

  test('cross-references the writing-dashboard-redesign test pin for enforcement', () => {
    // The enforcement layer for this lesson is the per-page redesign
    // tests. The brief must point at them so a future contributor finds
    // the CI gate, not just the prose rule.
    assert.match(
      brief,
      /writing-dashboard-redesign|per-page redesign test|pin\s+test/i,
      'Brief § 12 must point at the per-page redesign test suite that enforces the rule in CI',
    );
  });
});
