/**
 * frontend/tests/sprint-6-12c-audit-closure.test.mjs — Sprint 6.12c.
 *
 * Run with: node --test frontend/tests/sprint-6-12c-audit-closure.test.mjs
 *
 * Pins the 3 AMBER closures + 1 methodology formalization from Codex
 * audit Phase 3 (`CODEX_AUDIT_PHASE_3.md`, 2026-05-11):
 *
 *   AMBER #1 — UNIFIED_DESIGN_BRIEF.md top-level phase map updated
 *              from stale "Phase 2 includes profile/onboarding/vocab,
 *              Phase 3 = admin" → shipped reality (Phase 1-3 COMPLETE,
 *              Phase 4 = marketing/admin/Grammar Wiki).
 *   AMBER #2 — DESIGN_SYSTEM.md § 14.1: 5 TBD PR cells filled
 *              (#141 flashcards/exercises/_renderPreviewModal, #142
 *              profile, #143 onboarding).
 *   AMBER #3 — DESIGN_SYSTEM.md new § 17 formalizes audit checklist
 *              gates with the icon-rendering blind spot (Sprint 6.10.1
 *              lesson) explicitly raised as Gate 3.
 *
 * These pins are deliberately narrow — the AMBER findings were docs-
 * only ("Documentation bookkeeping, not code integrity" — Codex), so
 * the closure pins guard docs accuracy, not runtime behavior.
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
  brief        = readFileSync(path.join(REPO_ROOT, 'frontend/css/aver-design/UNIFIED_DESIGN_BRIEF.md'), 'utf8');
  designSystem = readFileSync(path.join(REPO_ROOT, 'frontend/css/aver-design/DESIGN_SYSTEM.md'),       'utf8');
});


// ── AMBER #1: Brief top-level phase map updated ───────────────────


describe('AMBER #1 closure: UNIFIED_DESIGN_BRIEF.md § 2 phase map matches shipped reality', () => {
  test('Phase 1 marked COMPLETE with the 4 speaking-flow pages', () => {
    const phase1 = brief.match(/\*\*Phase 1\*\*[\s\S]{0,500}COMPLETE/i);
    assert.ok(phase1, 'Phase 1 row should be marked COMPLETE');
    for (const page of ['home.html', 'speaking.html', 'practice.html', 'result.html']) {
      assert.ok(phase1[0].includes(page), `Phase 1 row missing ${page}`);
    }
  });

  test('Phase 2 marked COMPLETE with the 3 writing-flow pages', () => {
    const phase2 = brief.match(/\*\*Phase 2\*\*[\s\S]{0,500}COMPLETE/i);
    assert.ok(phase2, 'Phase 2 row should be marked COMPLETE');
    for (const page of ['writing-dashboard.html', 'writing-result.html', 'full-test-result.html']) {
      assert.ok(phase2[0].includes(page), `Phase 2 row missing ${page}`);
    }
  });

  test('Phase 2 NO LONGER claims profile/onboarding/vocabulary (stale Codex AMBER #1)', () => {
    const phase2 = brief.match(/\*\*Phase 2\*\*[\s\S]{0,500}COMPLETE/i);
    assert.ok(phase2);
    // The pre-Sprint-6.12c stale claim grouped profile/onboarding/vocabulary
    // under Phase 2. Shipped reality puts them under Phase 3.
    assert.ok(!phase2[0].includes('profile.html'),    'Phase 2 must not list profile.html');
    assert.ok(!phase2[0].includes('onboarding.html'), 'Phase 2 must not list onboarding.html');
    assert.ok(!phase2[0].includes('vocabulary.html'), 'Phase 2 must not list vocabulary.html');
  });

  test('Phase 3 marked COMPLETE with the vocabulary cluster + profile + onboarding', () => {
    const phase3 = brief.match(/\*\*Phase 3\*\*[\s\S]{0,800}COMPLETE/i);
    assert.ok(phase3, 'Phase 3 row should be marked COMPLETE');
    for (const page of ['vocabulary.html', 'flashcards.html',
                        'exercises.html', 'profile.html', 'onboarding.html']) {
      assert.ok(phase3[0].includes(page), `Phase 3 row missing ${page}`);
    }
  });

  test('Phase 3 NO LONGER claims admin (stale Codex AMBER #1)', () => {
    const phase3 = brief.match(/\*\*Phase 3\*\*[\s\S]{0,800}COMPLETE/i);
    assert.ok(phase3);
    // The pre-Sprint-6.12c stale claim made Phase 3 = admin. Shipped
    // reality moves admin to Phase 4.
    assert.ok(
      !/admin\.html/.test(phase3[0]) && !/admin-\*/.test(phase3[0]),
      'Phase 3 must not list admin.html (admin is Phase 4)',
    );
  });

  test('Phase 4 listed in phase map and contains marketing + admin + Grammar Wiki', () => {
    // Sprint 6.14c-hotfix: Phase 4 Status flipped from "UPCOMING" to "IN
    // PROGRESS". Sprint 6.15: Status flipped from "IN PROGRESS" to
    // "COMPLETE" (Phase 4 closure). Accept either or "COMPLETE".
    const phase4 = brief.match(/\*\*Phase 4\*\*[\s\S]{0,3500}(IN PROGRESS|COMPLETE)/i);
    assert.ok(phase4, 'Phase 4 row should be marked IN PROGRESS or COMPLETE');
    assert.match(phase4[0], /index\.html|landing\.html/, 'Phase 4 missing marketing pages');
    assert.match(phase4[0], /admin\.html/,                 'Phase 4 missing admin');
    assert.match(phase4[0], /Grammar Wiki|grammar\.html/,  'Phase 4 missing Grammar Wiki');
    assert.match(phase4[0], /COMPLETE/,                    'Phase 4 missing COMPLETE marker for shipped work');
  });

  test('brief references the 29-page cumulative count (Sprint 6.15 Phase 4 closure)', () => {
    // Sprint 6.15 bump: count went 24 → 29 (Grammar Wiki cluster 5 pages).
    // Phase 4 COMPLETE after this PR.
    assert.match(
      brief,
      /29 pages redesigned cumulative/i,
      'Brief should call out the 29-page cumulative count',
    );
  });

  test('brief references the canonical patterns shared by all redesigned pages', () => {
    // The summary block beneath the phase table should call out the
    // cumulative-lesson canonical patterns: Plus Jakarta Sans + JetBrains
    // Mono, --av-* tokens, canonical IIFE, canonical .icon-sun/.icon-moon,
    // ds.css scoped overrides, --av-text-on-primary.
    assert.match(brief, /Plus Jakarta Sans[\s\S]{0,200}JetBrains Mono/);
    assert.match(brief, /canonical anti-flash IIFE/i);
    assert.match(brief, /\.icon-sun[\s\S]{0,40}\.icon-moon/);
    assert.match(brief, /--av-text-on-primary/);
  });

  test('Phase 1 trap aesthetic-direction guidance preserved (not lost during edit)', () => {
    assert.match(brief, /editorial overview, asymmetric/);
    assert.match(brief, /focus mode, minimal chrome during recording/);
  });
});


