/**
 * frontend/tests/index-redesign.test.mjs — Sprint 6.13a
 * (Phase 4 opening — marketing landing).
 *
 * Run with: node --test frontend/tests/index-redesign.test.mjs
 *
 * Pins the Sprint 6.13a surgical migration of /index.html (the
 * canonical landing route — Era A `#0C2340` / `#0F766E`) onto the
 * Aver Design System. First Phase 4 page.
 *
 * Also pins the **atomic Era B reconciliation** — `frontend/landing.html`
 * (the off-palette duplicate `#1B3A5C` / `#0D7377` that no production
 * code linked to) was deleted as part of this PR. Sentinel test below
 * asserts it stays deleted so a future PR can't quietly re-create the
 * orphan.
 *
 * Conversion-flow contract preserved byte-identical:
 *   - 8 CTAs target /login.html (nav signin, nav cta, hero primary,
 *     pricing free, pricing popular, pricing intensive, final cta,
 *     final signin, footer signin, footer signup)
 *   - 2 links target /grammar.html (nav + footer)
 *   - 1 link targets /pricing.html (price-note inline link)
 *   - 1 footer link targets /frontend/pages/home.html
 *   - 3 in-page anchors preserved: #features, #how-it-works, #pricing
 *   - Pricing section keeps inline style="display:none" (pre-launch hide)
 *
 * Spec-falsified concerns (the marketing-pre-work risk list expected
 * these; pre-work proved they don't apply to index.html):
 *   - NO SEO meta tags (no description / og / twitter / canonical / JSON-LD)
 *   - NO analytics tracking (no gtag / fbq / hotjar / amplitude / mixpanel)
 *   - NO A/B test infrastructure
 *   - NO cookie banner
 *   - NO auth-state-aware CTA logic
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');


let html;
let css;

before(() => {
  html = readFileSync(path.join(REPO_ROOT, 'frontend/index.html'),   'utf8');
  css  = readFileSync(path.join(REPO_ROOT, 'frontend/css/index.css'), 'utf8');
});


// ── Foundation links ──────────────────────────────────────────────


describe('index.html / foundation links', () => {
  test('links tokens.css before components.css before index.css', () => {
    const tokensIdx     = html.indexOf('aver-design/tokens.css');
    const componentsIdx = html.indexOf('aver-design/components.css');
    const pageIdx       = html.indexOf('css/index.css');
    assert.ok(tokensIdx > -1 && componentsIdx > -1 && pageIdx > -1);
    assert.ok(tokensIdx < componentsIdx);
    assert.ok(componentsIdx < pageIdx);
  });

  test('loads Plus Jakarta Sans + JetBrains Mono, drops Inter', () => {
    assert.match(html, /Plus\+Jakarta\+Sans/);
    assert.match(html, /JetBrains\+Mono/);
    assert.ok(!/family=Inter\b/.test(html), 'Inter must be removed (Era B legacy)');
  });

  test('links Lucide CDN (chrome glyphs)', () => {
    assert.match(html, /unpkg\.com\/lucide@latest/);
  });

  test('no inline <style> block (all styling lives in index.css)', () => {
    const blocks = (html.match(/<style[\s\S]*?<\/style>/g) || []).length;
    assert.equal(blocks, 0);
  });

  test('no Supabase / api.js — anonymous marketing page, no backend coupling', () => {
    // index.html is the public landing — no auth, no API calls.
    // If a future PR adds Supabase here, it should be a conscious
    // decision (e.g., auth-state-aware CTA), not a copy-paste from
    // logged-in pages.
    assert.ok(!/supabase-js@2/.test(html), 'index.html should not load Supabase');
    assert.ok(!/src=["'][^"']*js\/api\.js/.test(html), 'index.html should not load api.js');
  });
});


// ── Anti-flash IIFE order ─────────────────────────────────────────


describe('index.html / anti-flash IIFE runs before stylesheets', () => {
  test('canonical IIFE reads localStorage av-theme + validates', () => {
    assert.match(html, /localStorage\.getItem\(\s*['"]av-theme['"]\s*\)/);
    assert.match(
      html,
      /stored\s*===\s*['"](?:light|dark)['"]\s*\|\|\s*stored\s*===\s*['"](?:light|dark)['"]/,
    );
  });

  test('IIFE precedes the first stylesheet link', () => {
    const iifeIdx  = html.search(/localStorage\.getItem\(\s*['"]av-theme['"]/);
    const firstCss = html.search(/<link[^>]+stylesheet/);
    assert.ok(iifeIdx > -1 && firstCss > -1);
    assert.ok(iifeIdx < firstCss);
  });

  test('falls back to prefers-color-scheme system preference', () => {
    assert.match(html, /prefers-color-scheme:\s*dark/);
  });

  test('catch arm sets data-theme="light" last resort', () => {
    assert.match(
      html,
      /catch\s*\([^)]*\)\s*\{\s*document\.documentElement\.setAttribute\(\s*['"]data-theme['"]\s*,\s*['"]light['"]\s*\)/,
    );
  });

  test('NO Sprint 6.0.1 embedded-mode IIFE (marketing landing is not iframe-embedded)', () => {
    assert.ok(!/document\.documentElement\.classList\.add\(\s*['"]embedded-mode['"]\s*\)/.test(html));
  });
});


// ── Conversion flow preserved (the most important contract) ───────


describe('index.html / conversion flow preserved byte-identical', () => {
  test('href="/login.html" appears in all 8 expected slots', () => {
    // Nav signin + nav CTA + hero primary + pricing×3 + final CTA pair + footer×2.
    // The legacy had 8; the migration must keep all 8 wired to the same target.
    const count = (html.match(/href=["']\/login\.html["']/g) || []).length;
    assert.ok(count >= 8, `Expected ≥8 /login.html CTAs; found ${count}`);
  });

  test('href="/grammar.html" appears in both nav + footer', () => {
    const count = (html.match(/href=["']\/grammar\.html["']/g) || []).length;
    assert.equal(count, 2, `Expected 2 /grammar.html links (nav + footer); found ${count}`);
  });

  test('href="/pricing.html" inline link preserved (price-note)', () => {
    assert.match(html, /href=["']\/pricing\.html["']/);
  });

  test('href="/frontend/pages/home.html" footer dashboard link preserved', () => {
    assert.match(html, /href=["']\/frontend\/pages\/home\.html["']/);
  });

  test('two in-page anchors preserved (#features + #how-it-works)', () => {
    // #pricing section exists with id="pricing" but no href targets it
    // (pricing is hidden pre-launch — no in-page jump CTA links to it).
    for (const anchor of ['#features', '#how-it-works']) {
      assert.match(html, new RegExp(`href=["']${anchor}["']`));
    }
  });

  test('section IDs match the anchor destinations (incl. id="pricing" for future use)', () => {
    for (const id of ['features', 'how-it-works', 'pricing']) {
      assert.match(html, new RegExp(`id=["']${id}["']`));
    }
  });

  test('pricing section keeps inline style="display:none" pre-launch hide', () => {
    // Marketing controls this — the price section was hidden because
    // the launch wasn't ready. Pin against the migration accidentally
    // exposing it.
    assert.match(html, /id=["']pricing["'][^>]*style=["']display:none["']/);
  });

  test('no CTA destination drift (no /signup or /register URLs)', () => {
    // Legacy uses /login.html as the single signup entry. Pin against
    // a future PR introducing competing signup routes.
    assert.ok(!/href=["']\/signup["']/.test(html));
    assert.ok(!/href=["']\/register["']/.test(html));
  });
});


// ── Body class + chrome ───────────────────────────────────────────


describe('index.html / body class + chrome', () => {
  test('body uses av-page (no ds-canvas, no text-slate-800)', () => {
    assert.match(html, /<body[^>]*class=["'][^"']*\bav-page\b/);
    assert.ok(!/<body[^>]*class=["'][^"']*\bds-canvas\b/.test(html));
    assert.ok(!/<body[^>]*class=["'][^"']*\btext-slate-800\b/.test(html));
  });

  test('header has theme toggle with canonical .icon-sun / .icon-moon', () => {
    assert.match(html, /class=["'][^"']*\bav-theme-toggle\b/);
    assert.match(html, /class=["']icon-sun["']/);
    assert.match(html, /class=["']icon-moon["']/);
  });

  test('no BEM drift on the toggle (Sprint 6.10.1 audit gate)', () => {
    for (const v of ['av-theme-toggle__icon--sun', 'av-theme-toggle__icon--moon', 'theme-toggle__icon']) {
      assert.ok(!html.includes(v));
    }
  });

  test('toggle binding wired (bindToggleButton + lucide hydration)', () => {
    assert.match(html, /bindToggleButton\s*\(\s*\)/);
    assert.match(html, /lucide\.createIcons/);
  });

  test('brand wordmark preserved (averlearning)', () => {
    // Marketing tone-setting — the brand string appears in nav + footer.
    const count = (html.match(/averlearning/g) || []).length;
    assert.ok(count >= 2, `Expected ≥2 'averlearning' wordmark mentions; found ${count}`);
  });
});


// ── No inline color literals in static markup ─────────────────────


describe('index.html / no inline color literals in static markup', () => {
  test('no inline style="color:#…" or "background:#…" on static markup', () => {
    const stripped = html.replace(/<script[\s\S]*?<\/script>/g, '');
    const bad = stripped.match(/style=["'][^"']*(?:color|background)\s*:\s*#[0-9a-fA-F]/g) || [];
    assert.deepEqual(bad, []);
  });

  test('no Era A hex literals (#0C2340 / #0F766E) in static markup', () => {
    const stripped = html.replace(/<script[\s\S]*?<\/script>/g, '');
    for (const h of ['#0C2340', '#0F766E', '#091C33', '#0D5F58', '#0d2540']) {
      assert.ok(!stripped.includes(h), `static markup still contains ${h}`);
    }
  });

  test('no Era B hex literals (#1B3A5C / #0D7377) leak into runtime CSS/markup (orphan landing.html guard)', () => {
    // landing.html was deleted in this PR; the Era B palette should
    // not have leaked into index.html during migration. Strip CSS
    // comments before scanning so the migration-explanation docstring
    // at the top of index.css (which intentionally cites the Era B
    // hex codes as historical context) doesn't trigger a false hit.
    const cssRuntime = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const h of ['#1B3A5C', '#0D7377', '#162F4A', '#1FA4A7', '#0a5c60']) {
      assert.ok(!html.includes(h),     `index.html should not contain Era B ${h}`);
      assert.ok(!cssRuntime.includes(h), `index.css runtime (non-comment) should not contain Era B ${h}`);
    }
  });

  test('no Tailwind `navy` / `teal` custom-palette config in <script> block', () => {
    // The legacy registered `navy.50…900` + `teal.50…900` in Tailwind
    // config. The migration drops these — components consume the
    // --av-* tokens instead.
    assert.ok(!/colors:\s*\{[\s\S]*?navy:/.test(html), 'Tailwind navy palette must be removed');
    assert.ok(!/colors:\s*\{[\s\S]*?teal:/.test(html), 'Tailwind teal palette must be removed');
  });
});


// ── index.css token discipline ────────────────────────────────────


describe('index.css / token discipline', () => {
  test('uses --av-* tokens (no --ds-* tokens)', () => {
    const av = (css.match(/var\(--av-/g) || []).length;
    const ds = (css.match(/var\(--ds-/g) || []).length;
    assert.ok(av > 80, `Expected many --av-* refs, got ${av}`);
    assert.equal(ds, 0, 'Legacy --ds-* tokens must be migrated');
  });

  test('no hardcoded `color: #...` runtime declarations (white/black for atmosphere is OK on hero)', () => {
    // The hero + footer are "always-dark" by design (marketing
    // atmosphere). They use literal #FFFFFF + rgba(255,…) values
    // because the surface is dark in both themes. The rule below
    // catches hex `color:` not `color: #FFFFFF` on hero.
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const hexColors = stripped.match(/^\s*color:\s*#[0-9a-fA-F]{3,6};/gm) || [];
    // Hero + footer atmosphere intentionally use #FFFFFF — allow only
    // that single color value, no other hex.
    const nonWhite = hexColors.filter(line => !/#FFFFFF\b/i.test(line));
    assert.deepEqual(nonWhite, [], `Non-whitelist hex color rules: ${nonWhite.join(' | ')}`);
  });

  test('no av-space-5/7/9/10/11/13/14/15 (4px-grid skips)', () => {
    const forbidden = css.match(/--av-space-(5|7|9|10|11|13|14|15)\b/g) || [];
    assert.deepEqual(forbidden, []);
  });

  test('--av-text-faint usage stays under the 10-instance cap', () => {
    const total = (html.match(/--av-text-faint/g) || []).length + (css.match(/--av-text-faint/g) || []).length;
    assert.ok(total <= 10, `--av-text-faint ≤ 10, got ${total}`);
  });

  test('nav CTA routes through --av-text-on-primary (Sprint 6.7.1)', () => {
    assert.match(
      css,
      /\.ix-nav-cta[\s\S]{0,400}--av-text-on-primary/,
      'Nav CTA missing --av-text-on-primary text color',
    );
  });

  test('pricing-popular CTA + step icon CTA also route through --av-text-on-primary', () => {
    // The "Học viên" (popular) tier CTA is on a primary-gradient
    // background — its text must use the inverse-on-brand token.
    assert.match(css, /--av-text-on-primary/);
    // The mid-step icon (Step 2) sits on --av-primary background.
    assert.match(css, /\.ix-step__icon[\s\S]{0,300}--av-text-on-primary/);
  });

  test('all key component class blocks defined', () => {
    for (const sel of [
      '.ix-nav', '.ix-nav-link', '.ix-nav-cta',
      '.ix-hero', '.ix-hero__title', '.ix-hero__lead',
      '.ix-cta-light', '.ix-cta-ghost',
      '.ix-stats-bar', '.ix-stat__num',
      '.ix-section', '.ix-section-sunken',
      '.ix-feature-card', '.ix-feature-card--popular',
      '.ix-step__icon', '.ix-step-line',
      '.ix-price-card', '.ix-price-card--popular',
      '.ix-testimonial', '.ix-testimonial__star',
      '.ix-footer', '.ix-footer__link',
    ]) {
      assert.match(css, new RegExp(sel.replace(/[.\-]/g, m => '\\' + m)), `Missing rule for ${sel}`);
    }
  });

  test('stat numbers + price amounts + score numbers use mono font', () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const sel of ['.ix-stat__num', '.ix-price-card__amount', '.ix-mock__score-num']) {
      const escaped = sel.replace(/[.\-]/g, m => '\\' + m);
      const block = stripped.match(new RegExp('^' + escaped + '[^{]*\\{[^}]*\\}', 'm'));
      assert.ok(block, `${sel} block missing`);
      assert.match(block[0], /--av-font-mono/, `${sel} must use --av-font-mono`);
    }
  });

  test('focus-visible affordance defined on hero CTAs', () => {
    assert.match(css, /\.ix-cta-light:focus-visible[\s\S]{0,200}--av-shadow-focus/);
    assert.match(css, /\.ix-cta-ghost:focus-visible[\s\S]{0,200}--av-shadow-focus/);
  });
});


// ── Vietnamese marketing microcopy preserved exactly ──────────────


describe('index.html / Vietnamese marketing microcopy preserved exactly', () => {
  // Marketing copy is tone-setting + carefully crafted. The cumulative-
  // lesson "Don't paraphrase Vietnamese copy" rule is enforced here for
  // the strings most visible to a prospect.
  const phrases = [
    'Luyện IELTS Speaking cùng AI',                   // <title>
    'Nói tự tin hơn.',                                // hero h1
    'Đạt band cao hơn.',                              // hero h1 accent
    'Luyện IELTS Speaking 1–1 cùng AI',               // hero lead
    'Bắt đầu miễn phí',                               // hero primary CTA + free-tier CTA
    'Dùng thử miễn phí',                              // nav CTA
    'Dùng thử miễn phí ngay',                         // final CTA
    'Xem cách hoạt động',                             // hero secondary CTA
    'Không cần thẻ tín dụng · Dùng thử 3 buổi miễn phí',
    'Học viên đang luyện tập',                        // stat label
    'Buổi luyện đã hoàn thành',
    'Band điểm tăng trung bình',
    'Mọi thứ bạn cần để',                             // features h2
    'Phản hồi AI chi tiết',                           // feature 1 title
    'Chấm điểm phát âm',                              // feature 2 title
    'Grammar Wiki',                                   // feature 3 title + nav link
    '3 bước đơn giản',                                // how-it-works h2
    'Tạo tài khoản',
    'Trả lời câu hỏi',
    'Nhận phản hồi ngay',
    'Bắt đầu miễn phí,',                              // pricing h2
    'nâng cấp khi sẵn sàng',
    'Phổ biến nhất',
    'Học viên',                                       // popular tier name
    'Luyện thi cấp tốc',
    'Chọn gói này',
    'Học viên nói gì',
    'Kết quả thực tế',
    'Sẵn sàng nâng band',
    'Đăng nhập',
    'Đăng ký',
  ];

  for (const phrase of phrases) {
    test(`microcopy preserved: "${phrase.slice(0, 36)}…"`, () => {
      assert.ok(html.includes(phrase), `Missing exact Vietnamese phrase: ${phrase}`);
    });
  }
});


// ── Era B reconciliation: landing.html orphan deletion ────────────


describe('Era B reconciliation: frontend/landing.html deleted (sentinel)', () => {
  test('frontend/landing.html does NOT exist (orphan deletion guard)', () => {
    // Pre-Sprint-6.13a, frontend/landing.html was an off-palette
    // Era B duplicate (#1B3A5C / #0D7377) that no production code
    // linked to. Sprint 6.13a deleted it. This sentinel asserts the
    // file stays deleted — a future PR cannot quietly resurrect the
    // orphan via a copy-paste.
    const orphanPath = path.join(REPO_ROOT, 'frontend/landing.html');
    assert.ok(
      !existsSync(orphanPath),
      'frontend/landing.html resurfaced — this was the Era B orphan ' +
      'deleted in Sprint 6.13a. If a marketing landing variant is ' +
      'genuinely needed, build it on the Aver Design System, not as ' +
      'a copy of the pre-migration page.',
    );
  });

  test('no production code references frontend/landing.html', () => {
    // Pre-migration verification confirmed only audit-doc files
    // referenced landing.html. If a production file starts linking
    // to it post-deletion, the link is broken. Sentinel: pin that
    // production code under frontend/{pages,js}/ doesn't reference
    // landing.html by name.
    //
    // We scope the check to a representative production-code subset
    // to avoid pulling in node_modules / git objects / audit reports.
    const probePaths = [
      'frontend/pages/home.html',
      'frontend/pages/speaking.html',
      'frontend/pages/practice.html',
      'frontend/pages/result.html',
      'frontend/pages/writing-dashboard.html',
      'frontend/pages/writing-result.html',
      'frontend/pages/full-test-result.html',
      'frontend/pages/vocabulary.html',
      'frontend/pages/my-vocabulary.html',
      'frontend/pages/flashcards.html',
      'frontend/pages/exercises.html',
      'frontend/pages/profile.html',
      'frontend/onboarding.html',
      'frontend/index.html',
      'frontend/login.html',
      'frontend/vocabulary.html',
      'frontend/js/api.js',
    ];
    for (const rel of probePaths) {
      const p = path.join(REPO_ROOT, rel);
      if (!existsSync(p)) continue;
      const src = readFileSync(p, 'utf8');
      assert.ok(
        !/landing\.html/.test(src),
        `${rel} references landing.html — broken link after Sprint 6.13a deletion`,
      );
    }
  });
});
