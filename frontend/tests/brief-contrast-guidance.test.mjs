/**
 * frontend/tests/brief-contrast-guidance.test.mjs
 *
 * Run with: node --test frontend/tests/brief-contrast-guidance.test.mjs
 *
 * Pins the Sprint 6.4.1 → 6.4.2 contrast lesson into the design brief
 * so future per-page redesigns don't re-discover the bug.
 *
 * Sprint 6.4.1 mechanically mapped Sprint 5.1 inline `rgba(255,255,255,X)`
 * values to the four --av-text-* tokens by opacity number. On the cream
 * light surface, the resulting --av-text-faint usage (~32% navy) failed
 * WCAG AA, leaving 25 elements unreadable. Sprint 6.4.2 re-mapped per
 * semantic role.
 *
 * The brief now codifies:
 *   • a decision tree (semantic role first, opacity number never)
 *   • per-token contrast guarantees
 *   • the opacity-driven-migration anti-pattern
 *   • inventory tracking for redesign PRs
 *
 * These tests guard the brief — if the section is deleted or
 * substantially reworded away from the lesson, CI fails.
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


describe('UNIFIED_DESIGN_BRIEF.md / contrast guidance', () => {
  test('setup: brief loads', () => {
    brief = _read(BRIEF_PATH);
    assert.ok(brief.length > 0);
  });

  test('declares a text token decision tree', () => {
    // The section title shifted across drafts — match liberally on
    // "decision tree" + "text token" or "token decision".
    assert.match(
      brief,
      /text token decision tree|decision tree[\s\S]{0,40}text token/i,
      'brief must contain a Text Token Decision Tree section',
    );
  });

  test('warns against opacity-driven migration', () => {
    // The anti-pattern is the heart of the lesson. Phrase varies, but
    // one of the canonical formulations must appear.
    assert.match(
      brief,
      /opacity[- ]driven|by opacity number|map by.*semantic.*not.*opacity|don'?t map by opacity/i,
      'brief must warn against opacity-driven migration (the Sprint 6.4.1 mistake)',
    );
  });

  test('references the Sprint 6.4.1 → 6.4.2 lesson', () => {
    assert.match(
      brief,
      /6\.4\.1[\s\S]{0,80}6\.4\.2|Sprint 6\.4\.1|Sprint 6\.4\.2/,
      'brief should cite the Sprint 6.4.1 / 6.4.2 contrast lesson so the rationale is traceable',
    );
  });

  test('marks --av-text-faint as auxiliary-only with the WCAG implication', () => {
    // Look for --av-text-faint within ~400 chars of an "auxiliary",
    // "em-dash", "disabled", or "3:1" / "fails AA" marker.
    const re = /--av-text-faint[\s\S]{0,400}(auxiliary|em[- ]dash|disabled|3\.0?:1|3:1|fails? (?:WCAG )?AA)/i;
    assert.match(
      brief,
      re,
      '--av-text-faint must be flagged as auxiliary-only / fails AA so future migrations stop at 5–10 occurrences',
    );
  });

  test('cites WCAG AA as the contrast bar', () => {
    assert.match(
      brief,
      /WCAG AA|4\.6:1|4\.5:1/,
      'brief should mention WCAG AA (or the 4.5:1 / 4.6:1 contrast threshold) so the bar is explicit',
    );
  });

  test('describes the four-token semantic ladder', () => {
    // Every per-page redesign needs to see all four tokens listed
    // together so they can choose one. The brief should mention each.
    for (const token of [
      '--av-text-primary',
      '--av-text-secondary',
      '--av-text-muted',
      '--av-text-faint',
    ]) {
      assert.ok(
        brief.includes(token),
        `brief must mention ${token} so the decision tree is complete`,
      );
    }
  });

  test('teaches inventory tracking for redesign PR bodies', () => {
    // Per the brief: each redesign PR logs token counts. This pin
    // checks that the inventory pattern + the cap on faint are both
    // captured.
    assert.match(
      brief,
      /token usage|token count|inventory|distribution/i,
      'brief should describe the inventory-tracking habit for per-page redesigns',
    );
    assert.match(
      brief,
      /text-faint[\s\S]{0,200}(≤\s*10|<\s*10|10 per page|cap)/i,
      'brief should pin the --av-text-faint cap (≤ ~10 per page) so reviewers catch over-mapping',
    );
  });
});


describe('DESIGN_SYSTEM.md / text token table', () => {
  test('setup: design system loads', () => {
    system = _read(SYSTEM_PATH);
    assert.ok(system.length > 0);
  });

  test('lists all four text tokens in one table', () => {
    for (const token of [
      '--av-text-primary',
      '--av-text-secondary',
      '--av-text-muted',
      '--av-text-faint',
    ]) {
      assert.ok(
        system.includes(token),
        `DESIGN_SYSTEM.md must list ${token} in the color/text token section`,
      );
    }
  });

  test('declares a contrast column for each token', () => {
    // The contrast row is the value reviewers cite when flagging a
    // misuse. Pin its presence so a future docs cleanup doesn't drop
    // the AA / AAA markers.
    assert.match(
      system,
      /AAA[\s\S]*AA[\s\S]*fails AA|fails AA[\s\S]*AA[\s\S]*AAA/i,
      'DESIGN_SYSTEM.md must label tier contrasts (AAA / AA / fails AA)',
    );
  });

  test('flags --av-text-faint as auxiliary-only', () => {
    // Same rule as in the brief, mirrored in the systems doc so a
    // reader who only opens DESIGN_SYSTEM.md still gets the warning.
    const re = /--av-text-faint[\s\S]{0,300}(auxiliary|em[- ]dash|disabled|placeholders only|fails? AA)/i;
    assert.match(
      system,
      re,
      'DESIGN_SYSTEM.md must flag --av-text-faint as auxiliary / fails AA',
    );
  });
});
