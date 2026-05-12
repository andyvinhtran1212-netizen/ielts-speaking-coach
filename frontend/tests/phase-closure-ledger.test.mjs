/**
 * frontend/tests/phase-closure-ledger.test.mjs — Gate 8 (Sprint 6.15.3-hotfix).
 *
 * Pins the `PHASE_CLOSURE_LEDGER.md` source-of-truth file against the
 * doc claims and filesystem state it consolidates. When the ledger
 * drifts from the docs (or vice versa), this suite fails — closure
 * truth requires audit before proceeding.
 *
 * Formalized in DESIGN_SYSTEM.md § 17.7 (Gate 8). Origin: pattern
 * convergence between the HANDOFF Sprint 6.15+ PR #129 stale-tracking
 * discovery and the Codex Phase 4 closure audit AMBER #2.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

let ledger;
let designSystem;
let brief;
let vercelConfig;

before(() => {
  ledger        = readFileSync(path.join(REPO_ROOT, 'PHASE_CLOSURE_LEDGER.md'),                    'utf8');
  designSystem  = readFileSync(path.join(REPO_ROOT, 'frontend/css/aver-design/DESIGN_SYSTEM.md'),  'utf8');
  brief         = readFileSync(path.join(REPO_ROOT, 'frontend/css/aver-design/UNIFIED_DESIGN_BRIEF.md'), 'utf8');
  vercelConfig  = readFileSync(path.join(REPO_ROOT, 'frontend/vercel.json'),                       'utf8');
});


// ── Ledger structure verification ────────────────────────────────


describe('PHASE_CLOSURE_LEDGER.md / ledger structure', () => {
  test('all 4 phases marked COMPLETE', () => {
    for (const phase of ['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4']) {
      assert.match(
        ledger,
        new RegExp(`${phase}[^\\n]{0,200}COMPLETE`, 'i'),
        `Ledger should mark ${phase} as COMPLETE`,
      );
    }
  });

  test('cumulative count is 29 pages redesigned', () => {
    assert.match(ledger, /29 pages redesigned/i,
      'Ledger should affirm 29 pages redesigned cumulative');
  });

  test('zero --ds-* pages affirmed', () => {
    assert.match(ledger, /[Zz]ero pages on `?--ds-\*`?/,
      'Ledger should affirm zero pages on --ds-* tokens');
  });

  test('admin.html marked STRUCTURALLY COMPLETE (not bare COMPLETE)', () => {
    const adminRow = ledger.match(/\*\*admin\*\*[\s\S]{0,500}/);
    assert.ok(adminRow, 'admin.html ledger row not found');
    assert.match(adminRow[0], /STRUCTURALLY COMPLETE/i,
      'admin.html should be marked STRUCTURALLY COMPLETE');
  });

  test('Sprint 6.14d-β and 6.14d-γ deferrals documented in ledger', () => {
    assert.match(ledger, /6\.14d-β/, 'Ledger should document Sprint 6.14d-β');
    assert.match(ledger, /6\.14d-γ/, 'Ledger should document Sprint 6.14d-γ');
  });

  test('ds.css preserved as compatibility bridge', () => {
    assert.match(
      ledger,
      /ds\.css.+(preserved|compatibility bridge)|(preserved|compatibility bridge).+ds\.css/i,
      'Ledger should document ds.css preservation rationale',
    );
  });

  test('admin-writing.css at-cap status documented (10/10)', () => {
    assert.match(
      ledger,
      /admin-writing\.css.+(at-cap|10\s*\/\s*10)|10\s*\/\s*10.+admin-writing\.css/i,
      'Ledger should document admin-writing.css at-cap status',
    );
  });

  test('11 cumulative audit hotfixes documented (post Sprint 6.15.6-hotfix)', () => {
    assert.match(ledger, /11 audit hotfixes/i,
      'Ledger should mention 11 cumulative audit hotfixes after Sprint 6.15.6-hotfix');
  });
});


// ── Cross-reference verification (DESIGN_SYSTEM.md + brief) ────────


describe('PHASE_CLOSURE_LEDGER.md / cross-reference DESIGN_SYSTEM.md + brief', () => {
  test('29-page count present in DESIGN_SYSTEM.md', () => {
    assert.match(designSystem, /29 pages|29 redesigned/i,
      'DESIGN_SYSTEM.md should reference 29 pages');
  });

  test('29-page count present in UNIFIED_DESIGN_BRIEF.md § 2', () => {
    assert.match(brief, /29 pages|29 redesigned/i,
      'Brief should reference 29 pages');
  });

  test('admin.html STRUCTURALLY COMPLETE status consistent in DESIGN_SYSTEM.md', () => {
    assert.match(
      designSystem,
      /admin\.html[\s\S]{0,500}STRUCTURALLY COMPLETE|STRUCTURALLY COMPLETE[\s\S]{0,500}admin\.html/i,
      'DESIGN_SYSTEM.md should mark admin.html as STRUCTURALLY COMPLETE',
    );
  });

  test('ds.css compatibility-bridge claim consistent across ledger + DESIGN_SYSTEM.md', () => {
    assert.match(designSystem, /ds\.css[\s\S]{0,400}compatibility bridge|compatibility bridge[\s\S]{0,400}ds\.css/i,
      'DESIGN_SYSTEM.md should document ds.css as compatibility bridge');
  });

  test('zero --ds-* claim consistent across ledger + brief', () => {
    assert.match(brief, /zero pages on legacy `?--ds-\*`?|zero pages.+--ds-\*/i,
      'Brief should affirm zero --ds-* pages');
  });
});


