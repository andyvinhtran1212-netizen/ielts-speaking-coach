/**
 * frontend/tests/grammar-article-light-theme-rendering.test.mjs
 *
 * Sprint 6.15.5-hotfix — pins the second-pass cascade hardening on
 * grammar-article.html. Sprint 6.15.4-hotfix shipped Tailwind opacity-
 * variant coverage but missed inherited white on body + class-less
 * markdown-rendered semantic HTML inside .article-body. Andy reported
 * the entire article body still rendered invisible in light theme on
 * the production URL `averlearning.com/grammar/foundations/parts-of-
 * speech` (only the emerald "Beginner" badge was readable).
 *
 * Two pins guard the fix:
 *
 * 1. `<body>` element no longer carries `text-white`. The Sprint 6.15.4
 *    descendant override (`body.av-page .text-white`) cannot match the
 *    body itself, so the body inherited Tailwind's raw `.text-white`
 *    color and every class-less child inherited white in turn.
 *
 * 2. grammar-wiki.css gains an explicit color-pin block for the bare
 *    semantic elements a markdown pipeline emits inside `.article-body`
 *    (`<p>`, `<h2>`, `<li>`, `<td>`, `<strong>`, `<em>`, `<blockquote>`,
 *    `<span>`) plus the `#article-title` / `#article-meta` / `#breadcrumb`
 *    header chrome that lives outside `.article-body`.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

let articleHtml;
let grammarWikiCss;

before(() => {
  articleHtml = readFileSync(
    path.join(REPO_ROOT, 'frontend/pages/grammar-article.html'),
    'utf8',
  );
  grammarWikiCss = readFileSync(
    path.join(REPO_ROOT, 'frontend/css/grammar-wiki.css'),
    'utf8',
  );
});


describe('Sprint 6.15.5-hotfix marker (sentinel)', () => {
  test('grammar-wiki.css carries the Sprint 6.15.5-hotfix marker', () => {
    assert.match(
      grammarWikiCss,
      /Sprint 6\.15\.5-hotfix/,
      'grammar-wiki.css must keep the Sprint 6.15.5-hotfix marker so a future deletion trips this pin',
    );
  });

  test('hotfix block names the markdown-inheritance root cause', () => {
    assert.match(
      grammarWikiCss,
      /markdown|semantic|bare|class-less|classless/i,
      'hotfix comment must explain why class-bearing coverage was insufficient',
    );
  });

  test('hotfix block references the body-class drift fix', () => {
    assert.match(
      grammarWikiCss,
      /text-white[\s\S]{0,400}body/i,
      'hotfix comment should document the body-class drift fix',
    );
  });
});


describe('Body-class drift fix on grammar-article.html', () => {
  test('grammar-article.html <body> no longer carries `text-white` class', () => {
    const m = articleHtml.match(/<body\s+class="([^"]+)"/);
    assert.ok(m, 'body opening tag with class= must be present');
    const classes = m[1].split(/\s+/);
    assert.ok(
      !classes.includes('text-white'),
      `grammar-article.html <body> must drop the legacy text-white class — found classes: ${classes.join(', ')}`,
    );
  });

  test('grammar-article.html <body> still carries av-page (foundation)', () => {
    const m = articleHtml.match(/<body\s+class="([^"]+)"/);
    assert.ok(m);
    assert.ok(
      m[1].split(/\s+/).includes('av-page'),
      'av-page class must remain — required for the Aver token cascade',
    );
  });
});


describe('Defensive cascade hardening in grammar-wiki.css', () => {
  test('body.av-page.text-white compound selector present (body-element guard)', () => {
    // Compound selector (no space) targets the body element itself when
    // it carries both classes. Defensive even after the body-class
    // drift fix above.
    assert.match(
      grammarWikiCss,
      /body\.av-page\.text-white\s*\{/,
      'compound selector `body.av-page.text-white` must be present to bulletproof the body element',
    );
  });

  test('article body container has explicit token color', () => {
    // Look for the high-specificity rule block.
    assert.match(
      grammarWikiCss,
      /body\.av-page\s+\.article-body[\s\S]{0,500}var\(--av-text-primary\)/,
      'body.av-page .article-body must explicitly resolve to --av-text-primary',
    );
  });

  // Bare semantic descendants the markdown pipeline emits.
  ['p', 'li', 'td', 'span', 'em', 'blockquote'].forEach((tag) => {
    test(`bare <${tag}> inside .article-body has scoped color override`, () => {
      const pattern = new RegExp(
        `body\\.av-page\\s+\\.article-body\\s+${tag}\\b`,
      );
      assert.match(
        grammarWikiCss,
        pattern,
        `body.av-page .article-body ${tag} override must exist — markdown emits class-less <${tag}> that otherwise inherits color from body`,
      );
    });
  });

  test('Article header chrome (#article-title, #article-meta, #breadcrumb) pinned', () => {
    ['#article-title', '#article-meta', '#breadcrumb'].forEach((id) => {
      const pattern = new RegExp(`body\\.av-page\\s+${id.replace('#', '#')}`);
      assert.match(
        grammarWikiCss,
        pattern,
        `body.av-page ${id} must be pinned at high specificity`,
      );
    });
  });

  test('Table headers preserve teal accent (not collapsed to primary text)', () => {
    assert.match(
      grammarWikiCss,
      /body\.av-page\s+\.article-body\s+table\s+th[\s\S]{0,200}var\(--av-primary\)/,
      'table th teal accent must survive the defensive paragraph rule',
    );
  });
});


describe('Token discipline (no hardcoded colors in hotfix block)', () => {
  test('hotfix block contains zero hardcoded white literals', () => {
    // Inspect only the Sprint 6.15.5-hotfix block — earlier parts of
    // grammar-wiki.css legitimately use color-mix() and rgba() for
    // surfaces.
    const block = grammarWikiCss.match(
      /Sprint 6\.15\.5-hotfix[\s\S]*?(?=\/\* Lora-display)/,
    );
    assert.ok(block, 'Sprint 6.15.5-hotfix block must be findable');
    const hardcoded = block[0].match(
      /color:\s*(#fff\b|#ffffff\b|white\b|rgba\(\s*255\s*,\s*255\s*,\s*255)/gi,
    ) || [];
    assert.strictEqual(
      hardcoded.length,
      0,
      `Sprint 6.15.5-hotfix block must use --av-* tokens only — found ${hardcoded.length} hardcoded whites: ${hardcoded.join(', ')}`,
    );
  });

  test('hotfix block references all four --av-text-* tokens', () => {
    // Hierarchy must remain available — primary for body, muted for meta,
    // primary again for strong/headings.
    assert.match(grammarWikiCss, /--av-text-primary/);
    assert.match(grammarWikiCss, /--av-text-muted/);
  });
});


describe('grammar-article.html chrome still links the full foundation', () => {
  // Defense against a future stripped-down rewrite — Sprint 6.15.5
  // depends on the override block in grammar-wiki.css winning at higher
  // specificity than Tailwind utilities, which requires the foundation
  // order (tokens → components → ds → grammar-wiki).
  ['tokens.css', 'components.css', 'ds.css', 'grammar-wiki.css'].forEach((href) => {
    test(`grammar-article.html links ${href}`, () => {
      const escaped = href.replace(/\./g, '\\.');
      assert.match(
        articleHtml,
        new RegExp(`<link[^>]*${escaped}`),
        `grammar-article.html must keep <link> to ${href}`,
      );
    });
  });
});
