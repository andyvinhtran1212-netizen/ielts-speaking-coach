/**
 * frontend/tests/anti-flash-iife-canonical.test.mjs — Sprint 6.6.1.
 *
 * Run with: node --test frontend/tests/anti-flash-iife-canonical.test.mjs
 *
 * Closes Codex audit Phase 1 AMBER #1: three of the four redesigned
 * pages (speaking, practice, result) shipped a weak anti-flash IIFE
 * that read `localStorage.getItem('av-theme')` and assigned the raw
 * value to `data-theme` without validating it. Today the only CSS
 * keying is `[data-theme="dark"]`, so a garbage value resolves as
 * light by accident — but the contract is wrong, and the next page to
 * key on `[data-theme="high-contrast"]` would inherit a silent bug.
 *
 * This suite enforces the canonical pattern across all four redesigned
 * pages so a future page that copies an older snippet is caught at
 * the gate. The pattern is documented in DESIGN_SYSTEM.md § 13.
 *
 * It also pins the DESIGN_SYSTEM.md hybrid-state narrative —
 * AMBER #2 (architecture-doc stale) — so drift back to
 * "100% dark navy is the current state" is also caught at the gate.
 *
 * Why DESIGN_SYSTEM.md and not CURRENT_ARCHITECTURE_AND_PRODUCT_DIRECTION.md?
 * The latter is gitignored (personal-notes doc). The tracked design
 * system documentation is the canonical reference for the migration
 * state — DESIGN_SYSTEM.md § 14 is the AMBER #2 closure.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');


// ── Pages that must ship the canonical anti-flash IIFE ───────────


const REDESIGNED_PAGES = [
  'frontend/pages/home.html',
  'frontend/pages/speaking.html',
  'frontend/pages/practice.html',
  'frontend/pages/result.html',
  'frontend/pages/writing-dashboard.html',
  'frontend/pages/writing-result.html',
  'frontend/pages/full-test-result.html',
  'frontend/pages/vocabulary.html',
  'frontend/pages/my-vocabulary.html',
  'frontend/pages/flashcards.html',
  'frontend/pages/exercises.html',
  'frontend/pages/profile.html',
  'frontend/onboarding.html',
  'frontend/index.html',
  'frontend/pricing.html',
  'frontend/pages/admin-writing.html',
  'frontend/pages/admin-writing-new.html',
  'frontend/pages/admin-writing-status.html',
  'frontend/pages/admin-writing-prompts.html',
  'frontend/pages/admin-writing-assignments.html',
  'frontend/pages/admin-students.html',
  'frontend/pages/admin-instructor-queue.html',
  'frontend/pages/admin-writing-grade.html',
  'frontend/admin.html',
];


for (const rel of REDESIGNED_PAGES) {
  describe(`anti-flash IIFE / ${rel}`, () => {
    const html = readFileSync(path.join(REPO_ROOT, rel), 'utf8');

    test('reads localStorage av-theme', () => {
      assert.match(
        html,
        /localStorage\.getItem\(\s*['"]av-theme['"]\s*\)/,
        `${rel}: IIFE must read localStorage 'av-theme'`,
      );
    });

    test('validates the stored value (AMBER #1 fix)', () => {
      // Accept either the explicit equality form (home.html canonical) or
      // the indexOf / VALID_THEMES.includes forms — they're equivalent in
      // intent. Reject the page if no validation form is present.
      const explicitForm = /stored\s*===\s*['"](?:light|dark)['"]\s*\|\|\s*stored\s*===\s*['"](?:light|dark)['"]/;
      const indexOfForm  = /(?:validValues|VALID_THEMES)?\s*\.?\s*indexOf\s*\(\s*stored/;
      const includesForm = /(?:validValues|VALID_THEMES)\.includes\s*\(\s*stored/;
      assert.ok(
        explicitForm.test(html) || indexOfForm.test(html) || includesForm.test(html),
        `${rel}: IIFE does not validate the stored value. ` +
        `Use the canonical pattern from DESIGN_SYSTEM.md § 13 ` +
        `((stored === 'light' || stored === 'dark') ? stored : ...).`,
      );
    });

    test('falls back to system preference when stored invalid', () => {
      assert.match(
        html,
        /prefers-color-scheme:\s*dark/,
        `${rel}: missing prefers-color-scheme system preference fallback`,
      );
    });

    test('has try/catch wrapping the localStorage access', () => {
      // The IIFE must wrap localStorage in try/catch so privacy-mode
      // browsers (where getItem throws) don't crash the page.
      assert.match(
        html,
        /try\s*\{[\s\S]*?localStorage\.getItem[\s\S]*?\}\s*catch\s*\(/,
        `${rel}: IIFE must wrap localStorage access in try/catch`,
      );
    });

    test('does NOT use the weak `var theme = stored ||` short-circuit', () => {
      // The pre-Sprint-6.6.1 weak pattern: `var theme = stored || (...)`.
      // It assigns the raw stored value to data-theme without validating —
      // any string at all flows through.
      const weakPattern = /var\s+theme\s*=\s*stored\s*\|\|/;
      assert.ok(
        !weakPattern.test(html),
        `${rel}: IIFE uses the weak \`var theme = stored ||\` short-circuit. ` +
        `Replace with the canonical (stored === 'light' || stored === 'dark') check ` +
        `(see DESIGN_SYSTEM.md § 13).`,
      );
    });

    test('catch arm hardcodes data-theme="light" (last-resort fallback)', () => {
      // If the catch arm sets dark, a privacy-mode user who prefers light
      // gets dark on every page load. The canonical pattern uses 'light'
      // as the last-resort because it's the fallback if matchMedia is
      // also unavailable.
      assert.match(
        html,
        /catch\s*\([^)]*\)\s*\{\s*document\.documentElement\.setAttribute\(\s*['"]data-theme['"]\s*,\s*['"]light['"]\s*\)/,
        `${rel}: catch arm must set data-theme="light" as the last-resort fallback`,
      );
    });
  });
}


// ── DESIGN_SYSTEM.md / canonical snippet documentation ────────────


describe('DESIGN_SYSTEM.md / canonical anti-flash bootstrap documented', () => {
  const md = readFileSync(
    path.join(REPO_ROOT, 'frontend/css/aver-design/DESIGN_SYSTEM.md'),
    'utf8',
  );

  test('documents the canonical anti-flash bootstrap', () => {
    assert.match(
      md,
      /canonical\s+anti-flash\s+(theme\s+)?bootstrap/i,
      'DESIGN_SYSTEM.md should have a "Canonical anti-flash bootstrap" section',
    );
  });

  test('canonical snippet includes the validation form', () => {
    // The snippet itself should show the (stored === 'light' || stored === 'dark') form.
    assert.match(
      md,
      /stored\s*===\s*['"](?:light|dark)['"]\s*\|\|\s*stored\s*===\s*['"](?:light|dark)['"]/,
      'DESIGN_SYSTEM.md canonical snippet must include the explicit validation check',
    );
  });

  test('documents the weak fallback as an anti-pattern', () => {
    assert.match(
      md,
      /Anti-pattern|anti-pattern/,
      'DESIGN_SYSTEM.md should label the weak `var theme = stored ||` form as an anti-pattern',
    );
    assert.match(
      md,
      /var\s+theme\s*=\s*stored\s*\|\|/,
      'DESIGN_SYSTEM.md should show the weak pattern explicitly so the reader can spot it',
    );
  });
});


// ── DESIGN_SYSTEM.md / Phase 1 hybrid state (AMBER #2) ────────────


describe('DESIGN_SYSTEM.md / Phase 1 hybrid state (AMBER #2)', () => {
  // Sprint 6.6.1 — the canonical migration-state narrative lives here
  // because CURRENT_ARCHITECTURE_AND_PRODUCT_DIRECTION.md is gitignored
  // (personal-notes doc). DESIGN_SYSTEM.md is the tracked source of
  // truth for the design system, so the audit closure pins live here.
  const md = readFileSync(
    path.join(REPO_ROOT, 'frontend/css/aver-design/DESIGN_SYSTEM.md'),
    'utf8',
  );

  test('has a Phase 1+ hybrid state section (§ 14)', () => {
    // The heading evolved from "Phase 1 hybrid state" (Sprint 6.6.1) to
    // "Phase 1–3 hybrid state" (Sprint 6.12b closure). Accept either —
    // the section number (§ 14) is what really matters.
    assert.match(
      md,
      /## 14\.\s+Phase 1(?:[–-]\d+)? hybrid state/,
      'DESIGN_SYSTEM.md must have a "Phase 1+ hybrid state" section (§ 14)',
    );
  });

  test('documents the --av-* token namespace as canonical going forward', () => {
    assert.match(
      md,
      /--av-\*/,
      'DESIGN_SYSTEM.md must mention the --av-* token namespace',
    );
  });

  test('documents the hybrid state explicitly', () => {
    assert.match(
      md,
      /HYBRID\s+state|hybrid\s+state/,
      'DESIGN_SYSTEM.md must call the post-Phase-1 reality a hybrid state',
    );
  });

  test('does NOT claim 100% dark navy as the current canonical theme', () => {
    // We mention "Sprint 6.2 dark-navy era" as historical context (the
    // legacy pages still render dark), so allow that phrasing. Flag only
    // if "100% dark navy" reappears as a current-state claim.
    assert.ok(
      !/(currently|current state)\s+(is\s+)?100%\s+dark/i.test(md),
      'DESIGN_SYSTEM.md must not claim 100% dark as the current state — Phase 1 made the app hybrid',
    );
  });

  test('mentions all 4 Phase 1 redesigned pages', () => {
    for (const page of ['home.html', 'speaking.html', 'practice.html', 'result.html']) {
      assert.ok(
        md.includes(page),
        `DESIGN_SYSTEM.md § 14 missing reference to ${page} in the Phase 1 redesigned-pages list`,
      );
    }
  });

  test('documents ds.css as compatibility layer (do-not-modify)', () => {
    assert.match(
      md,
      /ds\.css\s+(MUST NOT|must not)/,
      'DESIGN_SYSTEM.md § 14 must explain that ds.css is the compatibility bridge (and not to be modified)',
    );
  });

  test('mentions the Phase 2-4 forward path', () => {
    assert.match(
      md,
      /Phase 2/,
      'DESIGN_SYSTEM.md § 14 must outline the Phase 2-4 forward path so future contributors know the migration order',
    );
  });

  test('includes the Codex audit reference for AMBER #2 closure', () => {
    assert.match(
      md,
      /CODEX_AUDIT_PHASE_1|AMBER\s*#?\s*2|audit\s+Phase\s+1/i,
      'DESIGN_SYSTEM.md § 14 must reference the Codex audit so the closure rationale is discoverable',
    );
  });
});