// ── Deleted pages verification ───────────────────────────────────


describe('PHASE_CLOSURE_LEDGER.md / deleted pages verification', () => {
  test('ledger documents dashboard.html deletion (Sprint 5.1, commit 3f4ff14)', () => {
    assert.match(ledger, /dashboard[\s\S]{0,200}Sprint 5\.1/i,
      'Ledger should document dashboard.html deletion in Sprint 5.1');
    assert.match(ledger, /3f4ff14/,
      'Ledger should cite the 3f4ff14 deletion commit');
  });

  test('ledger documents landing.html deletion (Sprint 6.13a)', () => {
    assert.match(ledger, /landing[\s\S]{0,200}Sprint 6\.13a/i,
      'Ledger should document landing.html deletion in Sprint 6.13a');
  });

  test('dashboard.html does NOT exist in filesystem', () => {
    assert.ok(
      !existsSync(path.join(REPO_ROOT, 'frontend/pages/dashboard.html')),
      'dashboard.html should not exist (deleted Sprint 5.1)',
    );
  });

  test('landing.html does NOT exist in filesystem', () => {
    assert.ok(
      !existsSync(path.join(REPO_ROOT, 'frontend/landing.html')),
      'landing.html should not exist (deleted Sprint 6.13a)',
    );
  });

  test('replacement pages exist (home.html + index.html)', () => {
    assert.ok(existsSync(path.join(REPO_ROOT, 'frontend/pages/home.html')),
      'home.html (dashboard replacement) should exist');
    assert.ok(existsSync(path.join(REPO_ROOT, 'frontend/index.html')),
      'index.html (landing replacement) should exist');
  });
});


// ── Vercel routing verification ──────────────────────────────────


describe('PHASE_CLOSURE_LEDGER.md / Vercel routing verification', () => {
  test('vercel.json 301 redirect for dashboard.html → speaking.html preserved', () => {
    assert.match(
      vercelConfig,
      /\/pages\/dashboard\.html[\s\S]{0,300}\/pages\/speaking\.html/,
      'Vercel 301 redirect /pages/dashboard.html → /pages/speaking.html must be preserved',
    );
  });

  test('vercel.json dashboard.html redirect marked permanent: true', () => {
    const entry = vercelConfig.match(/\{[^}]*\/pages\/dashboard\.html[^}]*\}/);
    assert.ok(entry, 'Could not locate dashboard.html redirect entry');
    assert.match(entry[0], /"permanent"\s*:\s*true/i,
      'dashboard.html redirect must be permanent: true');
  });
});


// ── Live verification: admin-writing.css cap discipline ──────────


