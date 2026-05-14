/**
 * frontend/tests/speaking-ia-cleanup.test.mjs
 *
 * Sprint 6.16 (Issue 2) — pinned removal of 2 external cross-skill nav
 * links (Grammar Wiki + Từ vựng) from the speaking main-tab-nav row,
 * because cross-skill discovery lives on the multi-skill home (Sprint
 * 5.1 + Sprint 6.13a-ext).
 *
 * Sprint 8.1 — IA refactor retired the main-tab-nav row entirely. Mode
 * entry now happens via 3 `.mode-card[data-mode]` anchors on the
 * dashboard view. The Sprint 6.16 spirit ("no cross-skill anchors in
 * the Speaking page primary entry surface") is preserved here at the
 * new mode-card scope: the 3 mode-cards must target Speaking modes
 * only, not other skills.
 *
 * KEEP: the personalized Grammar Dashboard + Vocab updates analytics
 * sections inside the tab-dashboard panel — those are Speaking-
 * specific personalized data, not redundant with home.html.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

let html;
let modesSection;

before(() => {
  html = readFileSync(path.join(REPO_ROOT, 'frontend/pages/speaking.html'), 'utf8');
  // Sprint 8.1 — the primary entry surface is the .speaking-modes
  // section, not the retired main-tab-nav row. Extract it for the
  // cross-skill-link sentinels below.
  const m = html.match(/<section[^>]*class="[^"]*\bspeaking-modes\b[\s\S]*?<\/section>/);
  modesSection = m ? m[0] : '';
});


describe('Sprint 8.1 — main-tab-nav row retired, mode-cards take over', () => {
  test('the <nav class="main-tab-nav"> row is absent', () => {
    assert.ok(
      !/<nav[^>]*class="[^"]*\bmain-tab-nav\b/.test(html),
      'Sprint 8.1 retired the .main-tab-nav row — speaking.html must no longer carry it',
    );
  });

  test('.speaking-modes section is present (the new primary entry surface)', () => {
    assert.ok(
      modesSection.length > 0,
      'speaking.html must ship the .speaking-modes section (Sprint 8.1 IA refactor)',
    );
  });
});


describe('Sprint 6.16 + Sprint 8.1 — cross-skill anchors must NOT appear on the Speaking entry surface', () => {
  // The Sprint 6.16 sentinel applied to the retired main-tab-nav row.
  // Sprint 8.1 retargets the same intent at the .speaking-modes
  // section: the 3 mode-cards must target Speaking modes only.
  test('no <a href="../grammar.html"> mode-card', () => {
    assert.ok(
      !/<a[^>]*href=["']\.\.\/grammar\.html["'][^>]*class="[^"]*mode-card/.test(modesSection),
      '.speaking-modes section must not link to ../grammar.html — cross-skill discovery lives on home.html',
    );
  });

  test('no <a href="/pages/vocabulary.html"> mode-card', () => {
    assert.ok(
      !/<a[^>]*href=["']\/pages\/vocabulary\.html["'][^>]*class="[^"]*mode-card/.test(modesSection),
      '.speaking-modes section must not link to /pages/vocabulary.html — cross-skill discovery lives on home.html',
    );
  });

  test('no "Grammar Wiki" label inside the .speaking-modes section', () => {
    assert.ok(
      !/Grammar Wiki/.test(modesSection),
      '.speaking-modes section must not carry a "Grammar Wiki" label',
    );
  });

  test('no "Từ vựng" label inside the .speaking-modes section', () => {
    assert.ok(
      !/Từ vựng/.test(modesSection),
      '.speaking-modes section must not carry a "Từ vựng" label',
    );
  });
});


describe('Sprint 8.1 — 3 Speaking mode-cards preserved', () => {
  const MODE_CARDS = [
    { mode: 'practice',  label: 'Luyện tập'        },
    { mode: 'partbpart', label: 'Luyện từng Part'  },
    { mode: 'fulltest',  label: 'Full Test'        },
  ];

  MODE_CARDS.forEach(({ mode, label }) => {
    test(`mode-card[data-mode="${mode}"] preserved with label "${label}"`, () => {
      assert.match(
        modesSection,
        new RegExp(`data-mode="${mode}"`),
        `.speaking-modes section must keep .mode-card[data-mode="${mode}"]`,
      );
      assert.ok(
        modesSection.includes(label),
        `.speaking-modes section must keep "${label}" label`,
      );
    });
  });
});


describe('Personalized analytics sections preserved (intentional KEEP)', () => {
  test('Grammar Dashboard section preserved in dashboard panel', () => {
    assert.match(
      html,
      /id=["']grammar-dashboard-section["']/,
      'Personalized Grammar Dashboard section must stay — it surfaces Speaking-session-driven analytics, not redundant with home.html discovery grid',
    );
  });

  test('Vocab updates section preserved in dashboard panel', () => {
    assert.match(
      html,
      /id=["']vocab-updates-section["']/,
      'Personalized Vocab updates section must stay — Speaking-session-driven analytics',
    );
  });
});


describe('Sprint 8.1 cleanup marker comment present', () => {
  test('rationale comment guards future re-addition of the tab-row', () => {
    assert.match(
      html,
      /Sprint 8\.1/,
      'speaking.html should carry the Sprint 8.1 cleanup rationale comment so future contributors understand why the .main-tab-nav row is absent',
    );
  });
});


describe('JS contract preserved', () => {
  test('switchMainTab() function still defined', () => {
    assert.match(
      html,
      /function switchMainTab\s*\(/,
      'switchMainTab() must stay intact — handles the 4 panel toggles invoked by mode-cards + empty-state button',
    );
  });

  test('feature-flag injection functions still present (intentional dead-code, removable in future cleanup)', () => {
    ['applyVocabBankFlag', 'applyExercisesFlag', 'applyFlashcardsFlag'].forEach((fn) => {
      assert.match(
        html,
        new RegExp(`function ${fn}\\s*\\(`),
        `${fn} should still be defined (dormant, no-cost dead code per Sprint 6.16 scope decision)`,
      );
    });
  });
});
