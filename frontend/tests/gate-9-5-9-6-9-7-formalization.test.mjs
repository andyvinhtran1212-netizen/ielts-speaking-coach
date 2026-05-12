/**
 * frontend/tests/gate-9-5-9-6-9-7-formalization.test.mjs
 *
 * Sprint 6.16.1 — pins for the Gate 9.5 + 9.6 + 9.7 triple
 * formalization in DESIGN_SYSTEM.md § 17.9 / § 17.10 / § 17.11.
 *
 * Pure docs sprint. These pins verify that the three new sections
 * exist, document the correct origin sprint each, and that the
 * cumulative 12-gate consolidation table includes every gate.
 *
 * Origin: 5 cumulative audit blind-spot instances (6.10.1 + 6.15.4 +
 * 6.15.5 + 6.15.6 + 6.15.7) — see § 17.12 for the evolution table.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

let designSystem;
let ledger;

before(() => {
  designSystem = readFileSync(path.join(REPO_ROOT, 'frontend/css/aver-design/DESIGN_SYSTEM.md'), 'utf8');
  ledger       = readFileSync(path.join(REPO_ROOT, 'PHASE_CLOSURE_LEDGER.md'),                   'utf8');
});


// ── § 17.9 Gate 9.5 ───────────────────────────────────────────────


describe('DESIGN_SYSTEM.md § 17.9 — Gate 9.5 (runtime-render inheritance)', () => {
  test('§ 17.9 heading exists', () => {
    assert.match(designSystem, /###\s*17\.9\b[^\n]*Gate 9\.5/i,
      'Expected ### 17.9 ... Gate 9.5 heading in DESIGN_SYSTEM.md');
  });

  test('Sprint 6.15.5 origin documented in § 17.9', () => {
    const section = designSystem.match(/###\s*17\.9[\s\S]{0,6000}?(?=\n###\s*17\.)/);
    assert.ok(section, '§ 17.9 section body not extractable');
    assert.match(section[0], /Sprint 6\.15\.5/i,
      '§ 17.9 should document Sprint 6.15.5-hotfix as the filing origin');
  });

  test('§ 17.9 mentions class-less / runtime-rendered HTML concept', () => {
    const section = designSystem.match(/###\s*17\.9[\s\S]{0,6000}?(?=\n###\s*17\.)/);
    assert.ok(section);
    assert.match(section[0], /class-less|markdown|runtime-render/i,
      '§ 17.9 should explain class-less / runtime-rendered HTML root cause');
  });

  test('§ 17.9 documents descendant-vs-compound selector trap', () => {
    const section = designSystem.match(/###\s*17\.9[\s\S]{0,6000}?(?=\n###\s*17\.)/);
    assert.ok(section);
    assert.match(section[0], /descendant.*compound|compound.*descendant|body.*\.text-white|body\.av-page\.text-white/i,
      '§ 17.9 should document the descendant-vs-compound selector distinction');
  });
});


// ── § 17.10 Gate 9.6 ──────────────────────────────────────────────


describe('DESIGN_SYSTEM.md § 17.10 — Gate 9.6 (structural layout context)', () => {
  test('§ 17.10 heading exists', () => {
    assert.match(designSystem, /###\s*17\.10\b[^\n]*Gate 9\.6/i,
      'Expected ### 17.10 ... Gate 9.6 heading in DESIGN_SYSTEM.md');
  });

  test('Sprint 6.15.7 origin documented in § 17.10', () => {
    const section = designSystem.match(/###\s*17\.10[\s\S]{0,6000}?(?=\n###\s*17\.)/);
    assert.ok(section, '§ 17.10 section body not extractable');
    assert.match(section[0], /Sprint 6\.15\.7/i,
      '§ 17.10 should document Sprint 6.15.7-hotfix as the filing origin');
  });

  test('§ 17.10 mentions structural / parent-child / flex wrapper concept', () => {
    const section = designSystem.match(/###\s*17\.10[\s\S]{0,6000}?(?=\n###\s*17\.)/);
    assert.ok(section);
    assert.match(section[0], /structural.*context|parent-child|flex.*wrapper|tag-depth/i,
      '§ 17.10 should explain the structural layout context concept');
  });

  test('§ 17.10 references theme-toggle-layout-context.test.mjs sentinel', () => {
    const section = designSystem.match(/###\s*17\.10[\s\S]{0,6000}?(?=\n###\s*17\.)/);
    assert.ok(section);
    assert.match(section[0], /theme-toggle-layout-context\.test\.mjs/,
      '§ 17.10 should reference the canonical sentinel test file');
  });

  test('§ 17.10 documents Vercel-rewrite relative-resource trap', () => {
    const section = designSystem.match(/###\s*17\.10[\s\S]{0,6000}?(?=\n###\s*17\.)/);
    assert.ok(section);
    assert.match(section[0], /Vercel|rewrite|absolute path/i,
      '§ 17.10 should document Vercel rewrite + absolute-path guidance');
  });
});


// ── § 17.11 Gate 9.7 ──────────────────────────────────────────────


describe('DESIGN_SYSTEM.md § 17.11 — Gate 9.7 (per-component verification)', () => {
  test('§ 17.11 heading exists', () => {
    assert.match(designSystem, /###\s*17\.11\b[^\n]*Gate 9\.7/i,
      'Expected ### 17.11 ... Gate 9.7 heading in DESIGN_SYSTEM.md');
  });

  test('Sprint 6.15.6 origin documented in § 17.11', () => {
    const section = designSystem.match(/###\s*17\.11[\s\S]{0,6000}?(?=\n###\s*17\.)/);
    assert.ok(section, '§ 17.11 section body not extractable');
    assert.match(section[0], /Sprint 6\.15\.6/i,
      '§ 17.11 should document Sprint 6.15.6-hotfix as the filing origin');
  });

  test('§ 17.11 mentions per-component / multi-component concept', () => {
    const section = designSystem.match(/###\s*17\.11[\s\S]{0,6000}?(?=\n###\s*17\.)/);
    assert.ok(section);
    assert.match(section[0], /per-component|multi-component|component class hook/i,
      '§ 17.11 should explain the per-component verification concept');
  });

  test('§ 17.11 documents 5 mechanisms surfaced by Sprint 6.15.6', () => {
    const section = designSystem.match(/###\s*17\.11[\s\S]{0,6000}?(?=\n###\s*17\.)/);
    assert.ok(section);
    assert.match(section[0], /five distinct mechanisms|5 distinct mechanisms|five mechanisms|5 mechanisms/i,
      '§ 17.11 should document the 5-mechanism Phase A audit finding');
  });

  test('§ 17.11 mentions arbitrary-value Tailwind utility trap', () => {
    const section = designSystem.match(/###\s*17\.11[\s\S]{0,6000}?(?=\n###\s*17\.)/);
    assert.ok(section);
    assert.match(section[0], /arbitrary[- ]value|bg-white\/\[/i,
      '§ 17.11 should document the arbitrary-value Tailwind variant trap');
  });
});


// ── § 17.12 blind-spot evolution pattern ──────────────────────────


describe('DESIGN_SYSTEM.md § 17.12 — blind-spot evolution pattern', () => {
  test('§ 17.12 heading exists', () => {
    assert.match(designSystem, /###\s*17\.12\b/i,
      'Expected ### 17.12 heading in DESIGN_SYSTEM.md');
  });

  test('5-instance pattern table documents all 5 sprints', () => {
    const section = designSystem.match(/###\s*17\.12[\s\S]{0,4000}?(?=\n###\s*17\.|$)/);
    assert.ok(section, '§ 17.12 section body not extractable');
    for (const sprint of ['6.10.1', '6.15.4', '6.15.5', '6.15.6', '6.15.7']) {
      assert.match(
        section[0],
        new RegExp(sprint.replace(/\./g, '\\.')),
        `§ 17.12 pattern table should reference Sprint ${sprint}`,
      );
    }
  });

  test('§ 17.12 documents pre-empt questions for audit reviewers', () => {
    const section = designSystem.match(/###\s*17\.12[\s\S]{0,4000}?(?=\n###\s*17\.|$)/);
    assert.ok(section);
    assert.match(section[0], /pre-empt|reviewers should ask/i,
      '§ 17.12 should include pre-empt questions for audit reviewers');
  });
});


// ── § 17.13 cumulative gate consolidation ─────────────────────────


describe('DESIGN_SYSTEM.md § 17.13 — cumulative 12-gate consolidation', () => {
  test('§ 17.13 heading exists', () => {
    assert.match(designSystem, /###\s*17\.13\b/i,
      'Expected ### 17.13 heading in DESIGN_SYSTEM.md');
  });

  test('Gates 1-9 + 9.5 + 9.6 + 9.7 all documented in § 17.13 table', () => {
    const section = designSystem.match(/###\s*17\.13[\s\S]+/);
    assert.ok(section, '§ 17.13 section body not extractable');
    for (let i = 1; i <= 9; i++) {
      assert.match(
        section[0],
        new RegExp(`\\|\\s*Gate ${i}\\b`),
        `§ 17.13 table should list Gate ${i}`,
      );
    }
    assert.match(section[0], /\|\s*\*?\*?Gate 9\.5/, '§ 17.13 should list Gate 9.5');
    assert.match(section[0], /\|\s*\*?\*?Gate 9\.6/, '§ 17.13 should list Gate 9.6');
    assert.match(section[0], /\|\s*\*?\*?Gate 9\.7/, '§ 17.13 should list Gate 9.7');
  });

  test('§ 17.13 references all formalization methodology subsections', () => {
    const section = designSystem.match(/###\s*17\.13[\s\S]+/);
    assert.ok(section);
    for (const ref of ['17.9', '17.10', '17.11', '17.12']) {
      assert.match(
        section[0],
        new RegExp(`§ ${ref.replace('.', '\\.')}`),
        `§ 17.13 should reference § ${ref}`,
      );
    }
  });
});


// ── PHASE_CLOSURE_LEDGER.md Sprint 6.16.1 row ─────────────────────


describe('PHASE_CLOSURE_LEDGER.md — Sprint 6.16.1 row', () => {
  test('Sprint 6.16.1 documented', () => {
    assert.match(ledger, /Sprint 6\.16\.1\b/,
      'Ledger should include a Sprint 6.16.1 entry');
  });

  test('Triple gate formalization mentioned (9.5 + 9.6 + 9.7)', () => {
    assert.match(
      ledger,
      /9\.5[\s\S]{0,200}9\.6[\s\S]{0,200}9\.7|triple|Gate 9\.5 \+ 9\.6 \+ 9\.7/i,
      'Ledger should describe the triple gate formalization',
    );
  });

  test('Ledger marks Sprint 6.16.1 as methodology (not hotfix)', () => {
    // Skip the "Last updated:" header — match the bullet-list closure event row.
    const row = ledger.match(/-\s+Sprint 6\.16\.1\b[\s\S]{0,2500}/);
    assert.ok(row, 'Sprint 6.16.1 bullet-list row not found in Phase 4 closure events');
    assert.match(row[0], /methodology|No production code|pure docs/i,
      'Sprint 6.16.1 row should mark itself as methodology / docs-only');
  });

  test('12 audit gates cumulative metric documented', () => {
    assert.match(ledger, /12\s*§\s*17 audit gates|12 audit gates/i,
      'Ledger metrics should reflect 12 cumulative § 17 audit gates');
  });

  test('Audit hotfix count remains 13 (unchanged by Sprint 6.16.1)', () => {
    assert.match(ledger, /13 audit hotfixes/i,
      'Sprint 6.16.1 is methodology — hotfix count should remain at 13');
  });

  test('Last updated marker bumped to Sprint 6.16.1', () => {
    assert.match(ledger, /Last updated:\*\*\s*Sprint 6\.16\.1/,
      'Ledger Last-updated marker should reflect Sprint 6.16.1');
  });
});
