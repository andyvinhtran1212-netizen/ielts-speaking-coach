/**
 * frontend/tests/gate-10-formalization.test.mjs
 *
 * Sprint 6.20 — Gate 10 (visual position verification) formalization
 * sentinel.
 *
 * Andy reported nav chrome position drift between pages despite Codex
 * 9/9 GREEN baseline on Sprint 6.19 markup-contract tests. Root cause:
 * 2 of 18 canonical chrome pages (home.html, vocabulary.html) nested
 * `<nav class="topnav">` inside `<div class="shell">` (24px top padding)
 * while the other 16 pages used `<div class="topnav-wrap">` as a direct
 * body child. Contract tests verified markup presence; they did not
 * verify rendered pixel position across navigation.
 *
 * This test pins the § 17.14 Gate 10 docs in DESIGN_SYSTEM.md so the
 * methodology improvement can't silently disappear. The cross-page
 * anchor sentinel (nav-anchor pin) lives in
 * `chrome-unification-canonical.test.mjs`.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

const DESIGN_SYSTEM_PATH = path.join(
  REPO_ROOT,
  'frontend/css/aver-design/DESIGN_SYSTEM.md',
);


describe('Sprint 6.20 — § 17.14 Gate 10 formalization', () => {
  let designSystem;
  before(() => {
    designSystem = readFileSync(DESIGN_SYSTEM_PATH, 'utf8');
  });

  test('§ 17.14 section header exists with Gate 10 title', () => {
    assert.match(
      designSystem,
      /###\s+17\.14\s+Visual position verification\s+—\s+Gate 10/i,
      '§ 17.14 Gate 10 section must be present',
    );
  });

  test('Sprint 6.20 origin documented inside § 17.14', () => {
    // Capture the § 17.14 block and verify the origin line cites 6.20.
    const block = designSystem.match(/###\s+17\.14[\s\S]+$/);
    assert.ok(block, '§ 17.14 block not extractable');
    assert.match(
      block[0],
      /Sprint 6\.20/,
      '§ 17.14 must cite Sprint 6.20 as the origin sprint',
    );
  });

  test('Gate 10 concept documented (rendered position vs markup)', () => {
    const block = designSystem.match(/###\s+17\.14[\s\S]+$/);
    assert.ok(block);
    const body = block[0];
    // Look for the conceptual vocabulary the gate introduces.
    assert.match(body, /rendered|position|pixel|cross-page/i,
      '§ 17.14 must describe rendered-position vs markup-contract distinction');
    assert.match(body, /viewport/i,
      '§ 17.14 must reference viewport-edge anchoring or measurement');
    assert.match(body, /smoke|checklist/i,
      '§ 17.14 must define a manual smoke checklist or verification protocol');
  });

  test('Cross-page measurement protocol documented (1440 / 768 / 375)', () => {
    const block = designSystem.match(/###\s+17\.14[\s\S]+$/);
    assert.ok(block);
    // Canonical viewport sizes for Gate 10 measurements.
    assert.match(block[0], /1440/, 'Gate 10 must document 1440px desktop measurement');
    assert.match(block[0], /768/,  'Gate 10 must document 768px tablet measurement');
    assert.match(block[0], /375/,  'Gate 10 must document 375px mobile measurement');
  });

  test('Pages requiring Gate 10 list present', () => {
    const block = designSystem.match(/###\s+17\.14[\s\S]+$/);
    assert.ok(block);
    assert.match(
      block[0],
      /Pages requiring Gate 10[\s\S]{0,400}18 canonical chrome pages/i,
      '§ 17.14 must list the 18 canonical chrome pages as Gate 10 scope',
    );
  });
});


describe('Sprint 6.20 — pattern recognition table updated (6 instances)', () => {
  let designSystem;
  before(() => {
    designSystem = readFileSync(DESIGN_SYSTEM_PATH, 'utf8');
  });

  test('§ 17.12 evolution table cites all 6 blind-spot sprints', () => {
    // The table lives inside § 17.12. Capture the block up to next ---.
    const block = designSystem.match(/###\s+17\.12[\s\S]+?(?=\n---\n)/);
    assert.ok(block, '§ 17.12 block not extractable');
    const body = block[0];
    const sprints = ['6.10.1', '6.15.4', '6.15.5', '6.15.6', '6.15.7', '6.20'];
    sprints.forEach((s) => {
      assert.ok(
        body.includes(s),
        `§ 17.12 evolution table must cite Sprint ${s} as a documented blind-spot instance`,
      );
    });
  });

  test('§ 17.12 intro paragraph reflects "six sprints"', () => {
    const block = designSystem.match(/###\s+17\.12[\s\S]+?(?=\n---\n)/);
    assert.ok(block);
    assert.match(
      block[0],
      /six sprints,\s*six distinct mechanisms/i,
      '§ 17.12 intro must reflect the updated count of six sprints / six mechanisms',
    );
  });

  test('§ 17.12 pattern principle list includes Gate 10', () => {
    const block = designSystem.match(/###\s+17\.12[\s\S]+?(?=\n---\n)/);
    assert.ok(block);
    assert.match(
      block[0],
      /Gate 10[\s\S]{0,200}(rendered|position|cross-page)/i,
      '§ 17.12 pattern principle must include a Gate 10 entry describing rendered position',
    );
  });
});


describe('Sprint 6.20 — § 17.13 consolidation reflects 13 gates', () => {
  let designSystem;
  before(() => {
    designSystem = readFileSync(DESIGN_SYSTEM_PATH, 'utf8');
  });

  test('§ 17.13 header mentions cumulative 13 gates', () => {
    assert.match(
      designSystem,
      /17\.13[\s\S]{0,400}cumulative 13 gates/i,
      '§ 17.13 must update the cumulative count from 12 to 13',
    );
  });

  test('§ 17.13 table contains Gate 10 row formalized Sprint 6.20', () => {
    // Capture the consolidation block from § 17.13 header to "Plus methodology" marker.
    const block = designSystem.match(/###\s+17\.13[\s\S]+?Plus methodology/);
    assert.ok(block, '§ 17.13 block not extractable');
    assert.match(
      block[0],
      /\|\s*\*\*Gate 10\*\*\s*\|[\s\S]{0,300}Sprint 6\.20/i,
      '§ 17.13 table must contain a Gate 10 row formalized in Sprint 6.20',
    );
  });

  test('All 13 gates referenced in § 17.13 consolidation table', () => {
    const block = designSystem.match(/###\s+17\.13[\s\S]+?Plus methodology/);
    assert.ok(block);
    const body = block[0];
    // Gate 1..9 (whole-number gates).
    for (let i = 1; i <= 9; i += 1) {
      assert.ok(
        new RegExp(`Gate ${i}\\b`).test(body),
        `§ 17.13 must reference Gate ${i}`,
      );
    }
    // Decimal gates + Gate 10.
    ['9.5', '9.6', '9.7', '10'].forEach((g) => {
      assert.ok(
        new RegExp(`Gate ${g.replace('.', '\\.')}\\b`).test(body),
        `§ 17.13 must reference Gate ${g}`,
      );
    });
  });
});


describe('Sprint 6.20 — methodology sections index updated', () => {
  let designSystem;
  before(() => {
    designSystem = readFileSync(DESIGN_SYSTEM_PATH, 'utf8');
  });

  test('methodology sections list includes § 17.14 entry', () => {
    assert.match(
      designSystem,
      /§ 17\.14[\s\S]{0,200}Visual position verification[\s\S]{0,200}Sprint 6\.20/i,
      'methodology sections index at end of § 17.13 must include the § 17.14 Gate 10 entry',
    );
  });
});