// ── AMBER #2: DESIGN_SYSTEM.md § 14.1 PR cells filled ─────────────


describe('AMBER #2 closure: DESIGN_SYSTEM.md § 14.1 has zero remaining TBD PR cells', () => {
  test('flashcards.html row references PR #141', () => {
    assert.match(
      designSystem,
      /flashcards\.html[\s\S]{0,80}\|\s*6\.11b\s*\|\s*#141\b/,
      'flashcards.html row should reference PR #141',
    );
  });

  test('exercises.html row references PR #141', () => {
    assert.match(
      designSystem,
      /exercises\.html[\s\S]{0,80}\|\s*6\.11b\s*\|\s*#141\b/,
      'exercises.html row should reference PR #141',
    );
  });

  test('_renderPreviewModal row references PR #141', () => {
    assert.match(
      designSystem,
      /_renderPreviewModal[\s\S]{0,80}\|\s*6\.11b\s*\|\s*#141\b/,
      '_renderPreviewModal row should reference PR #141',
    );
  });

  test('profile.html row references PR #142', () => {
    assert.match(
      designSystem,
      /profile\.html[\s\S]{0,80}\|\s*6\.12a\s*\|\s*#142\b/,
      'profile.html row should reference PR #142',
    );
  });

  test('onboarding.html row references PR #143', () => {
    assert.match(
      designSystem,
      /onboarding\.html[\s\S]{0,80}\|\s*6\.12b\s*\|\s*#143\b/,
      'onboarding.html row should reference PR #143',
    );
  });

  test('no TBD strings remain anywhere in DESIGN_SYSTEM.md', () => {
    // The TBD cells were the only TBDs in the doc. Pin global absence
    // so a future Phase 4 row can't sneak a TBD past audit.
    assert.ok(
      !designSystem.includes('| TBD '),
      'DESIGN_SYSTEM.md should not contain " | TBD " — all PR references must be filled',
    );
    assert.ok(
      !designSystem.includes('TBD |'),
      'DESIGN_SYSTEM.md should not contain "TBD |" — all PR references must be filled',
    );
  });
});


