/**
 * frontend/tests/grammar-wiki-comprehensive-theme-rendering.test.mjs
 *
 * Sprint 6.15.6-hotfix — pins the comprehensive belt-and-suspenders fix
 * for the 4th Grammar Wiki light-theme RED regression.
 *
 * Six combined fixes guarded here:
 *   1. `<body>` text-white class removed from all 5 grammar pages
 *      (mirrors Sprint 6.15.5 fix; now applied to the remaining 4).
 *   2. grammar.js inline `style="color:rgba(255,255,255,X)"` sites
 *      replaced with class hooks (no inline whites left in the renderer).
 *   3. Component class hooks (.cat-card, .article-card, .group-card,
 *      .group-article-row) get explicit --av-text-* color rules.
 *   4. Card surfaces switch from `bg-white/[0.03]` arbitrary-value to
 *      --av-surface-card via scoped overrides.
 *   5. `body.av-page.text-white` compound selector (no space) defensive.
 *   6. Sprint 6.15.6-hotfix marker comment present.
 *
 * Pure docs + CSS additive + JS class-hook refactor. No backend
 * coupling. ds.css preserved.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

let grammarWikiCss;
let grammarJs;
const html = {};

const GRAMMAR_PAGES = {
  landing:  'frontend/grammar.html',
  roadmap:  'frontend/pages/grammar-roadmap.html',
  article:  'frontend/pages/grammar-article.html',
  search:   'frontend/pages/grammar-search.html',
  compare:  'frontend/pages/grammar-compare.html',
};

before(() => {
  grammarWikiCss = readFileSync(path.join(REPO_ROOT, 'frontend/css/grammar-wiki.css'), 'utf8');
  grammarJs      = readFileSync(path.join(REPO_ROOT, 'frontend/js/grammar.js'), 'utf8');
  Object.entries(GRAMMAR_PAGES).forEach(([k, rel]) => {
    html[k] = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
  });
});


describe('Sprint 6.15.6-hotfix marker (sentinel)', () => {
  test('grammar-wiki.css carries the Sprint 6.15.6-hotfix marker', () => {
    assert.match(grammarWikiCss, /Sprint 6\.15\.6-hotfix/);
  });

  test('hotfix block enumerates the six fixes', () => {
    // Light fingerprint check — the comment block names the mechanisms
    // it closes so future deletions trip this pin.
    assert.match(grammarWikiCss, /belt-and-suspenders/i);
    assert.match(grammarWikiCss, /class hooks/i);
    assert.match(grammarWikiCss, /Sprint 6\.15\.5/, 'hotfix block must reference the prior hotfix it builds on');
  });
});


describe('Item 1 — text-white removed from <body> on ALL 5 grammar pages', () => {
  Object.entries(GRAMMAR_PAGES).forEach(([name, rel]) => {
    test(`${rel} <body> does not carry text-white`, () => {
      const m = html[name].match(/<body\s+class="([^"]+)"/);
      assert.ok(m, `${rel}: body class must be present`);
      const classes = m[1].split(/\s+/);
      assert.ok(
        !classes.includes('text-white'),
        `${rel} <body> must not carry text-white — found classes: ${classes.join(' ')}`,
      );
    });

    test(`${rel} <body> still carries av-page`, () => {
      const m = html[name].match(/<body\s+class="([^"]+)"/);
      assert.ok(m && m[1].split(/\s+/).includes('av-page'));
    });
  });
});


describe('Item 2 — grammar.js no longer emits inline whites in template strings', () => {
  test('no inline color:rgba(255,255,255,X) literals in template strings', () => {
    // Strip /* ... */ block comments first so doc-comments naming the bug
    // pattern don't trip the check.
    const stripped = grammarJs.replace(/\/\*[\s\S]*?\*\//g, '');
    const offenders = stripped.match(/color\s*:\s*rgba\(\s*255\s*,\s*255\s*,\s*255/gi) || [];
    assert.strictEqual(
      offenders.length, 0,
      `grammar.js must not emit inline color:rgba(255,255,255,X) — found ${offenders.length}`,
    );
  });

  test('no inline background:rgba(255,255,255,X) literals in template strings either', () => {
    const stripped = grammarJs.replace(/\/\*[\s\S]*?\*\//g, '');
    const offenders = stripped.match(/background\s*:\s*rgba\(\s*255\s*,\s*255\s*,\s*255/gi) || [];
    assert.strictEqual(
      offenders.length, 0,
      `grammar.js must not emit inline background:rgba(255,255,255,X) — found ${offenders.length}`,
    );
  });

  test('grammar.js uses the new class hooks instead', () => {
    // The refactored sites emit these class names.
    assert.match(grammarJs, /gw-status-dot--planned/);
    assert.match(grammarJs, /gw-status-badge--planned/);
    assert.match(grammarJs, /gw-save-btn/);
  });

  test('save button uses className not style.cssText', () => {
    // The save button refactor: className 'gw-save-btn' replaces a
    // multi-property style.cssText block. The classList.toggle pattern
    // replaces the old btn.style.color / borderColor / background lines.
    assert.match(grammarJs, /btn\.className\s*=\s*['"]gw-save-btn['"]/);
    assert.match(grammarJs, /classList\.toggle\s*\(\s*['"]gw-save-btn--saved/);
  });
});


describe('Item 3 — Component class-hook color overrides', () => {
  const CARD_CLASSES = ['cat-card', 'article-card', 'group-card', 'group-article-row'];

  CARD_CLASSES.forEach((cls) => {
    test(`.${cls} has body.av-page-scoped color override`, () => {
      const pattern = new RegExp(`body\\.av-page\\s+\\.${cls}\\b`);
      assert.match(
        grammarWikiCss, pattern,
        `body.av-page .${cls} override must be present`,
      );
    });
  });

  test('card class-hook block uses --av-text-* tokens', () => {
    // Locate the Sprint 6.15.6-hotfix block and check it references the
    // semantic-text hierarchy.
    const block = grammarWikiCss.match(/Sprint 6\.15\.6-hotfix[\s\S]*?(?=\/\* Lora-display)/);
    assert.ok(block, 'Sprint 6.15.6-hotfix block must be locatable');
    assert.match(block[0], /--av-text-primary/);
    assert.match(block[0], /--av-text-secondary/);
    assert.match(block[0], /--av-text-muted/);
  });
});


describe('Item 4 — Card surface visibility', () => {
  test('cards have explicit av-surface-card background', () => {
    // The scoped selector list for the card classes assigns the visible
    // surface token in both themes.
    assert.match(
      grammarWikiCss,
      /body\.av-page\s+\.cat-card[\s\S]{0,400}var\(--av-surface-card\)/,
      'cards must paint --av-surface-card to remain visible on cream page',
    );
  });

  test('bg-white/[0.03] arbitrary-value Tailwind class is neutralized', () => {
    // CSS source escapes brackets + period: .bg-white\/\[0\.03\]
    assert.match(
      grammarWikiCss,
      /body\.av-page\s+\.bg-white\\\/\\\[0\\\.03\\\]\s*\{/,
      'arbitrary-value bg-white/[0.03] must have a scoped override',
    );
  });

  test('bg-white/[0.05] arbitrary-value Tailwind class is neutralized', () => {
    assert.match(
      grammarWikiCss,
      /body\.av-page\s+\.bg-white\\\/\\\[0\\\.05\\\]\s*\{/,
    );
  });
});


describe('Item 5 — Defensive compound-selector body guard', () => {
  test('body.av-page.text-white compound selector present', () => {
    // No space between av-page and text-white — matches body element
    // directly if it carries both classes (descendant override doesn't).
    assert.match(
      grammarWikiCss,
      /body\.av-page\.text-white\s*\{/,
      'compound body.av-page.text-white must be present as defensive guard',
    );
  });
});


describe('Item 6 — Class hooks for the JS-refactor sites are defined', () => {
  // The 3 new class hooks introduced by Item 2's refactor must have CSS
  // rules in grammar-wiki.css using --av-* tokens.
  const HOOKS = [
    'gw-status-dot--planned',
    'gw-status-badge--planned',
    'gw-save-btn',
  ];

  HOOKS.forEach((hook) => {
    test(`.${hook} is defined in grammar-wiki.css`, () => {
      const escapedHook = hook.replace(/--/g, '--');
      const pattern = new RegExp(`\\.${escapedHook}\\b`);
      assert.match(grammarWikiCss, pattern);
    });
  });

  test('gw-save-btn--saved modifier is defined', () => {
    assert.match(grammarWikiCss, /\.gw-save-btn--saved\b/);
  });

  test('class-hook rules use --av-* tokens (no hardcoded whites)', () => {
    // Inspect each hook block — re-extract by name, then reject any
    // rgba(255,255,255,X) inside.
    HOOKS.concat(['gw-save-btn--saved']).forEach((hook) => {
      const block = grammarWikiCss.match(new RegExp(`\\.${hook}\\b[\\s\\S]*?\\}`));
      if (block) {
        assert.ok(
          !/rgba\(\s*255\s*,\s*255\s*,\s*255/.test(block[0]),
          `.${hook} block must not contain rgba(255,255,255,X) — Sprint 6.15.6 migrated these to tokens`,
        );
      }
    });
  });
});


describe('Token discipline (no hardcoded whites in Sprint 6.15.6 block)', () => {
  test('Sprint 6.15.6 block contains zero hardcoded color: white', () => {
    const block = grammarWikiCss.match(/Sprint 6\.15\.6-hotfix[\s\S]*?(?=\/\* Lora-display)/);
    assert.ok(block);
    const hardcoded = block[0].match(
      /color:\s*(#fff\b|#ffffff\b|white\b)/gi,
    ) || [];
    assert.strictEqual(
      hardcoded.length, 0,
      `Sprint 6.15.6 block must use tokens only — found ${hardcoded.length} hardcoded whites`,
    );
  });
});
