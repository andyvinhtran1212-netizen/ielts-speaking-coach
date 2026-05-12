/**
 * frontend/tests/speaking-ia-cleanup.test.mjs
 *
 * Sprint 6.16 (Issue 2) — pins Speaking page IA cleanup. The 2
 * external cross-skill nav links (Grammar Wiki + Từ vựng) were
 * removed from `frontend/pages/speaking.html` main-tab-nav because
 * cross-skill discovery lives on the multi-skill home (Sprint 5.1 +
 * Sprint 6.13a-extension).
 *
 * Sentinel: future contributors must not re-add `<a>` tab-buttons
 * pointing to grammar.html / vocabulary.html inside the main-tab-nav.
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
let mainTabNavBlock;

before(() => {
  html = readFileSync(path.join(REPO_ROOT, 'frontend/pages/speaking.html'), 'utf8');
  const m = html.match(/<nav class="main-tab-nav">[\s\S]*?<\/nav>/);
  // Strip HTML comments so the Sprint 6.16 rationale comment
  // (which intentionally names the removed labels) doesn't trip the
  // "label-removed" pins. Comment content lives only in source view.
  mainTabNavBlock = m ? m[0].replace(/<!--[\s\S]*?-->/g, '') : '';
});


describe('main-tab-nav block exists', () => {
  test('the <nav class="main-tab-nav"> block is present', () => {
    assert.ok(
      mainTabNavBlock.length > 0,
      'Speaking page must keep the .main-tab-nav block (4 internal tabs)',
    );
  });
});


describe('Issue 2 — external cross-skill nav links removed', () => {
  test('no <a href="../grammar.html"> tab-button inside main-tab-nav', () => {
    assert.ok(
      !/<a[^>]*href=["']\.\.\/grammar\.html["'][^>]*class="[^"]*main-tab-btn/.test(mainTabNavBlock),
      'Speaking main-tab-nav must not link to ../grammar.html as a tab — cross-skill discovery lives on home.html',
    );
  });

  test('no <a href="/pages/vocabulary.html"> tab-button inside main-tab-nav', () => {
    assert.ok(
      !/<a[^>]*href=["']\/pages\/vocabulary\.html["'][^>]*class="[^"]*main-tab-btn/.test(mainTabNavBlock),
      'Speaking main-tab-nav must not link to /pages/vocabulary.html as a tab — cross-skill discovery lives on home.html',
    );
  });

  test('no "Grammar Wiki" label inside main-tab-nav block', () => {
    assert.ok(
      !/Grammar Wiki/.test(mainTabNavBlock),
      'Speaking main-tab-nav must not carry a "Grammar Wiki" label',
    );
  });

  test('no "Từ vựng" label inside main-tab-nav block', () => {
    assert.ok(
      !/Từ vựng/.test(mainTabNavBlock),
      'Speaking main-tab-nav must not carry a "Từ vựng" label',
    );
  });
});


describe('4 internal Speaking tabs preserved', () => {
  const INTERNAL_TABS = [
    { id: 'mtab-dashboard',  label: 'Dashboard' },
    { id: 'mtab-practice',   label: 'Luyện tập' },
    { id: 'mtab-partbpart',  label: 'Luyện từng Part' },
    { id: 'mtab-fulltest',   label: 'Full Test' },
  ];

  INTERNAL_TABS.forEach(({ id, label }) => {
    test(`${id} button preserved with label "${label}"`, () => {
      assert.match(
        mainTabNavBlock,
        new RegExp(`id=["']${id}["']`),
        `Speaking main-tab-nav must keep #${id}`,
      );
      assert.ok(
        mainTabNavBlock.includes(label),
        `Speaking main-tab-nav must keep "${label}" label`,
      );
    });
  });
});


describe('Personalized analytics sections preserved (intentional KEEP)', () => {
  test('Grammar Dashboard section preserved in dashboard panel', () => {
    assert.match(
      html,
      /id=["']grammar-dashboard-section["']/,
      'Personalized Grammar Dashboard section (lines ~362-413) must stay — it surfaces Speaking-session-driven analytics, not redundant with home.html discovery grid',
    );
  });

  test('Vocab updates section preserved in dashboard panel', () => {
    assert.match(
      html,
      /id=["']vocab-updates-section["']/,
      'Personalized Vocab updates section (lines ~421-440) must stay — Speaking-session-driven analytics',
    );
  });
});


describe('Sprint 6.16 cleanup marker comment present', () => {
  test('rationale comment guards future re-addition', () => {
    assert.match(
      html,
      /Sprint 6\.16/,
      'speaking.html should carry the Sprint 6.16 cleanup rationale comment so future contributors understand why the cross-skill tab-links are absent',
    );
  });
});


describe('JS contract preserved', () => {
  test('switchMainTab() function still defined', () => {
    assert.match(
      html,
      /function switchMainTab\s*\(/,
      'switchMainTab() must stay intact — handles 4 internal tabs',
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