describe('PHASE_CLOSURE_LEDGER.md / live cap discipline verification', () => {
  test('admin-writing.css --av-text-faint count <= 10 (§ 17.6 cap)', () => {
    const css = readFileSync(path.join(REPO_ROOT, 'frontend/css/admin-writing.css'), 'utf8');
    const faintCount = (css.match(/var\(--av-text-faint\)/g) || []).length;
    assert.ok(faintCount <= 10,
      `admin-writing.css has ${faintCount} --av-text-faint usages, exceeds cap of 10`);
  });

  test('admin-writing.css cap snapshot still at 10 (at-cap)', () => {
    const css = readFileSync(path.join(REPO_ROOT, 'frontend/css/admin-writing.css'), 'utf8');
    const faintCount = (css.match(/var\(--av-text-faint\)/g) || []).length;
    assert.equal(faintCount, 10,
      `Expected admin-writing.css at exactly 10 --av-text-faint (at-cap snapshot), got ${faintCount}`);
  });
});


// ── Gate 8 documentation verification (§ 17.7) ────────────────────


describe('Gate 8 formalization in DESIGN_SYSTEM.md § 17.7', () => {
  test('§ 17.7 section exists and references Phase closure ledger', () => {
    assert.match(designSystem, /### 17\.7\s+Phase closure ledger/i,
      'DESIGN_SYSTEM.md must have § 17.7 Phase closure ledger section');
  });

  test('§ 17.7 names Gate 8 explicitly', () => {
    assert.match(designSystem, /Gate 8/,
      '§ 17.7 should explicitly name Gate 8');
  });

  test('§ 17.7 documents the update protocol', () => {
    const section = designSystem.match(/### 17\.7[\s\S]*?(?=\n## |\n### 17\.8|$)/);
    assert.ok(section, '§ 17.7 not found');
    assert.match(section[0], /[Uu]pdate protocol/,
      '§ 17.7 should document the update protocol');
  });

  test('§ 17.7 includes anti-pattern guidance', () => {
    const section = designSystem.match(/### 17\.7[\s\S]*?(?=\n## |\n### 17\.8|$)/);
    assert.ok(section);
    assert.match(section[0], /Anti-pattern|anti-pattern|❌/,
      '§ 17.7 should include anti-pattern guidance');
  });

  test('§ 17.7 cites origin (Sprint 6.15+ PR #129 + Codex AMBER #2)', () => {
    const section = designSystem.match(/### 17\.7[\s\S]*?(?=\n## |\n### 17\.8|$)/);
    assert.ok(section);
    assert.match(
      section[0],
      /Sprint 6\.15.+PR #129|PR #129.+Sprint 6\.15|Codex.+AMBER\s*#?\s*2/i,
      '§ 17.7 should cite the origin (PR #129 stale tracking + Codex AMBER #2)',
    );
  });
});


// ── admin.html renderer-deferred comment markers (AMBER #1) ───────


describe('admin.html / Sprint 6.14d-α deferred comment markers (AMBER #1 closure)', () => {
  let adminHtml;

  before(() => {
    adminHtml = readFileSync(path.join(REPO_ROOT, 'frontend/admin.html'), 'utf8');
  });

  test('exactly 4 deferred-region comment markers present', () => {
    const markers = (adminHtml.match(/SPRINT 6\.14d-α DEFERRED: renderer-emitted inline palette/g) || []).length;
    assert.equal(markers, 4,
      `Expected 4 deferred-region markers in admin.html, got ${markers}`);
  });

  test('each marker references DESIGN_SYSTEM.md § 14.5.2/3 triggers', () => {
    const triggerRefs = (adminHtml.match(/§ 14\.5\.2\/3/g) || []).length;
    assert.ok(triggerRefs >= 4,
      `Expected ≥4 § 14.5.2/3 trigger refs across the 4 markers, got ${triggerRefs}`);
  });

  test('each marker carries the canonical anti-pattern warning', () => {
    const warnings = (adminHtml.match(/DO NOT add more inline hex\/rgba palette logic/g) || []).length;
    assert.equal(warnings, 4,
      `Expected 4 anti-pattern warnings (one per marker), got ${warnings}`);
  });

  test('each marker uses the "chrome-complete, renderer-deferred" treatment label', () => {
    const labels = (adminHtml.match(/chrome-complete, renderer-deferred/g) || []).length;
    assert.equal(labels, 4,
      `Expected 4 treatment labels, got ${labels}`);
  });
});
