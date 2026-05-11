/**
 * frontend/tests/sprint-6-14c-hotfix-audit-closure.test.mjs
 *
 * Sprint 6.14c-hotfix — pins the 2 AMBER closures from Codex audit
 * Phase 4 admin (CODEX_AUDIT_PHASE_4_ADMIN.md):
 *
 *   AMBER #1 — UNIFIED_DESIGN_BRIEF.md § 2 Phase 4 row was stale
 *              ("UPCOMING" entirely) despite 10/11 Phase 4 sub-pages
 *              shipped (marketing 2 + admin 8).
 *
 *   AMBER #2 — admin-writing.css at --av-text-faint 10/10 ceiling.
 *              Sprint 6.14d strategy decision (own admin.css)
 *              formalized in DESIGN_SYSTEM.md § 17.6 + brief § 2.1.
 *
 * Pure docs sprint — no production HTML/CSS/JS touched.
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


describe('AMBER #1: Brief Phase 4 section reflects shipped reality', () => {
  test('Phase 4 marketing marked COMPLETE', () => {
    const phase4Section = brief.match(/Phase 4[\s\S]{0,3000}/);
    assert.ok(phase4Section, 'Phase 4 section not found in brief');
    assert.match(
      phase4Section[0],
      /Marketing.+COMPLETE|marketing.+complete/i,
      'Phase 4 marketing should be marked COMPLETE',
    );
  });

  test('Phase 4 admin cluster marked COMPLETE / STRUCTURALLY COMPLETE', () => {
    // 6.14c-hotfix: "admin sub-pages COMPLETE". 6.14d-α: "Admin cluster
    // STRUCTURALLY COMPLETE". 6.15: row may use parenthetical "Admin
    // (STRUCTURALLY COMPLETE)". Accept all three phrasings.
    const phase4Section = brief.match(/Phase 4[\s\S]{0,4000}/);
    assert.ok(phase4Section);
    assert.match(
      phase4Section[0],
      /[Aa]dmin (sub.pages|cluster|\(STRUCTURALLY).+(STRUCTURALLY\s+)?COMPLETE|admin (sub-pages|cluster|\(structurally).+(structurally\s+)?complete/i,
      'Phase 4 admin should be marked COMPLETE or STRUCTURALLY COMPLETE',
    );
  });

  test('Phase 4 references shipped PR numbers (#145, #147, #149, #150, #151)', () => {
    const phase4Section = brief.match(/Phase 4[\s\S]{0,3000}/);
    assert.ok(phase4Section);
    for (const pr of ['#145', '#147', '#149', '#150', '#151']) {
      assert.ok(
        phase4Section[0].includes(pr),
        `Phase 4 section should reference ${pr}`,
      );
    }
  });

  test('Phase 4 admin monolith mentioned (Sprint 6.14d or 6.14d-α)', () => {
    // Sprint 6.14c-hotfix originally required UPCOMING marker for monolith.
    // Sprint 6.14d-α shipped admin.html so UPCOMING dropped. Sprint 6.15
    // closed Phase 4 entirely so "UPCOMING" is no longer required anywhere
    // in this section. Just verify the monolith is mentioned with its sprint.
    const phase4Section = brief.match(/Phase 4[\s\S]{0,3500}/);
    assert.ok(phase4Section);
    assert.match(
      phase4Section[0],
      /admin\.html|6\.14d|monolith/i,
      'admin.html monolith should still be referenced in Phase 4 narrative',
    );
  });

  test('Brief no longer claims entire Phase 4 is UPCOMING (no stale claim)', () => {
    const phase4Section = brief.match(/Phase 4[\s\S]{0,3000}/);
    assert.ok(phase4Section);
    assert.match(
      phase4Section[0],
      /COMPLETE/,
      'Phase 4 section should include COMPLETE markers for shipped sub-pages',
    );
    assert.ok(
      !/\*\*Phase 4\*\*[^|]*\|[^|]*\|\s*\*\*UPCOMING\*\*\s*\|/.test(phase4Section[0]),
      'Phase 4 row Status column should not be a bare "UPCOMING" anymore',
    );
  });

  test('Cumulative page count updated to reflect Phase 4 closure (29 after 6.15)', () => {
    // 23 (6.14c-hotfix) → 24 (6.14d-α) → 29 (6.15 Phase 4 closure).
    assert.match(
      brief,
      /(23|24|29) pages redesigned cumulative/,
      'Brief should reflect cumulative page count (23 after 6.14c-hotfix, 24 after 6.14d-α, 29 after 6.15)',
    );
  });
});


describe('AMBER #2: admin-writing.css at-cap status formalized', () => {
  test('DESIGN_SYSTEM.md § 17 documents shared CSS cap monitoring', () => {
    assert.match(
      designSystem,
      /[Ss]hared CSS file cap monitoring|cap monitoring.+shared/i,
      'DESIGN_SYSTEM.md § 17 should document shared CSS cap monitoring',
    );
  });

  test('Cap monitoring section references admin-writing.css 10/10', () => {
    const capSection = designSystem.match(/[Ss]hared CSS file cap monitoring[\s\S]{0,3000}/);
    assert.ok(capSection, 'Cap monitoring section not found');
    assert.match(
      capSection[0],
      /admin-writing\.css.+10\s*\/\s*10|admin-writing\.css.+at.cap|at.cap.+admin-writing/i,
      'Cap monitoring should reference admin-writing.css at 10/10',
    );
  });

  test('Cap monitoring includes anti-pattern note', () => {
    const capSection = designSystem.match(/[Ss]hared CSS file cap monitoring[\s\S]{0,3000}/);
    assert.ok(capSection);
    assert.match(
      capSection[0],
      /Anti-pattern|anti-pattern|❌/,
      'Cap monitoring should include anti-pattern guidance',
    );
  });

  test('Cap monitoring includes detection grep command', () => {
    const capSection = designSystem.match(/[Ss]hared CSS file cap monitoring[\s\S]{0,3000}/);
    assert.ok(capSection);
    assert.match(
      capSection[0],
      /grep -c.+text-faint/,
      'Cap monitoring should include grep detection command',
    );
  });

  test('Cap monitoring references Codex audit Phase 4 admin AMBER #2', () => {
    const capSection = designSystem.match(/[Ss]hared CSS file cap monitoring[\s\S]{0,3000}/);
    assert.ok(capSection);
    assert.match(
      capSection[0],
      /Codex.+Phase 4.+admin|AMBER\s*#?\s*2|Phase 4 admin audit/i,
      'Cap monitoring should reference Codex Phase 4 admin audit closure',
    );
  });
});


describe('Sprint 6.14d strategy guidance (brief § 2.1)', () => {
  test('Brief has a Sprint 6.14d strategy guidance section', () => {
    assert.match(
      brief,
      /Sprint 6\.14d strategy guidance|Sprint 6\.14d[\s\S]{0,200}strategy/i,
      'Brief should have a Sprint 6.14d strategy guidance section',
    );
  });

  test('Sprint 6.14d guidance recommends dedicated admin.css', () => {
    const guidanceSection = brief.match(/### 2\.1 Sprint 6\.14d strategy guidance[\s\S]{0,4000}/);
    assert.ok(guidanceSection);
    assert.match(
      guidanceSection[0],
      /[Dd]edicated\s+`?admin\.css`?|admin\.css.+monolith|monolith.+admin\.css/,
      'Sprint 6.14d guidance should recommend dedicated admin.css',
    );
  });

  test('Sprint 6.14d guidance includes foundation order example', () => {
    const guidanceSection = brief.match(/### 2\.1 Sprint 6\.14d strategy guidance[\s\S]{0,4000}/);
    assert.ok(guidanceSection);
    assert.match(
      guidanceSection[0],
      /tokens\.css[\s\S]{0,300}components\.css[\s\S]{0,300}admin-writing\.css[\s\S]{0,300}admin\.css/,
      'Sprint 6.14d guidance should show foundation order including admin.css',
    );
  });

  test('Sprint 6.14d guidance warns against extending admin-writing.css', () => {
    const guidanceSection = brief.match(/### 2\.1 Sprint 6\.14d strategy guidance[\s\S]{0,4000}/);
    assert.ok(guidanceSection);
    assert.match(
      guidanceSection[0],
      /DO NOT extend\s+`?admin-writing\.css`?|don.t extend\s+`?admin-writing\.css`?|admin-writing\.css.+at[- ]cap/i,
      'Sprint 6.14d guidance should warn against extending admin-writing.css',
    );
  });

  test('Sprint 6.14d guidance references Sprint 6.8 finding (writing-renderers.css)', () => {
    const guidanceSection = brief.match(/### 2\.1 Sprint 6\.14d strategy guidance[\s\S]{0,4000}/);
    assert.ok(guidanceSection);
    assert.match(
      guidanceSection[0],
      /Sprint 6\.8|writing-renderers\.css/,
      'Sprint 6.14d guidance should reference Sprint 6.8 / writing-renderers.css finding',
    );
  });
});


describe('admin-writing.css cap verification (Sprint 6.14c-hotfix snapshot)', () => {
  test('admin-writing.css --av-text-faint count ≤ 10', () => {
    const css = readFileSync(
      path.join(REPO_ROOT, 'frontend/css/admin-writing.css'),
      'utf8',
    );
    const faintCount = (css.match(/var\(--av-text-faint\)/g) || []).length;
    assert.ok(
      faintCount <= 10,
      `admin-writing.css has ${faintCount} --av-text-faint usages, exceeds cap of 10`,
    );
  });

  test('admin-writing.css --av-text-faint count is exactly 10 (at-cap snapshot)', () => {
    const css = readFileSync(
      path.join(REPO_ROOT, 'frontend/css/admin-writing.css'),
      'utf8',
    );
    const faintCount = (css.match(/var\(--av-text-faint\)/g) || []).length;
    assert.equal(
      faintCount,
      10,
      `admin-writing.css expected exactly 10 --av-text-faint (Sprint 6.14c-hotfix at-cap snapshot), got ${faintCount}. ` +
      `If demoting one is intentional, update DESIGN_SYSTEM.md § 17.6 at-cap snapshot table.`,
    );
  });
});
