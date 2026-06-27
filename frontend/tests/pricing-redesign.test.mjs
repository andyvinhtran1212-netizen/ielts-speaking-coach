/**
 * frontend/tests/pricing-redesign.test.mjs — Sprint 6.13b
 * (Phase 4 marketing, page 2 of 3).
 *
 * Run with: node --test frontend/tests/pricing-redesign.test.mjs
 *
 * Pins the Sprint 6.13b surgical migration of /pricing.html (Era B
 * `#1B3A5C` / `#0D7377` / Inter) onto the Aver Design System.
 *
 * The pricing page is currently hidden pre-launch behind a
 * `window.location.replace('/')` page-level redirect. The migration
 * preserves that redirect — when marketing removes it, the canonical
 * IIFE + tokenised page below take over without further work. Sentinel
 * test below pins the redirect so a future PR can't quietly expose
 * pricing before launch is approved.
 *
 * Conversion-flow contract preserved byte-identical:
 *   - 5 CTAs target /login.html (nav signin, nav cta, free-tier, final
 *     note, footer signin, footer signup — count ≥ 5 to be tolerant)
 *   - 4 CTAs target https://zalo.me/0000000000 (popular tier, intensive
 *     tier, final CTA, footer support)
 *   - 1 nav link + 1 footer link target /grammar.html
 *   - 2 footer features-section deep links to /#features
 *   - 1 nav link + 1 footer link self-reference /pricing.html
 *   - 1 logo-mark link targets / (home)
 *
 * Monthly / yearly toggle JS contract preserved byte-identical:
 *   - 11 JS-coupled IDs: btn-monthly, btn-yearly, yearly-badge,
 *     yearly-note, price-student, price-student-sub,
 *     price-student-yearly-note, price-intensive, price-intensive-sub,
 *     price-intensive-yearly-note, faq-list
 *   - PRICES const + formatPrice helper + setMonthly/setYearly state
 *     transitions preserved
 *   - FAQ accordion: .faq-trigger, .faq-body.open, .faq-chevron.open
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
  html = readFileSync(path.join(REPO_ROOT, 'frontend/pricing.html'),   'utf8');
  css  = readFileSync(path.join(REPO_ROOT, 'frontend/css/pricing.css'), 'utf8');
});


// ── Pre-launch redirect (page-level hide) ─────────────────────────


describe('pricing.html / pre-launch redirect sentinel', () => {
  test('page-level window.location.replace(\'/\') redirect preserved', () => {
    // Marketing controls the launch timing. The redirect is the
    // mechanism that hides pricing from anonymous visitors. Until
    // marketing approves the launch, this redirect must stay.
    assert.match(
      html,
      /window\.location\.replace\(\s*['"]\/['"]\s*\)/,
      'pricing.html must preserve the pre-launch redirect to / until ' +
      'marketing approves the launch (see DESIGN_SYSTEM.md § 17.4).',
    );
  });

  test('redirect runs in <head>, before the rest of the page', () => {
    const redirectIdx = html.search(/window\.location\.replace\(\s*['"]\/['"]\s*\)/);
    const headEndIdx  = html.indexOf('</head>');
    assert.ok(redirectIdx > -1 && headEndIdx > -1);
    assert.ok(redirectIdx < headEndIdx, 'redirect must run inside <head>');
  });

  test('canonical anti-flash IIFE follows the redirect (idempotent — protects post-launch)', () => {
    // Even though the redirect navigates away today, the IIFE protects
    // against post-launch theme flash once the redirect is removed.
    const redirectIdx = html.search(/window\.location\.replace\(\s*['"]\/['"]\s*\)/);
    const iifeIdx     = html.search(/localStorage\.getItem\(\s*['"]av-theme['"]/);
    assert.ok(redirectIdx > -1 && iifeIdx > -1);
    assert.ok(iifeIdx > redirectIdx, 'IIFE must come after the redirect');
  });
});


// ── Foundation links ──────────────────────────────────────────────


describe('pricing.html / foundation links', () => {
  test('links tokens.css before components.css before pricing.css', () => {
    const tokensIdx     = html.indexOf('aver-design/tokens.css');
    const componentsIdx = html.indexOf('aver-design/components.css');
    const pageIdx       = html.indexOf('css/pricing.css');
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
    assert.match(html, /unpkg\.com\/lucide@[0-9.]+/);
  });

  test('no inline <style> block (all styling lives in pricing.css)', () => {
    const blocks = (html.match(/<style[\s\S]*?<\/style>/g) || []).length;
    assert.equal(blocks, 0);
  });

  test('no Supabase / api.js — anonymous marketing page, no backend coupling', () => {
    assert.ok(!/supabase-js@2/.test(html), 'pricing.html should not load Supabase');
    assert.ok(!/src=["'][^"']*js\/api\.js/.test(html), 'pricing.html should not load api.js');
  });
});


// ── Anti-flash IIFE form ──────────────────────────────────────────


describe('pricing.html / anti-flash IIFE form', () => {
  test('canonical IIFE reads localStorage av-theme + validates', () => {
    assert.match(html, /localStorage\.getItem\(\s*['"]av-theme['"]\s*\)/);
    assert.match(
      html,
      /stored\s*===\s*['"](?:light|dark)['"]\s*\|\|\s*stored\s*===\s*['"](?:light|dark)['"]/,
    );
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

  test('NO Sprint 6.0.1 embedded-mode IIFE (marketing page is not iframe-embedded)', () => {
    assert.ok(!/document\.documentElement\.classList\.add\(\s*['"]embedded-mode['"]\s*\)/.test(html));
  });
});


// ── Conversion flow preserved (the most important contract) ───────


describe('pricing.html / conversion flow preserved byte-identical', () => {
  test('href="/login.html" appears in all expected slots (≥5)', () => {
    // Nav signin + nav CTA + free-tier CTA + final-CTA note link + footer signin + footer signup.
    const count = (html.match(/href=["']\/login\.html["']/g) || []).length;
    assert.ok(count >= 5, `Expected ≥5 /login.html CTAs; found ${count}`);
  });

  test('href="https://zalo.me/0000000000" appears for popular + intensive + final CTA + footer (≥4)', () => {
    // Popular tier CTA + intensive tier CTA + final CTA button + footer support link.
    const count = (html.match(/href=["']https:\/\/zalo\.me\/0000000000["']/g) || []).length;
    assert.ok(count >= 4, `Expected ≥4 zalo.me CTAs; found ${count}`);
  });

  test('href="/grammar.html" appears in nav + footer', () => {
    const count = (html.match(/href=["']\/grammar\.html["']/g) || []).length;
    assert.ok(count >= 2, `Expected ≥2 /grammar.html links (nav + footer); found ${count}`);
  });

  test('href="/#features" deep links preserved (footer)', () => {
    assert.match(html, /href=["']\/#features["']/);
  });

  test('href="/pricing.html" self-reference preserved (nav + footer)', () => {
    const count = (html.match(/href=["']\/pricing\.html["']/g) || []).length;
    assert.ok(count >= 2, `Expected ≥2 /pricing.html self-refs (nav + footer); found ${count}`);
  });

  test('logo-mark link targets / (home)', () => {
    assert.match(html, /<a[^>]+href=["']\/["'][^>]*class=["'][^"']*\bpr-logo\b/);
  });

  test('no CTA destination drift (no /signup or /register URLs)', () => {
    assert.ok(!/href=["']\/signup["']/.test(html));
    assert.ok(!/href=["']\/register["']/.test(html));
  });
});


// ── JS-coupled IDs preserved byte-identical ───────────────────────


describe('pricing.html / 11 JS-coupled IDs preserved byte-identical', () => {
  const REQUIRED_IDS = [
    'btn-monthly',
    'btn-yearly',
    'yearly-badge',
    'yearly-note',
    'price-student',
    'price-student-sub',
    'price-student-yearly-note',
    'price-intensive',
    'price-intensive-sub',
    'price-intensive-yearly-note',
    'faq-list',
  ];

  for (const id of REQUIRED_IDS) {
    test(`#${id} present in markup`, () => {
      assert.match(html, new RegExp(`id=["']${id}["']`), `Missing JS-coupled id="${id}"`);
    });
  }
});


// ── Monthly/yearly toggle state machine preserved ─────────────────


describe('pricing.html / monthly-yearly toggle JS preserved', () => {
  test('PRICES const declared with student + intensive monthly/yearly', () => {
    assert.match(html, /const\s+PRICES\s*=\s*\{[\s\S]*?student\s*:\s*\{\s*monthly\s*:\s*299000\s*,\s*yearly\s*:\s*239200\s*\}/);
    assert.match(html, /intensive\s*:\s*\{\s*monthly\s*:\s*499000\s*,\s*yearly\s*:\s*399200\s*\}/);
  });

  test('formatPrice helper preserved', () => {
    assert.match(html, /function\s+formatPrice\s*\(\s*n\s*\)/);
  });

  test('setMonthly() preserved + toggles pr-toggle__btn--active class', () => {
    assert.match(html, /function\s+setMonthly\s*\(\s*\)/);
    // setMonthly adds --active to btn-monthly, removes from btn-yearly.
    const block = html.match(/function\s+setMonthly\s*\(\s*\)\s*\{[\s\S]*?\n\s*\}/);
    assert.ok(block);
    assert.match(block[0], /btnMonthly\.classList\.add\(\s*['"]pr-toggle__btn--active['"]/);
    assert.match(block[0], /btnYearly\.classList\.remove\(\s*['"]pr-toggle__btn--active['"]/);
  });

  test('setYearly() preserved + toggles pr-toggle__btn--active class', () => {
    assert.match(html, /function\s+setYearly\s*\(\s*\)/);
    const block = html.match(/function\s+setYearly\s*\(\s*\)\s*\{[\s\S]*?\n\s*\}/);
    assert.ok(block);
    assert.match(block[0], /btnYearly\.classList\.add\(\s*['"]pr-toggle__btn--active['"]/);
    assert.match(block[0], /btnMonthly\.classList\.remove\(\s*['"]pr-toggle__btn--active['"]/);
  });

  test('toggle click listeners wired on both buttons', () => {
    assert.match(html, /btnMonthly\.addEventListener\(\s*['"]click['"]\s*,\s*setMonthly\s*\)/);
    assert.match(html, /btnYearly\.addEventListener\(\s*['"]click['"]\s*,\s*setYearly\s*\)/);
  });

  test('Vietnamese sub-labels preserved exact (monthly vs yearly)', () => {
    assert.ok(html.includes('thanh toán hàng tháng'));
    assert.ok(html.includes('quy theo tháng, thanh toán năm'));
  });

  test('default state is monthly (yearly-note + yearly-note-per-tier start hidden)', () => {
    // The HTML markup initializes monthly (yearly note hidden, prices in K format).
    assert.match(html, /id=["']yearly-note["'][^>]*class=["'][^"']*\bhidden\b/);
    assert.match(html, /id=["']price-student-yearly-note["'][^>]*class=["'][^"']*\bhidden\b/);
    assert.match(html, /id=["']price-intensive-yearly-note["'][^>]*class=["'][^"']*\bhidden\b/);
  });
});


// ── FAQ accordion preserved ───────────────────────────────────────


describe('pricing.html / FAQ accordion JS preserved byte-identical', () => {
  test('.faq-trigger click handler wired', () => {
    assert.match(html, /document\.querySelectorAll\(\s*['"]\.faq-trigger['"]\s*\)\.forEach/);
  });

  test('opens .faq-body via .open class + chevron rotates via .open class', () => {
    const block = html.match(/document\.querySelectorAll\(\s*['"]\.faq-trigger['"]\s*\)\.forEach[\s\S]*?\n\s*\}\);\s*\n\s*\}\)/);
    assert.ok(block);
    assert.match(block[0], /body\.classList\.add\(\s*['"]open['"]\s*\)/);
    assert.match(block[0], /chevron\.classList\.add\(\s*['"]open['"]\s*\)/);
  });

  test('accordion closes other open items (single-open behavior)', () => {
    const block = html.match(/document\.querySelectorAll\(\s*['"]\.faq-trigger['"]\s*\)\.forEach[\s\S]*?\n\s*\}\);\s*\n\s*\}\)/);
    assert.ok(block);
    assert.match(block[0], /querySelectorAll\(\s*['"]\.faq-body['"]\s*\)\.forEach[\s\S]*?classList\.remove\(\s*['"]open['"]/);
  });

  test('4 FAQ items present in #faq-list', () => {
    const faqList = html.match(/id=["']faq-list["'][\s\S]*?<\/section>/);
    assert.ok(faqList);
    const items = (faqList[0].match(/class=["'][^"']*\bfaq-item\b/g) || []).length;
    assert.equal(items, 4, `Expected 4 FAQ items, found ${items}`);
  });
});


// ── Body class + chrome ───────────────────────────────────────────


describe('pricing.html / body class + chrome', () => {
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

  test('brand wordmark preserved (averlearning) — nav + footer', () => {
    const count = (html.match(/averlearning/g) || []).length;
    assert.ok(count >= 2, `Expected ≥2 'averlearning' wordmark mentions; found ${count}`);
  });
});


// ── No inline color literals in static markup ─────────────────────


describe('pricing.html / no inline color literals in static markup', () => {
  test('no inline style="color:#…" or "background:#…" on static markup', () => {
    const stripped = html.replace(/<script[\s\S]*?<\/script>/g, '');
    const bad = stripped.match(/style=["'][^"']*(?:color|background)\s*:\s*#[0-9a-fA-F]/g) || [];
    assert.deepEqual(bad, []);
  });

  test('no Era B hex literals (#1B3A5C / #0D7377) leak into runtime markup', () => {
    // Strip CSS comments before scanning so the migration-explanation
    // docstring at the top of pricing.css (which cites Era B hex codes
    // as historical context) doesn't trigger a false hit.
    const cssRuntime = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const h of ['#1B3A5C', '#0D7377', '#162F4A', '#1FA4A7']) {
      assert.ok(!html.includes(h),       `pricing.html should not contain Era B ${h}`);
      assert.ok(!cssRuntime.includes(h), `pricing.css runtime (non-comment) should not contain Era B ${h}`);
    }
  });

  test('no Tailwind `navy` / `teal` custom-palette config in <script> block', () => {
    assert.ok(!/colors:\s*\{[\s\S]*?navy:/.test(html), 'Tailwind navy palette must be removed');
    assert.ok(!/colors:\s*\{[\s\S]*?teal:/.test(html), 'Tailwind teal palette must be removed');
  });
});


// ── pricing.css token discipline ──────────────────────────────────


describe('pricing.css / token discipline', () => {
  test('uses --av-* tokens (no --ds-* tokens)', () => {
    const av = (css.match(/var\(--av-/g) || []).length;
    const ds = (css.match(/var\(--ds-/g) || []).length;
    assert.ok(av > 80, `Expected many --av-* refs, got ${av}`);
    assert.equal(ds, 0, 'Legacy --ds-* tokens must be migrated');
  });

  test('no hardcoded `color: #...` runtime declarations (final CTA + footer whitelist OK)', () => {
    // The final CTA + footer are "always-dark" by design (marketing
    // atmosphere). They use literal #FFFFFF + rgba(255,…) values
    // because the surface is dark in both themes. Allow only #FFFFFF.
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const hexColors = stripped.match(/^\s*color:\s*#[0-9a-fA-F]{3,6};/gm) || [];
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
      /\.pr-nav-cta[\s\S]{0,400}--av-text-on-primary/,
      'Nav CTA missing --av-text-on-primary text color',
    );
  });

  test('popular tier CTA + ribbon also route through --av-text-on-primary', () => {
    // The "Học viên" (popular) tier sits on a primary-gradient
    // background — its text must use the inverse-on-brand token.
    assert.match(css, /--av-text-on-primary/);
    const ribbonBlock = css.match(/\.pr-tier-card__ribbon\s*\{[^}]*\}/);
    assert.ok(ribbonBlock);
    assert.match(ribbonBlock[0], /--av-text-on-primary/);
  });

  test('all key component class blocks defined', () => {
    for (const sel of [
      '.pr-nav', '.pr-nav-link', '.pr-nav-cta',
      '.pr-hero', '.pr-hero__title', '.pr-hero__lead',
      '.pr-toggle', '.pr-toggle__btn', '.pr-toggle__btn--active', '.pr-toggle__badge',
      '.pr-section', '.pr-section-sunken',
      '.pr-tier-card', '.pr-tier-card--popular', '.pr-tier-card--intensive',
      '.pr-tier-card__name', '.pr-tier-card__amount', '.pr-tier-card__ribbon',
      '.pr-tier-card__cta', '.pr-tier-card__cta--popular',
      '.pr-table-wrap', '.pr-table', '.pr-table__row', '.pr-table__feat-name',
      '.pr-mobile-tier', '.pr-mobile-tier--popular', '.pr-mobile-tier--intensive',
      '.pr-faq-item', '.pr-faq-trigger', '.pr-faq-chevron', '.pr-faq-body',
      '.pr-cta-final', '.pr-cta-final__btn',
      '.pr-footer', '.pr-footer__link',
    ]) {
      assert.match(css, new RegExp(sel.replace(/[.\-]/g, m => '\\' + m)), `Missing rule for ${sel}`);
    }
  });

  test('tier amounts use mono font (numeric content)', () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const escaped = '.pr-tier-card__amount'.replace(/[.\-]/g, m => '\\' + m);
    const block = stripped.match(new RegExp('^' + escaped + '[^{]*\\{[^}]*\\}', 'm'));
    assert.ok(block, '.pr-tier-card__amount block missing');
    assert.match(block[0], /--av-font-mono/, '.pr-tier-card__amount must use --av-font-mono');
  });

  test('FAQ body opens via .open class transition', () => {
    // The JS adds `.open` to .faq-body — CSS must define the open state
    // (max-height transition is the canonical pattern).
    assert.match(css, /\.pr-faq-body\.open[\s\S]{0,200}max-height/);
  });

  test('FAQ chevron rotates via .open class transition', () => {
    assert.match(css, /\.pr-faq-chevron\.open[\s\S]{0,200}rotate/);
  });

  test('focus-visible affordance defined on final CTA button', () => {
    assert.match(css, /\.pr-cta-final__btn:focus-visible[\s\S]{0,200}--av-shadow-focus/);
  });
});


// ── Vietnamese marketing microcopy preserved exactly ──────────────


describe('pricing.html / Vietnamese marketing microcopy preserved exactly', () => {
  const phrases = [
    'Bảng giá — averlearning',                            // <title>
    'Không cần thẻ tín dụng · Hoàn tiền trong 7 ngày đầu', // hero eyebrow (B8/Mục 38: was "Huỷ bất kỳ lúc nào" — no auto-renew subscription)
    'Chọn gói phù hợp',                                    // hero h1 line 1
    'với bạn',                                             // hero h1 line 2
    'Chọn gói phù hợp với mục tiêu của bạn.',              // hero lead (B8/Mục 39: was "Bắt đầu miễn phí, nâng cấp khi cần" — not self-serve)
    'AI feedback ngay sau mỗi câu trả lời',                // hero lead tail
    'Hàng tháng',                                          // toggle
    'Hàng năm',                                            // toggle
    'Tiết kiệm tới',                                       // yearly savings note
    '1.194.000đ',                                          // yearly savings amount (Vietnamese formatting)
    'Miễn phí',                                            // tier 1 name
    'Học viên',                                            // tier 2 name (popular)
    'Intensive',                                           // tier 3 name
    'Phổ biến nhất',                                       // popular ribbon
    'Luyện thi cấp tốc',                                   // intensive ribbon
    '3 buổi/ngày',                                         // free tier feat
    'tối đa ~90 buổi/tháng',                               // free tier feat
    'Không giới hạn',                                      // popular tier feat
    'AI feedback',                                         // shared feat
    'Chấm điểm phát âm chi tiết',                          // feat
    'Grammar Wiki',                                        // feat
    'Full Test mode',                                      // feat
    'Lịch sử',                                             // feat
    '7 ngày',                                              // free tier history
    'Xuất báo cáo PDF',                                    // feat
    'Bắt đầu miễn phí',                                    // free tier CTA
    'Mua ngay — nhắn Zalo',                                // popular tier CTA
    'Liên hệ tư vấn',                                      // intensive tier CTA
    'Nhận access code sau khi xác nhận thanh toán',        // CTA note
    'So sánh tính năng',                                   // comparison h2
    'Tính năng',                                           // table col header
    'Buổi luyện/tháng',                                    // table row
    'Hỗ trợ ưu tiên',                                      // table row
    'Câu hỏi thường gặp',                                  // FAQ h2
    'Thanh toán như thế nào?',                             // FAQ Q1
    'Access code là gì?',                                  // FAQ Q2
    'Có hoàn tiền nếu không hài lòng không?',              // FAQ Q3
    'Gói Miễn phí có giới hạn thời gian không?',           // FAQ Q4
    'access code',                                         // FAQ A2 body
    'IELTS-XXXX-XXXX',                                     // FAQ A2 code
    'vòng 7 ngày đầu',                                     // FAQ A3 body
    'mãi mãi',                                             // FAQ A4 body + free tier period
    'Vẫn còn thắc mắc?',                                   // final CTA h2
    'Nhắn Zalo — chúng mình trả lời',                      // final CTA lead
    'Nhắn Zalo ngay',                                      // final CTA button
    'đăng ký tại đây',                                     // final CTA note link
    'Đăng nhập',                                           // nav + footer
    'Đăng ký',                                             // footer
    'Dùng thử miễn phí',                                   // nav CTA
    'Bảng giá',                                            // nav + footer
    'Nền tảng luyện IELTS Speaking với AI',                // footer tagline
    'Powered by Claude AI · Whisper STT · Azure Pronunciation', // footer
  ];

  for (const phrase of phrases) {
    test(`microcopy preserved: "${phrase.slice(0, 36)}…"`, () => {
      assert.ok(html.includes(phrase), `Missing exact Vietnamese phrase: ${phrase}`);
    });
  }
});


// ── Tier card structural contract ─────────────────────────────────


describe('pricing.html / 3 tier cards structural contract', () => {
  test('exactly 3 .pr-tier-card root elements', () => {
    // Only the root tier cards; the table cells / mobile-tier sections
    // use different class names so this count is unambiguous.
    const count = (html.match(/class=["'][^"']*\bpr-tier-card\b(?![-_])/g) || []).length;
    assert.equal(count, 3, `Expected 3 .pr-tier-card root elements, found ${count}`);
  });

  test('popular variant present (Học viên)', () => {
    assert.match(html, /class=["'][^"']*\bpr-tier-card--popular\b/);
  });

  test('intensive variant present (Intensive)', () => {
    assert.match(html, /class=["'][^"']*\bpr-tier-card--intensive\b/);
  });

  test('tier prices preserved byte-identical (0đ / 299K / 499K)', () => {
    // Free tier: amount "0" inside .pr-tier-card__amount span
    assert.match(html, /class=["'][^"']*\bpr-tier-card__amount\b[^"']*["'][^>]*>\s*0\s*</);
    // Free tier: unit "đ" inside .pr-tier-card__unit
    assert.match(html, /class=["'][^"']*\bpr-tier-card__unit\b[^"']*["'][^>]*>\s*đ\s*</);
    // Student tier: id=price-student with text 299K
    assert.match(html, /id=["']price-student["'][^>]*>\s*299K\s*</);
    // Intensive tier: id=price-intensive with text 499K
    assert.match(html, /id=["']price-intensive["'][^>]*>\s*499K\s*</);
  });
});


// ── Comparison table structural contract ──────────────────────────


describe('pricing.html / comparison table structural contract', () => {
  test('desktop .pr-table-wrap present (hidden on mobile via Tailwind)', () => {
    assert.match(html, /class=["'][^"']*\bpr-table-wrap\b[^"']*\bhidden\b[^"']*\bmd:block\b/);
  });

  test('3 mobile .pr-mobile-tier cards present (md:hidden)', () => {
    const count = (html.match(/class=["'][^"']*\bpr-mobile-tier\b(?![-_])/g) || []).length;
    assert.equal(count, 3, `Expected 3 .pr-mobile-tier cards, found ${count}`);
  });

  test('table has 8 feature rows (Sessions, Feedback, Full Test, Pronunciation, Grammar, PDF, History, Support)', () => {
    const tableWrap = html.match(/class=["'][^"']*\bpr-table-wrap\b[\s\S]*?<\/table>/);
    assert.ok(tableWrap);
    const rows = (tableWrap[0].match(/class=["'][^"']*\bpr-table__row\b/g) || []).length;
    assert.equal(rows, 8, `Expected 8 table rows, found ${rows}`);
  });
});
