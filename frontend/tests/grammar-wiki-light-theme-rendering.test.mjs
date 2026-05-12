/**
 * frontend/tests/grammar-wiki-light-theme-rendering.test.mjs
 *
 * Sprint 6.15.4-hotfix — RED bug regression pin.
 *
 * Bug: all 5 Grammar Wiki pages rendered illegible in light theme because
 * Tailwind `text-white/XX` opacity-variant utilities (used extensively in
 * HTML markup + the grammar.js renderer) compile to hardcoded
 * `rgb(255 255 255 / X)` and the Sprint 6.15 cascade-winning override
 * only neutralized plain `.text-white` — not the opacity variants.
 *
 * This suite pins the Sprint 6.15.4-hotfix overrides in grammar-wiki.css
 * so a future PR that strips or weakens the coverage trips a regression.
 *
 * Mirrors the Sprint 6.14c-hotfix / 6.15.2 audit-closure pattern: pure
 * docs + CSS additive, no production logic touched.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

let grammarWikiCss;
let grammarHtmlFiles;

before(() => {
  grammarWikiCss = readFileSync(
    path.join(REPO_ROOT, 'frontend/css/grammar-wiki.css'),
    'utf8',
  );
  grammarHtmlFiles = {
    landing: readFileSync(path.join(REPO_ROOT, 'frontend/grammar.html'), 'utf8'),
    roadmap: readFileSync(path.join(REPO_ROOT, 'frontend/pages/grammar-roadmap.html'), 'utf8'),
    article: readFileSync(path.join(REPO_ROOT, 'frontend/pages/grammar-article.html'), 'utf8'),
    search:  readFileSync(path.join(REPO_ROOT, 'frontend/pages/grammar-search.html'), 'utf8'),
    compare: readFileSync(path.join(REPO_ROOT, 'frontend/pages/grammar-compare.html'), 'utf8'),
  };
});


describe('Sprint 6.15.4-hotfix marker (sentinel)', () => {
  test('grammar-wiki.css carries the hotfix marker comment', () => {
    assert.match(
      grammarWikiCss,
      /Sprint 6\.15\.4-hotfix/,
      'grammar-wiki.css must keep the Sprint 6.15.4-hotfix marker — guards future deletions',
    );
  });

  test('hotfix block documents the cascade-winning blind spot', () => {
    assert.match(
      grammarWikiCss,
      /opacity[\s-]variants?|opacity-variant/i,
      'hotfix comment should explain the opacity-variant gap',
    );
  });

  test('hotfix block names the light-theme symptom', () => {
    assert.match(
      grammarWikiCss,
      /light theme/i,
      'hotfix comment should reference the light-theme bug',
    );
  });
});


describe('text-white opacity-variant coverage', () => {
  // Mirror the audit findings (Step 1 of pre-work):
  // grep -hoE 'text-white(/[0-9]+)?' across 5 pages + grammar.js
  // produced these variants.
  const variants = ['90', '85', '80', '70', '65', '60', '55', '50', '40', '35', '30', '28', '25', '20', '15'];

  variants.forEach((opacity) => {
    test(`body.av-page .text-white/${opacity} has a scoped override`, () => {
      // CSS source has the / escaped → text-white\/40 . The literal
      // backslash is doubled by JS string escaping in our regex.
      const pattern = new RegExp(`body\\.av-page\\s+\\.text-white\\\\\\/${opacity}\\b`);
      assert.match(
        grammarWikiCss,
        pattern,
        `Missing override for .text-white/${opacity} — opacity variant will paint hardcoded white on light theme`,
      );
    });
  });
});


describe('hover:text-white variant coverage', () => {
  const hoverVariants = ['', '90', '85', '70', '60'];

  hoverVariants.forEach((opacity) => {
    const suffix = opacity ? `\\\\\\/${opacity}` : '';
    test(`body.av-page .hover\\:text-white${opacity ? '/' + opacity : ''} has a scoped override`, () => {
      const pattern = new RegExp(`body\\.av-page\\s+\\.hover\\\\:text-white${suffix}:hover\\b`);
      assert.match(
        grammarWikiCss,
        pattern,
        `Missing hover override for text-white${opacity ? '/' + opacity : ''}`,
      );
    });
  });
});


describe('border-white + bg-white variant coverage', () => {
  const borderVariants = ['10', '8', '6', '5'];
  borderVariants.forEach((opacity) => {
    test(`body.av-page .border-white/${opacity} has a scoped override`, () => {
      const pattern = new RegExp(`body\\.av-page\\s+\\.border-white\\\\\\/${opacity}\\b`);
      assert.match(grammarWikiCss, pattern, `Missing border-white/${opacity} override`);
    });
  });

  test('body.av-page .bg-white has a scoped override', () => {
    assert.match(
      grammarWikiCss,
      /body\.av-page\s+\.bg-white\s*\{/,
      'Missing bg-white override',
    );
  });

  ['10', '8', '6', '5'].forEach((opacity) => {
    test(`body.av-page .bg-white/${opacity} has a scoped override`, () => {
      const pattern = new RegExp(`body\\.av-page\\s+\\.bg-white\\\\\\/${opacity}\\b`);
      assert.match(grammarWikiCss, pattern, `Missing bg-white/${opacity} override`);
    });
  });
});


describe('Semantic token discipline (no hardcoded whites in grammar-wiki.css)', () => {
  test('grammar-wiki.css contains zero hardcoded color: white literals', () => {
    // Inspect only `color:` declarations (background:, etc. are excluded —
    // those can legitimately reference rgba whites for translucent surfaces).
    const colorWhiteLiterals = grammarWikiCss.match(
      /(?<!background-)color:\s*(#fff\b|#ffffff\b|white\b)/gi,
    ) || [];
    assert.strictEqual(
      colorWhiteLiterals.length,
      0,
      `grammar-wiki.css must not declare hardcoded color: white — found ${colorWhiteLiterals.length}: ${colorWhiteLiterals.join(', ')}`,
    );
  });

  test('overrides reference --av-text-primary / --av-text-secondary / --av-text-muted / --av-text-faint', () => {
    assert.match(grammarWikiCss, /--av-text-primary/);
    assert.match(grammarWikiCss, /--av-text-secondary/);
    assert.match(grammarWikiCss, /--av-text-muted/);
    assert.match(grammarWikiCss, /--av-text-faint/);
  });
});


describe('All 5 grammar pages link grammar-wiki.css', () => {
  Object.entries({
    'frontend/grammar.html':                grammarHtmlFiles.landing,
    'frontend/pages/grammar-roadmap.html':  grammarHtmlFiles.roadmap,
    'frontend/pages/grammar-article.html':  grammarHtmlFiles.article,
    'frontend/pages/grammar-search.html':   grammarHtmlFiles.search,
    'frontend/pages/grammar-compare.html':  grammarHtmlFiles.compare,
  }).forEach(([pagePath, html]) => {
    test(`${pagePath} links grammar-wiki.css`, () => {
      assert.match(
        html,
        /<link[^>]*grammar-wiki\.css/,
        `${pagePath} must keep grammar-wiki.css link — required for light-theme overrides`,
      );
    });

    test(`${pagePath} sets body class av-page`, () => {
      assert.match(
        html,
        /<body[^>]*class="[^"]*\bav-page\b/,
        `${pagePath} body must carry .av-page — overrides are scoped to it`,
      );
    });
  });
});


describe('Foundation order preserved (overrides must cascade-win)', () => {
  Object.entries({
    'frontend/grammar.html':                grammarHtmlFiles.landing,
    'frontend/pages/grammar-roadmap.html':  grammarHtmlFiles.roadmap,
    'frontend/pages/grammar-article.html':  grammarHtmlFiles.article,
    'frontend/pages/grammar-search.html':   grammarHtmlFiles.search,
    'frontend/pages/grammar-compare.html':  grammarHtmlFiles.compare,
  }).forEach(([pagePath, html]) => {
    test(`${pagePath} loads grammar-wiki.css after components.css`, () => {
      // Use <link> tag boundaries — earlier comment mentions of these
      // filenames confuse a plain indexOf().
      const componentsLink = html.search(/<link[^>]*components\.css/);
      const grammarLink    = html.search(/<link[^>]*grammar-wiki\.css/);
      assert.ok(componentsLink > 0, `${pagePath}: components.css <link> missing`);
      assert.ok(grammarLink > componentsLink,
        `${pagePath}: grammar-wiki.css <link> must load after components.css for cascade-win`);
    });
  });
});
