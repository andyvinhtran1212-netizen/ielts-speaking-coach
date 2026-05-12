/**
 * frontend/tests/onboarding-redesign.test.mjs — Sprint 6.12b
 * (Phase 3 closure).
 *
 * Run with: node --test frontend/tests/onboarding-redesign.test.mjs
 *
 * Pins the Sprint 6.12b surgical migration of `/onboarding.html` —
 * the post-signup 3-step wizard at the frontend root (NOT `/pages/`).
 * Final Tier 1 page; Phase 3 closure.
 *
 * The inline state machine (lines 264+) stays byte-identical:
 *
 *   - currentStep (1 → 3) + goingBack flag
 *   - stepData = { targetBand, examDate, selfLevel, topic }
 *   - showStep(n, back) — toggles .step-panel.active + .slide-back
 *   - initCardGroup(containerId, onSelect) — drives .opt-card.selected
 *   - validateStep(step) — per-step guard with showError() fail path
 *   - submitOnboarding() — PATCH /auth/profile { ..., onboarding_completed: true }
 *   - init() — GET /auth/me already-onboarded → pages/home.html; no-session → login.html
 *
 * 14 element IDs preserved (step-label, step-pct, progress-fill,
 * error-banner, step-1, step-2, step-3, btn-back, btn-next, nav-row,
 * target-band, exam-date, level-cards, topic-cards); 4 level
 * data-values + 3 topic data-values; submit redirect to
 * pages/home.html?first_topic=… preserved byte-identical.
 *
 * Migration normalizes the production typo `#14a8ae` (used in 3 places
 * — `step-label`, `wordmark__brand`, `check-icon`) to `--av-primary`.
 * The intended color was `#14b8a6` (brand teal) all along.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');


let html;
let css;

before(() => {
  html = readFileSync(path.join(REPO_ROOT, 'frontend/onboarding.html'),   'utf8');
  css  = readFileSync(path.join(REPO_ROOT, 'frontend/css/onboarding.css'), 'utf8');
});


// ── Foundation links ──────────────────────────────────────────────


describe('onboarding.html / foundation links', () => {
  test('links tokens.css before components.css before onboarding.css', () => {
    const tokensIdx     = html.indexOf('aver-design/tokens.css');
    const componentsIdx = html.indexOf('aver-design/components.css');
    const pageIdx       = html.indexOf('css/onboarding.css');
    assert.ok(tokensIdx > -1 && componentsIdx > -1 && pageIdx > -1);
    assert.ok(tokensIdx < componentsIdx);
    assert.ok(componentsIdx < pageIdx);
  });

  test('still links ds.css for legacy bridge', () => {
    assert.match(html, /href=["'][^"']*css\/ds\.css["']/);
  });

  test('loads Plus Jakarta Sans + JetBrains Mono, drops Manrope/Fraunces', () => {
    assert.match(html, /Plus\+Jakarta\+Sans/);
    assert.match(html, /JetBrains\+Mono/);
    assert.ok(!/family=Manrope\b/.test(html), 'Manrope must be removed');
    assert.ok(!/family=Fraunces\b/.test(html), 'Fraunces must be removed');
  });

  test('links Lucide CDN (chrome glyphs)', () => {
    assert.match(html, /unpkg\.com\/lucide@latest/);
  });

  test('still loads Supabase + api.js (auth + PATCH /auth/profile)', () => {
    assert.match(html, /@supabase\/supabase-js@2/);
    assert.match(html, /js\/api\.js/);
  });

  test('no external onboarding.js (state machine lives inline at bottom of page)', () => {
    assert.ok(!/src=["'][^"']*js\/onboarding\.js/.test(html));
  });
});


// ── Anti-flash IIFE order ─────────────────────────────────────────


describe('onboarding.html / anti-flash IIFE runs before stylesheets', () => {
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
    assert.ok(iifeIdx < firstCss, 'IIFE must set data-theme before stylesheets paint');
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

  test('does NOT use weak `var theme = stored ||` short-circuit', () => {
    assert.ok(!/var\s+theme\s*=\s*stored\s*\|\|/.test(html));
  });

  test('NO Sprint 6.0.1 embedded-mode IIFE (onboarding is not iframe-embedded)', () => {
    assert.ok(!/document\.documentElement\.classList\.add\(\s*['"]embedded-mode['"]\s*\)/.test(html));
  });
});


// ── JS-coupled selectors + state machine preserved ────────────────


describe('onboarding.html / JS-coupled selectors preserved byte-identical', () => {
  const requiredIds = [
    'step-label', 'step-pct', 'progress-fill', 'error-banner',
    'step-1', 'step-2', 'step-3',
    'btn-back', 'btn-next', 'nav-row',
    'target-band', 'exam-date',
    'level-cards', 'topic-cards',
  ];

  for (const id of requiredIds) {
    test(`id="${id}" preserved`, () => {
      assert.match(html, new RegExp(`id=["']${id}["']`));
    });
  }

  test('4 level option cards preserved (beginner/intermediate/upper_intermediate/advanced)', () => {
    for (const v of ['beginner', 'intermediate', 'upper_intermediate', 'advanced']) {
      assert.match(html, new RegExp(`data-value=["']${v}["']`));
    }
  });

  test('3 topic option cards preserved (work/technology/education)', () => {
    for (const v of ['work', 'technology', 'education']) {
      assert.match(html, new RegExp(`data-value=["']${v}["']`));
    }
  });

  test('target-band <select> retains all 7 band options (5.0 → 8.0)', () => {
    for (const b of ['5.0', '5.5', '6.0', '6.5', '7.0', '7.5', '8.0']) {
      assert.match(html, new RegExp(`<option value=["']${b}["']>`));
    }
  });

  test('state machine variables preserved (currentStep, goingBack, stepData)', () => {
    assert.match(html, /var\s+currentStep\s*=\s*1/);
    assert.match(html, /var\s+goingBack\s*=\s*false/);
    assert.match(html, /var\s+stepData\s*=\s*\{/);
    assert.match(html, /targetBand:\s*null/);
    assert.match(html, /examDate:\s*null/);
    assert.match(html, /selfLevel:\s*null/);
    assert.match(html, /topic:\s*null/);
  });

  test('showStep(n, back) preserves slide-back animation hook', () => {
    assert.match(html, /function\s+showStep\s*\(\s*n\s*,\s*back\s*\)/);
    assert.match(html, /if\s*\(\s*back\s*\)\s*panel\.classList\.add\(\s*['"]slide-back['"]\s*\)/);
  });

  test('initCardGroup drives .opt-card.selected toggling', () => {
    assert.match(html, /function\s+initCardGroup\s*\(\s*containerId\s*,\s*onSelect\s*\)/);
    assert.match(html, /card\.classList\.add\(\s*['"]selected['"]\s*\)/);
    assert.match(html, /onSelect\(\s*card\.dataset\.value\s*\)/);
  });

  test('validateStep guards each step + early returns on failure', () => {
    assert.match(html, /function\s+validateStep\s*\(\s*step\s*\)/);
    assert.match(html, /if\s*\(\s*!band\s*\)\s*\{\s*showError/);
    assert.match(html, /if\s*\(\s*!selectedLevel\s*\)\s*\{\s*showError/);
    assert.match(html, /if\s*\(\s*!selectedTopic\s*\)\s*\{\s*showError/);
  });

  test('submitOnboarding PATCH /auth/profile contract preserved (5 fields)', () => {
    assert.match(html, /api\.patch\(\s*['"]\/auth\/profile['"]/);
    assert.match(html, /target_band:\s*stepData\.targetBand/);
    assert.match(html, /exam_date:\s*stepData\.examDate/);
    assert.match(html, /self_level:\s*stepData\.selfLevel/);
    assert.match(html, /preferred_topics:\s*\[\s*stepData\.topic\s*\]/);
    assert.match(html, /onboarding_completed:\s*true/);
  });

  test('submit redirect to pages/home.html?first_topic=… preserved', () => {
    assert.match(
      html,
      /window\.location\.href\s*=\s*['"]pages\/home\.html\?first_topic=['"]\s*\+\s*encodeURIComponent\(\s*stepData\.topic\s*\)/,
    );
  });

  test('init() preserves no-session redirect to login.html', () => {
    assert.match(html, /if\s*\(\s*!session\s*\)\s*\{\s*window\.location\.href\s*=\s*['"]login\.html['"]/);
  });

  test('init() preserves already-onboarded redirect to pages/home.html', () => {
    assert.match(html, /api\.get\(\s*['"]\/auth\/me['"]\s*\)/);
    assert.match(
      html,
      /if\s*\(\s*user\s*&&\s*user\.onboarding_completed\s*\)\s*\{\s*window\.location\.href\s*=\s*['"]pages\/home\.html['"]/,
    );
  });

  test('Next button text swap preserved (step 3 = 🚀 Bắt đầu luyện tập ngay)', () => {
    assert.match(html, /btnNext\.textContent\s*=\s*['"]🚀\s+Bắt đầu luyện tập ngay['"]/);
    assert.match(html, /btnNext\.textContent\s*=\s*['"]Tiếp theo →['"]/);
  });
});


// ── Body class + chrome ───────────────────────────────────────────


describe('onboarding.html / body class + chrome', () => {
  test('body uses av-page (no ds-canvas, no text-white)', () => {
    assert.match(html, /<body[^>]*class=["'][^"']*\bav-page\b/);
    assert.ok(!/<body[^>]*class=["'][^"']*\bds-canvas\b/.test(html));
    assert.ok(!/<body[^>]*class=["'][^"']*\btext-white\b/.test(html));
  });

  test('header has theme toggle with canonical .icon-sun / .icon-moon', () => {
    assert.match(html, /class=["'][^"']*\bav-theme-toggle\b/);
    assert.match(html, /class=["']icon-sun["']/);
    assert.match(html, /class=["']icon-moon["']/);
  });

  test('no BEM drift on the toggle (Sprint 6.10.1)', () => {
    for (const v of ['av-theme-toggle__icon--sun', 'av-theme-toggle__icon--moon', 'theme-toggle__icon']) {
      assert.ok(!html.includes(v));
    }
  });

  test('toggle binding wired (canonical /js/theme-toggle.js module — Sprint 6.17.1)', () => {
    assert.match(
      html,
      /import\s+\{\s*bindToggleButton\s*\}\s+from\s+['"]\/js\/theme-toggle\.js['"]/,
    );
    assert.match(html, /lucide\.createIcons/);
  });

  test('step-header emoji preserved (Sprint 6.17.1 dropped 🎙️ nav wordmark; step emojis retained)', () => {
    // Sprint 6.17.1 Q3: canonical brand only in chrome — 🎙️ removed from
    // nav wordmark per Andy approval. Step-header emojis stay (page body).
    assert.match(html, /👋/);   // step 1 title
    assert.match(html, /📊/);   // step 2 title
    assert.match(html, /🎯/);   // step 3 title
  });

  test('option-card icon emoji preserved (4 level + 3 topic)', () => {
    for (const e of ['🌱', '📚', '🚀', '🏆', '💼', '💻', '🎓']) {
      assert.match(html, new RegExp(e));
    }
  });
});


// ── No inline <style> block ───────────────────────────────────────


describe('onboarding.html / no inline <style> block (all styling in onboarding.css)', () => {
  test('zero <style> blocks remain', () => {
    const blocks = (html.match(/<style[\s\S]*?<\/style>/g) || []).length;
    assert.equal(blocks, 0, 'inline <style> block should be migrated to onboarding.css');
  });

  test('no inline style="color:#…" or "background:#…" in static markup', () => {
    const stripped = html.replace(/<script[\s\S]*?<\/script>/g, '');
    const bad = stripped.match(/style=["'][^"']*(?:color|background)\s*:\s*#[0-9a-fA-F]/g) || [];
    assert.deepEqual(bad, []);
  });

  test('no rgba(255,255,255,…) literals in static markup', () => {
    const stripped = html.replace(/<script[\s\S]*?<\/script>/g, '');
    const bad = stripped.match(/rgba\(\s*255\s*,\s*255\s*,\s*255/g) || [];
    assert.deepEqual(bad, []);
  });

  test('no hardcoded brand-teal hex (#14b8a6 / #0F766E / #0C2340 / #14a8ae typo)', () => {
    const stripped = html.replace(/<script[\s\S]*?<\/script>/g, '');
    for (const h of ['#14b8a6', '#0F766E', '#0C2340', '#14a8ae', '#0d5f58', '#112d52', '#081829']) {
      assert.ok(!stripped.includes(h), `static markup still contains hardcoded ${h}`);
    }
  });

  test('production #14a8ae typo eliminated from the whole page (HTML + inline JS)', () => {
    // The pre-migration page used '#14a8ae' in 3 places where the
    // intent was brand teal '#14b8a6'. The migration routes everything
    // through --av-primary, so neither value should appear anywhere.
    assert.ok(!html.includes('#14a8ae'));
  });
});


// ── onboarding.css token discipline ───────────────────────────────


describe('onboarding.css / token discipline', () => {
  test('uses --av-* tokens (no --ds-* tokens)', () => {
    const av = (css.match(/var\(--av-/g) || []).length;
    const ds = (css.match(/var\(--ds-/g) || []).length;
    assert.ok(av > 50, `Expected many --av-* refs, got ${av}`);
    assert.equal(ds, 0, 'Legacy --ds-* tokens must be migrated');
  });

  test('no hardcoded color: hex/white/black declarations', () => {
    const bad = css.match(/^\s*color:\s*(#[0-9a-fA-F]{3,6}|white|black);/gm) || [];
    assert.deepEqual(bad, []);
  });

  test('no background: hardcoded hex declarations', () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const bad = stripped.match(/^\s*background:\s*#[0-9a-fA-F]{3,6};/gm) || [];
    assert.deepEqual(bad, []);
  });

  test('no rgba(255,255,255,…) wrappers (force-dark assumption)', () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const bad = stripped.match(/rgba\(\s*255\s*,\s*255\s*,\s*255/g) || [];
    assert.deepEqual(bad, []);
  });

  test('no av-space-5/7/9/10/11/13/14/15 (4px-grid skips)', () => {
    const forbidden = css.match(/--av-space-(5|7|9|10|11|13|14|15)\b/g) || [];
    assert.deepEqual(forbidden, []);
  });

  test('--av-text-faint usage stays under the 10-instance cap', () => {
    const total = (html.match(/--av-text-faint/g) || []).length + (css.match(/--av-text-faint/g) || []).length;
    assert.ok(total <= 10, `--av-text-faint ≤ 10, got ${total}`);
  });

  test('btn-primary CTA routes through --av-text-on-primary (Sprint 6.7.1)', () => {
    assert.match(
      css,
      /\.btn-primary[\s\S]{0,400}--av-text-on-primary/,
      'Primary CTA missing --av-text-on-primary text color',
    );
  });

  test('all key component class blocks defined', () => {
    for (const sel of ['.ob-card', '.ob-progress-fill', '.ob-progress-track',
                       '.form-input', '.opt-card', '.opt-card.selected',
                       '.check-icon', '.btn-primary', '.btn-back',
                       '.ob-error-banner', '.step-panel']) {
      assert.match(css, new RegExp(sel.replace(/[.\-]/g, m => '\\' + m)), `Missing rule for ${sel}`);
    }
  });

  test('step-panel slide animations renamed to ob-slide-in / ob-slide-back', () => {
    // Sprint 6.12b namespaced the @keyframes to avoid clashing with
    // global slideIn/slideBack animations that other pages may declare.
    assert.match(css, /@keyframes\s+ob-slide-in/);
    assert.match(css, /@keyframes\s+ob-slide-back/);
  });

  test('focus-visible affordance defined on form-input + btn-primary', () => {
    assert.match(css, /\.form-input:focus[\s\S]{0,200}--av-shadow-focus/);
    assert.match(css, /\.btn-primary:focus-visible[\s\S]{0,200}--av-shadow-focus/);
  });
});


// ── Error banner contract preserved ───────────────────────────────


describe('onboarding.html / error banner contract preserved', () => {
  test('error-banner uses a class hook (ob-error-banner) for theming', () => {
    assert.match(html, /id=["']error-banner["'][^>]*class=["'][^"']*\bob-error-banner\b/);
  });

  test('inline IIFE toggles .show class instead of style.display assignment', () => {
    // Pre-migration: `errorBanner.style.display = 'block'`. Now: `errorBanner.classList.add('show')`.
    assert.ok(
      !/errorBanner\.style\.display\s*=\s*['"]block['"]/.test(html),
      'showError should toggle a class, not assign style.display',
    );
    assert.match(html, /errorBanner\.classList\.add\(\s*['"]show['"]\s*\)/);
    assert.match(html, /errorBanner\.classList\.remove\(\s*['"]show['"]\s*\)/);
  });

  test('ob-error-banner.show rule defined in onboarding.css', () => {
    assert.match(css, /\.ob-error-banner\.show\s*\{[^}]*display:\s*block/);
    assert.match(css, /\.ob-error-banner[\s\S]{0,400}--av-error/);
  });
});


// ── Vietnamese microcopy preserved (Andy's tone-setting concern) ──


describe('onboarding.html / Vietnamese microcopy preserved exactly', () => {
  // First-time user UX is tone-setting. The cumulative-lesson list
  // (anti-pattern: "Don't paraphrase Vietnamese copy — lift exact")
  // is enforced here for the strings most visible to a new user.
  const phrases = [
    'Chào mừng đến Aver Learning!',
    'Chúng mình cần biết thêm về bạn',
    'Mục tiêu band score',
    'Ngày thi dự kiến',
    '(tuỳ chọn)',
    'Trình độ hiện tại của bạn?',
    'Chọn mức phù hợp nhất',
    'Chọn chủ đề đầu tiên',
    'Mới bắt đầu',
    'Trung cấp (Band 5–6)',
    'Trên trung cấp (Band 6–7)',
    'Nâng cao (Band 7+)',
    'Công việc & Nghề nghiệp',
    'Công nghệ & Xã hội số',
    'Giáo dục & Học tập',
    'Tiếp theo →',
    '← Quay lại',
    'Bắt đầu luyện tập ngay',
    'Vui lòng chọn band score mục tiêu.',
    'Vui lòng chọn trình độ của bạn.',
    'Vui lòng chọn ít nhất một chủ đề.',
  ];

  for (const phrase of phrases) {
    test(`microcopy preserved: "${phrase.slice(0, 36)}…"`, () => {
      assert.ok(html.includes(phrase), `Missing exact Vietnamese phrase: ${phrase}`);
    });
  }
});
