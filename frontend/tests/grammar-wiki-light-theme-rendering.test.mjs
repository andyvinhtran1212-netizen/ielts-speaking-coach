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
import { readFileSync, readdirSync } from 'node:fs';
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
  const variants = ['90', '85', '80', '70', '65', '60', '55', '50', '45', '40', '35', '30', '28', '25', '20', '15'];

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


// PC-J13A — the hand-kept list above missed `/45`, which the Next article
// shell (#exercise-cta-sub) and /grammar/exercises use; it painted fixed white
// at 1.06:1 on the light page. Derive the list from the live grammar sources.
describe('every text-white/NN in the Next grammar routes has an override', () => {
  const GRAMMAR_APP = path.join(REPO_ROOT, 'frontend/app/(public-content)/grammar');
  const sources = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(tsx?|mjs|js)$/.test(entry.name) ? [full] : [];
  });

  test('grammar sources still use at least one opacity variant (scan is live)', () => {
    const used = new Set();
    for (const file of sources(GRAMMAR_APP)) {
      // Plain utilities only — `hover:` / `group-hover:` variants are pinned separately.
      for (const m of readFileSync(file, 'utf8').matchAll(/(?<![\w:-])text-white\/(\d+)\b/g)) used.add(m[1]);
    }
    assert.ok(used.has('45'), 'expected the /45 usage the PC-J13A fix covers');
    const missing = [...used].filter((opacity) =>
      !new RegExp(`body\\.av-page\\s+\\.text-white\\\\\\/${opacity}\\b`).test(grammarWikiCss));
    assert.deepEqual(missing, [], `text-white/${missing.join(', /')} used under app/(public-content)/grammar without an override`);
  });
});


describe('text-white/45 maps to a token that passes WCAG AA', () => {
  const tokensCss = () => readFileSync(path.join(REPO_ROOT, 'frontend/public/css/aver-design/tokens.css'), 'utf8');
  // First declaration of each token inside the block that opens at `marker`.
  const tokenIn = (css, marker, name) => {
    const block = css.slice(css.indexOf(marker));
    const m = block.match(new RegExp(`--${name}:\\s*([^;]+);`));
    assert.ok(m, `--${name} not found after ${marker}`);
    return m[1].trim();
  };
  const rgba = (value) => {
    const hex = value.match(/^#([0-9a-f]{6})$/i);
    if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1);
    const nums = value.match(/[\d.]+/g).map(Number);
    return nums.length === 3 ? nums.concat(1) : nums;
  };
  const over = ([r, g, b, a], [R, G, B]) => [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a)];
  const lum = (rgb) => {
    const [r, g, b] = rgb.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  // #exercise-cta-link: bg-teal/[0.06], hover:bg-teal/[0.1] (teal = #0F766E).
  const TEAL = [0x0f, 0x76, 0x6e];

  const mapped = () => {
    const m = grammarWikiCss.match(/body\.av-page\s+\.text-white\\\/45\s*\{\s*color:\s*var\(--([\w-]+)\)/);
    assert.ok(m, '.text-white/45 must map to a single --av-text-* token');
    return m[1];
  };

  [['light', ':root {'], ['dark', ':root[data-theme="dark"] {']].forEach(([theme, marker]) => {
    test(`${theme}: ≥ 4.5:1 on the page and on the exercise card (rest + hover)`, () => {
      const css = tokensCss();
      const page = rgba(tokenIn(css, marker, 'av-surface-page'));
      const ink = rgba(tokenIn(css, marker, mapped()));
      for (const [label, tint] of [['page', 0], ['card', 0.06], ['card hover', 0.1]]) {
        const bg = over([...TEAL, tint], page);
        const value = ratio(over(ink, bg), bg);
        assert.ok(value >= 4.5, `${theme} ${label}: ${value.toFixed(2)}:1 < 4.5:1`);
      }
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
