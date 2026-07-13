/**
 * frontend/tests/sprint-6-15-2-narrative-correction.test.mjs
 *
 * Sprint 6.15.2 — closes the Sprint 6.15 PR #154 narrative inaccuracy.
 * Sprint 6.15 documented `frontend/pages/dashboard.html` as the sole
 * remaining legacy `--ds-*` outlier. Sprint 6.15.1 investigation proved
 * the file doesn't exist (deleted in Sprint 5.1 commit 3f4ff14 when the
 * multi-skill `frontend/pages/home.html` shipped). This suite pins the
 * corrected narrative state and the Vercel redirect that handles legacy
 * bookmarks.
 *
 * Mirrors the Sprint 6.14c-hotfix audit-closure pattern: pure docs, no
 * production code touched.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

let designSystem;
let brief;
let vercelConfig;

before(() => {
  designSystem = readFileSync(
    path.join(REPO_ROOT, 'frontend/css/aver-design/DESIGN_SYSTEM.md'),
    'utf8',
  );
  brief = readFileSync(
    path.join(REPO_ROOT, 'frontend/css/aver-design/UNIFIED_DESIGN_BRIEF.md'),
    'utf8',
  );
  // ADR-002 (Phase 1): routing rules live in next.config.ts now.
  vercelConfig = readFileSync(
    path.join(REPO_ROOT, 'frontend/next.config.ts'),
    'utf8',
  );
});


describe('dashboard.html non-existence verified', () => {
  test('frontend/pages/dashboard.html does NOT exist', () => {
    assert.ok(
      !existsSync(path.join(REPO_ROOT, 'frontend/pages/dashboard.html')),
      'dashboard.html should not exist — deleted Sprint 5.1 commit 3f4ff14',
    );
  });

  test('replacement page frontend/pages/home.html exists', () => {
    assert.ok(
      existsSync(path.join(REPO_ROOT, 'frontend/pages/home.html')),
      'home.html (multi-skill, the Sprint 5.1 replacement) must exist',
    );
  });
});


describe('DESIGN_SYSTEM.md § 14.2 corrected', () => {
  test('§ 14.2 does not list dashboard.html as a remaining legacy page', () => {
    // Allow historical references (Sprint 6.15.2 narrative-correction note
    // explaining why the previous narrative was wrong is fine). Reject any
    // claim that treats dashboard.html as a currently-existing legacy file.
    const section = designSystem.match(/### 14\.2[\s\S]*?(?=### 14\.3|## 15)/);
    assert.ok(section, '§ 14.2 not found');
    assert.ok(
      !/(only|sole|remaining)\s+legacy\s+page[\s\S]{0,200}dashboard\.html|dashboard\.html[\s\S]{0,200}(remains|remaining)\s+(on|in|the)\s+legacy/i.test(section[0]),
      '§ 14.2 must not list dashboard.html as a remaining legacy page',
    );
  });

  test('§ 14.2 affirms zero pages on legacy --ds-*', () => {
    const section = designSystem.match(/### 14\.2[\s\S]*?(?=### 14\.3|## 15)/);
    assert.ok(section);
    assert.match(
      section[0],
      /[Zz]ero pages.+--ds-\*|zero --ds-\*|zero pages remain on/i,
      '§ 14.2 should affirm zero pages remain on --ds-* tokens',
    );
  });

  test('§ 14.2 explicitly marks ds.css as the compatibility bridge', () => {
    const section = designSystem.match(/### 14\.2[\s\S]*?(?=### 14\.3|## 15)/);
    assert.ok(section);
    assert.match(
      section[0],
      /ds\.css[\s\S]{0,400}compatibility bridge|compatibility bridge[\s\S]{0,400}ds\.css/i,
      '§ 14.2 should explain ds.css as the compatibility bridge',
    );
  });

  test('§ 14.2 references Sprint 6.5.1 pattern (ds.css scoped override)', () => {
    const section = designSystem.match(/### 14\.2[\s\S]*?(?=### 14\.3|## 15)/);
    assert.ok(section);
    assert.match(
      section[0],
      /Sprint 6\.5\.1/,
      '§ 14.2 should reference Sprint 6.5.1 pattern',
    );
  });

  test('§ 14.2 documents the Sprint 6.15.2 narrative correction', () => {
    const section = designSystem.match(/### 14\.2[\s\S]*?(?=### 14\.3|## 15)/);
    assert.ok(section);
    assert.match(
      section[0],
      /Sprint 6\.15\.2|narrative correction|Sprint 5\.1[\s\S]{0,200}3f4ff14|3f4ff14/i,
      '§ 14.2 should mention the Sprint 6.15.2 narrative correction (or cite the Sprint 5.1 deletion commit)',
    );
  });
});


describe('DESIGN_SYSTEM.md § 14.5 Phase 4 row corrected', () => {
  test('Phase 4 row no longer claims dashboard.html remains', () => {
    const phase4Row = designSystem.match(/\|\s*Phase 4\s*\|[\s\S]*?\|\s*$/m);
    if (phase4Row) {
      assert.ok(
        !/[Oo]nly\s+`?frontend\/pages\/dashboard\.html`?\s+remains/.test(phase4Row[0]),
        '§ 14.5 Phase 4 row should not claim dashboard.html remains',
      );
    }
  });

  test('Phase 4 row marked ✅ COMPLETE', () => {
    assert.match(
      designSystem,
      /Phase 4[\s\S]{0,500}(?:✅\s*)?COMPLETE/i,
      'Phase 4 should be marked COMPLETE in § 14.5',
    );
  });

  test('Phase 4 row notes ds.css preserved as compatibility bridge', () => {
    const phase4Row = designSystem.match(/\|\s*Phase 4\s*\|[\s\S]*?\|\s*$/m);
    assert.ok(phase4Row);
    assert.match(
      phase4Row[0],
      /ds\.css[\s\S]{0,200}(compatibility|bridge|§ 14\.2)/i,
      '§ 14.5 Phase 4 row should reference ds.css preservation rationale',
    );
  });
});


describe('UNIFIED_DESIGN_BRIEF.md § 2 corrected', () => {
  test('§ 2 intro no longer mentions dashboard.html deferral to Phase 5+', () => {
    // Capture the § 2 priority-order section
    const section = brief.match(/## 2\. Priority order[\s\S]*?(?=## 3)/);
    assert.ok(section, '§ 2 section not found');
    assert.ok(
      !/dashboard\.html[\s\S]{0,200}(Phase 5\+|deferral|deferred|migrate)/i.test(section[0]) &&
      !/(Phase 5\+|deferral|deferred|migration)[\s\S]{0,200}dashboard\.html/i.test(section[0]),
      '§ 2 intro must not mention dashboard.html as a Phase 5+ deferral',
    );
  });

  test('§ 2 cumulative count reflects 29 pages + zero --ds-* state', () => {
    assert.match(
      brief,
      /29 pages redesigned cumulative/i,
      'Brief § 2 should mention 29 pages redesigned cumulative',
    );
    assert.match(
      brief,
      /zero pages on legacy --ds-\*|zero pages.+--ds-\*/i,
      'Brief § 2 should affirm zero pages on legacy --ds-*',
    );
  });

  test('§ 2 references ds.css compatibility bridge rationale', () => {
    const section = brief.match(/## 2\. Priority order[\s\S]*?(?=## 3)/);
    assert.ok(section);
    assert.match(
      section[0],
      /ds\.css[\s\S]{0,300}(compatibility|bridge|6\.5\.1|§ 14\.2)/i,
      '§ 2 should reference ds.css compatibility bridge or pointer to § 14.2',
    );
  });

  test('§ 2 lists actual Phase 5+ deferrals (6.14d-β/γ, vocab iframe, commercial readiness)', () => {
    const section = brief.match(/## 2\. Priority order[\s\S]*?(?=## 3)/);
    assert.ok(section);
    assert.match(section[0], /6\.14d-β/,            '§ 2 should reference Sprint 6.14d-β deferral');
    assert.match(section[0], /6\.14d-γ/,            '§ 2 should reference Sprint 6.14d-γ deferral');
  });
});


