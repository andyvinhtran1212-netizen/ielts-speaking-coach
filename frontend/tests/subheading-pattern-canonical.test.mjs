/**
 * frontend/tests/subheading-pattern-canonical.test.mjs
 *
 * Sprint 6.19 — canonical subheading pattern sentinel.
 *
 * Phase B Andy approvals:
 *   - Q1: Promote `.eyebrow` (from home.css) to canonical primitive in
 *     components.css. Migrate `.ftr-eyebrow` → `.eyebrow` on the
 *     full-test-result page-hero. (Section eyebrows on FTR keep
 *     `.ftr-eyebrow` since they carry distinct styling + modifier
 *     variants `--strength`/`--improve`.)
 *   - Q2: Per-page eyebrow values:
 *       home → Trang chủ
 *       speaking / practice / result / full-test-result → Speaking
 *       writing-dashboard / writing-result → Writing
 *       vocabulary / my-vocabulary / flashcards / exercises → Vocabulary
 *       grammar-roadmap / grammar-search / grammar-compare /
 *         grammar-article → Grammar Wiki
 *       profile → Hồ sơ
 *       onboarding → Bắt đầu
 *       (FTR also preserves hero eyebrow "Overall Band Score" —
 *        domain context per Andy Q2.)
 *   - Q3: grammar.html preserves `.ds-badge.ds-badge-teal` editorial
 *     badge (§ 14.2 sub-system intentional). NO canonical .eyebrow
 *     migration on grammar.html.
 *   - Q4: Practice modes Speaking tabs vs Grammar buttons stay
 *     different (different semantics). No unification this sprint.
 *
 * Sprint 6.18 (chrome vertical spacing) and prior pin discipline
 * remain untouched.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');


// ── Foundation: canonical .eyebrow primitive in components.css ────

describe('Sprint 6.19 foundation — canonical .eyebrow promoted to components.css', () => {
  let components;
  before(() => {
    components = readFileSync(
      path.join(REPO_ROOT, 'frontend/css/aver-design/components.css'),
      'utf8',
    );
  });

  test('.eyebrow rule declared (standalone primitive, not scoped)', () => {
    // Match a top-level `.eyebrow {` (not `.greeting .eyebrow`)
    assert.match(
      components,
      /(^|\n)\.eyebrow\s*\{[\s\S]{0,400}\}/,
      'components.css must declare standalone .eyebrow primitive',
    );
  });

  test('.eyebrow uses canonical typography tokens', () => {
    // Extract the standalone .eyebrow block (avoid catching .greeting .eyebrow)
    const block = components.match(/(?:^|\n)\.eyebrow\s*\{([\s\S]{0,400}?)\}/);
    assert.ok(block, 'standalone .eyebrow block must be present');
    const body = block[1];
    assert.match(body, /font-size:\s*var\(--av-fs-xs\)/);
    assert.match(body, /font-weight:\s*var\(--av-fw-semibold\)/);
    assert.match(body, /letter-spacing:\s*var\(--av-tracking-widest\)/);
    assert.match(body, /color:\s*var\(--av-primary\)/);
    assert.match(body, /text-transform:\s*uppercase/);
  });
});


// ── Per-page canonical eyebrow values ─────────────────────────────

describe('Sprint 6.19 per-page — canonical .eyebrow value present', () => {
  const EYEBROW_PINS = [
    { rel: 'frontend/pages/home.html',              text: 'Trang chủ' },
    { rel: 'frontend/pages/speaking.html',          text: 'Speaking' },
    { rel: 'frontend/pages/practice.html',          text: 'Speaking' },
    { rel: 'frontend/pages/result.html',            text: 'Speaking' },
    { rel: 'frontend/pages/full-test-result.html',  text: 'Speaking' },
    { rel: 'frontend/pages/writing-dashboard.html', text: 'Writing' },
    { rel: 'frontend/pages/writing-result.html',    text: 'Writing' },
    { rel: 'frontend/pages/vocabulary.html',        text: 'Vocabulary' },
    { rel: 'frontend/pages/my-vocabulary.html',     text: 'Vocabulary' },
    { rel: 'frontend/pages/flashcards.html',        text: 'Vocabulary' },
    { rel: 'frontend/pages/exercises.html',         text: 'Vocabulary' },
    { rel: 'frontend/pages/grammar-roadmap.html',   text: 'Grammar Wiki' },
    { rel: 'frontend/pages/grammar-search.html',    text: 'Grammar Wiki' },
    { rel: 'frontend/pages/grammar-compare.html',   text: 'Grammar Wiki' },
    { rel: 'frontend/pages/grammar-article.html',   text: 'Grammar Wiki' },
    { rel: 'frontend/pages/profile.html',           text: 'Hồ sơ' },
    { rel: 'frontend/onboarding.html',              text: 'Bắt đầu' },
  ];

  EYEBROW_PINS.forEach(({ rel, text }) => {
    test(`${rel} ships <p class="eyebrow">${text}</p>`, () => {
      const html = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      // Match any element with class="eyebrow" (allow extra utility classes)
      // whose visible text is exactly the expected value (case-insensitive).
      const re = new RegExp(
        `<p[^>]*\\bclass=["'][^"']*\\beyebrow\\b[^"']*["'][^>]*>\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*</p>`,
        'i',
      );
      assert.match(
        html,
        re,
        `${rel}: canonical "${text}" eyebrow tier label must be present (Sprint 6.19 Phase B Q2)`,
      );
    });
  });
});


// ── full-test-result.html hero — .ftr-eyebrow migrated to .eyebrow ──

describe('Sprint 6.19 full-test-result hero — .ftr-eyebrow migrated to canonical .eyebrow', () => {
  let html;
  before(() => {
    html = readFileSync(
      path.join(REPO_ROOT, 'frontend/pages/full-test-result.html'),
      'utf8',
    );
  });

  test('hero "Overall Band Score" eyebrow uses canonical .eyebrow class', () => {
    // Hero card "Overall Band Score" — Phase B Q2 preserved as domain
    // context, but class migrated from .ftr-eyebrow to .eyebrow.
    assert.match(
      html,
      /<p[^>]*\bclass=["'][^"']*\beyebrow\b[^"']*["'][^>]*>\s*Overall Band Score\s*<\/p>/i,
      'Hero "Overall Band Score" eyebrow must use canonical .eyebrow class (Phase B Q1 migration)',
    );
  });

  test('hero "Overall Band Score" does NOT regress to legacy .ftr-eyebrow', () => {
    // Section eyebrows (e.g. ".ftr-eyebrow--strength") still allowed —
    // only the page-hero must be canonical.
    assert.ok(
      !/<p[^>]*\bclass=["'][^"']*\bftr-eyebrow\b[^"']*["'][^>]*>\s*Overall Band Score\s*<\/p>/i.test(html),
      'Hero "Overall Band Score" must not regress to .ftr-eyebrow legacy class',
    );
  });
});


// ── grammar.html editorial badge preserved (Phase B Q3) ──────────

describe('Sprint 6.19 grammar.html — editorial badge preserved (Phase B Q3)', () => {
  let html;
  before(() => {
    html = readFileSync(path.join(REPO_ROOT, 'frontend/grammar.html'), 'utf8');
  });

  test('preserves .ds-badge.ds-badge-teal editorial badge', () => {
    // Andy Phase B Q3: § 14.2 editorial sub-system intentional — NO
    // migration to canonical .eyebrow. The editorial badge identity
    // is protected.
    assert.match(
      html,
      /<div[^>]*\bclass=["'][^"']*\bds-badge\b[^"']*\bds-badge-teal\b[^"']*["'][^>]*>/,
      'grammar.html must preserve .ds-badge.ds-badge-teal editorial badge (Phase B Q3)',
    );
  });

  test('does NOT add canonical .eyebrow (editorial exception)', () => {
    // grammar.html is the centered editorial reference; adding a generic
    // uppercase .eyebrow on top of the editorial badge would weaken the
    // editorial tier. Centered exception preserved.
    assert.ok(
      !/<p[^>]*\bclass=["'][^"']*\beyebrow\b[^"']*["'][^>]*>/.test(html),
      'grammar.html must NOT carry canonical .eyebrow (Phase B Q3 editorial exception)',
    );
  });
});


// ── Practice modes KEEP DIFFERENT (Phase B Q4) ───────────────────

describe('Sprint 6.19 Phase B Q4 — practice modes preserved as distinct patterns', () => {
  test('speaking.html ships .main-tab-nav 4-tab primary sub-nav', () => {
    const html = readFileSync(
      path.join(REPO_ROOT, 'frontend/pages/speaking.html'),
      'utf8',
    );
    assert.match(html, /<nav[^>]*\bclass=["'][^"']*\bmain-tab-nav\b[^"']*["']/);
    // 4 main-tab-btn elements (Dashboard / Luyện tập / Luyện từng Part / Full Test)
    const tabs = html.match(/\bmain-tab-btn\b/g) || [];
    assert.ok(
      tabs.length >= 4,
      `speaking.html should ship ≥ 4 .main-tab-btn elements, found ${tabs.length}`,
    );
  });

  test('grammar.html ships .btn-cta hero CTA buttons (distinct from speaking tabs)', () => {
    const html = readFileSync(
      path.join(REPO_ROOT, 'frontend/grammar.html'),
      'utf8',
    );
    assert.match(
      html,
      /\bbtn-cta\b/,
      'grammar.html must ship .btn-cta hero CTAs (Phase B Q4 — different semantics from speaking tabs)',
    );
  });
});


// ── Alignment NO-DRIFT — Phase A confirmed centered exceptions ────

describe('Sprint 6.19 alignment — centered exceptions documented + protected', () => {
  test('grammar.html main hero block is centered (canonical editorial exception)', () => {
    const html = readFileSync(
      path.join(REPO_ROOT, 'frontend/grammar.html'),
      'utf8',
    );
    // Look for text-center on the hero region or its parent container.
    assert.match(
      html,
      /text-center/,
      'grammar.html must preserve text-center editorial hero layout (Phase A documented)',
    );
  });

  test('onboarding.html main wrapper is centered (signup flow exception)', () => {
    const html = readFileSync(
      path.join(REPO_ROOT, 'frontend/onboarding.html'),
      'utf8',
    );
    // The <main> element uses flex items-center justify-center to center
    // its single .ob-card child.
    assert.match(
      html,
      /<main[^>]*\bflex\b[^>]*\bitems-center\b[^>]*\bjustify-center\b/,
      'onboarding.html <main> must preserve centered flex layout (signup flow Phase A documented)',
    );
  });

  test('full-test-result hero card uses .text-center (result summary exception)', () => {
    const html = readFileSync(
      path.join(REPO_ROOT, 'frontend/pages/full-test-result.html'),
      'utf8',
    );
    // The .ftr-hero card carries text-center for the band hero layout.
    assert.match(
      html,
      /<section[^>]*\bclass=["'][^"']*\bftr-hero\b[^"']*\btext-center\b[^"']*["']/,
      'full-test-result.ftr-hero must preserve text-center hero layout (Phase A documented)',
    );
  });
});