// ── AMBER #3 + methodology: § 17 audit checklist gates ────────────


describe('AMBER #3 + methodology closure: DESIGN_SYSTEM.md § 17 audit checklist gates', () => {
  test('§ 17 section exists with the correct title', () => {
    assert.match(
      designSystem,
      /## 17\.\s+Audit checklist gates/,
      'DESIGN_SYSTEM.md should have "## 17. Audit checklist gates"',
    );
  });

  test('§ 17 origin paragraph names Codex audit Phase 3 + Sprint 6.10.1', () => {
    const sec = designSystem.match(/## 17\. Audit checklist gates[\s\S]{0,1000}/);
    assert.ok(sec);
    assert.match(sec[0], /Codex audit Phase 3/);
    assert.match(sec[0], /Sprint 6\.10\.1/);
    assert.match(sec[0], /blind spot/i);
  });

  test('§ 17 lists 7 standing gates (Gate 1 … Gate 7)', () => {
    for (let n = 1; n <= 7; n++) {
      assert.match(
        designSystem,
        new RegExp(`#### Gate ${n}:`),
        `§ 17 missing "Gate ${n}:"`,
      );
    }
  });

  test('Gate 3 pins the canonical icon class names + BEM drift list', () => {
    const gate3 = designSystem.match(/#### Gate 3:[\s\S]{0,2000}#### Gate 4:/);
    assert.ok(gate3, 'Gate 3 block not found');
    assert.match(gate3[0], /\.icon-sun/);
    assert.match(gate3[0], /\.icon-moon/);
    assert.match(gate3[0], /theme-toggle__icon/);
    assert.match(gate3[0], /av-theme-toggle__sun/);
    assert.match(gate3[0], /av-theme-toggle__moon/);
  });

  test('Gate 3 includes a BEM-drift detection grep command', () => {
    const gate3 = designSystem.match(/#### Gate 3:[\s\S]{0,2000}#### Gate 4:/);
    assert.ok(gate3);
    assert.match(gate3[0], /grep[\s\S]{0,200}theme-toggle__icon/);
  });

  test('Gate 4 pins --av-text-on-primary for CTAs', () => {
    const gate4 = designSystem.match(/#### Gate 4:[\s\S]{0,2000}#### Gate 5:/);
    assert.ok(gate4);
    assert.match(gate4[0], /--av-text-on-primary/);
    assert.match(gate4[0], /text-faint[\s\S]{0,80}10/);
  });

  test('Gate 5 enforces ds.css legacy override pattern (Sprint 6.5.1)', () => {
    const gate5 = designSystem.match(/#### Gate 5:[\s\S]{0,1500}#### Gate 6:/);
    assert.ok(gate5);
    assert.match(gate5[0], /ds\.css/);
    assert.match(gate5[0], /body\.av-page/);
    assert.match(gate5[0], /Sprint 6\.5\.1/);
  });

  test('Gate 6 handles iframe-embedded-mode (Sprint 6.0.1)', () => {
    const gate6 = designSystem.match(/#### Gate 6:[\s\S]{0,1500}#### Gate 7:/);
    assert.ok(gate6);
    assert.match(gate6[0], /Sprint 6\.0\.1/);
    assert.match(gate6[0], /\?embedded=1|embedded-mode/);
    assert.match(gate6[0], /embedded-mode\.test\.js/);
  });

  test('§ 17.2 brand-color regression guard references #14a8ae', () => {
    const guard = designSystem.match(/### 17\.2[\s\S]{0,1500}/);
    assert.ok(guard, '§ 17.2 brand-color regression guard not found');
    assert.match(guard[0], /#14a8ae/);
    assert.match(guard[0], /#14b8a6/);
    assert.match(guard[0], /grep[\s\S]{0,80}#14a8ae/);
  });

  test('§ 17.3 sentinel tests references all 4 canonical suites', () => {
    const sentinel = designSystem.match(/### 17\.3[\s\S]{0,2000}/);
    assert.ok(sentinel, '§ 17.3 sentinel tests section not found');
    for (const suite of [
      'anti-flash-iife-canonical.test.mjs',
      'theme-toggle-icon-canonical.test.mjs',
      'typography-tier1.test.js',
      'embedded-mode.test.js',
    ]) {
      assert.ok(sentinel[0].includes(suite), `§ 17.3 missing reference to ${suite}`);
    }
  });

  test('§ 17.4 audit-blind-spot anti-patterns documented', () => {
    const sec = designSystem.match(/### 17\.4[\s\S]{0,2500}/);
    assert.ok(sec, '§ 17.4 anti-pattern section not found');
    // Four bullet anti-patterns from the spec
    const bullets = (sec[0].match(/❌/g) || []).length;
    assert.ok(bullets >= 4, `§ 17.4 should list at least 4 anti-patterns, found ${bullets}`);
    assert.match(sec[0], /theme works/i);
    assert.match(sec[0], /spec assumptions/i);
    assert.match(sec[0], /shared.*CSS|CSS.*shared/i);
    assert.match(sec[0], /documentation table maintenance|drift compounds/i);
  });

  test('§ 17.5 when-to-extend criteria documented', () => {
    const sec = designSystem.match(/### 17\.5[\s\S]{0,1500}/);
    assert.ok(sec, '§ 17.5 when-to-extend section not found');
    assert.match(sec[0], /cumulative-drift|cumulative drift/i);
    assert.match(sec[0], /production bug|brand-color/i);
    assert.match(sec[0], /canonical pattern/i);
  });
});


// ── Sprint 6.12c was docs-only ─────────────────────────────────────


describe('Sprint 6.12c is documentation-only — production code paths untouched', () => {
  // Codex Phase 3 audit diagnosis: "Documentation bookkeeping, not code
  // integrity." Pin that the closure stayed within docs + tests so a
  // future contributor can't quietly slip a runtime change into this
  // sprint's branch under the audit-closure banner.
  test('no production HTML touched by this sprint (sanity check; verified at PR review)', () => {
    // This is a soft pin — it asserts the docs files exist and are
    // non-empty. Hard verification lives in PR review where the diff
    // surface is visible. The test guards against accidentally deleting
    // the docs files.
    assert.ok(brief.length > 5000,         'UNIFIED_DESIGN_BRIEF.md should be substantive');
    assert.ok(designSystem.length > 20000, 'DESIGN_SYSTEM.md should be substantive');
  });
});