describe('Vercel routing preserved (handles legacy bookmarks)', () => {
  test('301 redirect /pages/dashboard.html → /pages/speaking.html preserved', () => {
    assert.match(
      vercelConfig,
      /\/pages\/dashboard\.html[\s\S]{0,300}\/pages\/speaking\.html|\/pages\/speaking\.html[\s\S]{0,300}\/pages\/dashboard\.html/,
      'Vercel redirect from /pages/dashboard.html to /pages/speaking.html must be preserved',
    );
  });

  test('redirect marked permanent: true', () => {
    // Find specifically the /pages/dashboard.html redirect (not /writing/dashboard)
    const dashboardEntry = vercelConfig.match(/\{[^}]*\/pages\/dashboard\.html[^}]*\}/);
    assert.ok(dashboardEntry, 'Could not locate /pages/dashboard.html redirect entry');
    assert.match(
      dashboardEntry[0],
      /["']?permanent["']?\s*:\s*true/i,
      '/pages/dashboard.html redirect must be permanent: true',
    );
  });
});


describe('Production code untouched (Sprint 6.15.2 scope discipline)', () => {
  test('ds.css still exists (compatibility bridge preserved)', () => {
    assert.ok(
      existsSync(path.join(REPO_ROOT, 'frontend/css/ds.css')),
      'ds.css must not be deleted — Sprint 6.5.1 compatibility bridge',
    );
  });

  test('result.css still has the 3 var(--ds-*) historical-context comments', () => {
    const resultCss = readFileSync(path.join(REPO_ROOT, 'frontend/css/result.css'), 'utf8');
    const dsRefs = (resultCss.match(/var\(--ds-/g) || []).length;
    assert.ok(
      dsRefs >= 1,
      `result.css should retain its historical-context --ds-* comments (got ${dsRefs})`,
    );
  });
});
