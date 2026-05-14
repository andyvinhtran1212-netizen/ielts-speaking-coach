/**
 * frontend/tests/profile-redesign.test.mjs — Sprint 6.12a
 * (Phase 3 final cluster, page 1 of 2).
 *
 * Run with: node --test frontend/tests/profile-redesign.test.mjs
 *
 * Pins the Sprint 6.12a surgical migration of /pages/profile.html
 * (standalone profile route — NOT iframe-embedded, so no Sprint 6.0.1
 * IIFE). All JS-coupled selectors preserved byte-identical so the
 * inline IIFE at the bottom of the page continues to drive auth +
 * GET /auth/profile + PATCH /auth/profile + the BANDS render loop +
 * level-card toggling + slider sync + toast UX:
 *
 *   - 21 element IDs (header-avatar, header-initials, profile-avatar,
 *     profile-initials, profile-avatar-img, profile-display-name,
 *     profile-email, profile-joined, stat-sessions, stat-avg-band,
 *     stat-weekly, profile-form, inp-display-name, inp-email,
 *     inp-exam-date, inp-weekly-goal, band-btns, level-options,
 *     goal-display, btn-save, toast)
 *   - 4 .level-card[data-level] values (beginner/intermediate/
 *     upper_intermediate/advanced)
 *   - onclick="saveProfile()" + window.saveProfile global
 *   - BANDS = [4.0…8.0] in 0.5 steps
 *
 * Production reality diverges from the spec ZIP — the page has NO
 * tabs, NO Chart.js, NO password-change/sign-out/access-code forms.
 * It's a single linear form: identity card + 3 stat cards +
 * learning-goals form. This suite pins production, not the ZIP.
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
  html = readFileSync(path.join(REPO_ROOT, 'frontend/pages/profile.html'), 'utf8');
  css  = readFileSync(path.join(REPO_ROOT, 'frontend/css/profile.css'),    'utf8');
});


// ── Foundation links ──────────────────────────────────────────────


describe('profile.html / foundation links', () => {
  test('links tokens.css before components.css before profile.css', () => {
    const tokensIdx     = html.indexOf('aver-design/tokens.css');
    const componentsIdx = html.indexOf('aver-design/components.css');
    const pageIdx       = html.indexOf('css/profile.css');
    assert.ok(tokensIdx > -1 && componentsIdx > -1 && pageIdx > -1);
    assert.ok(tokensIdx < componentsIdx);
    assert.ok(componentsIdx < pageIdx);
  });

  test('still links ds.css for iframe-parent compatibility', () => {
    assert.match(html, /css\/ds\.css/);
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

  test('no external profile.js (logic lives inline at bottom of page)', () => {
    assert.ok(!/src=["'][^"']*js\/profile\.js/.test(html));
  });
});


// ── Anti-flash IIFE order ─────────────────────────────────────────


describe('profile.html / anti-flash IIFE runs before stylesheets', () => {
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

  test('NO Sprint 6.0.1 embedded-mode IIFE (profile is not iframe-embedded)', () => {
    // Unlike my-vocabulary / flashcards / exercises which are mounted
    // as tab iframes under vocabulary.html, profile.html is opened as
    // a standalone route from home.html → user-pill. Pinning the
    // absence of the embedded-mode IIFE prevents a future contributor
    // from accidentally adding it (which would tie this page into the
    // embedded-mode.test.js fixture lockstep).
    assert.ok(!/document\.documentElement\.classList\.add\(\s*['"]embedded-mode['"]\s*\)/.test(html));
  });
});


// ── JS-coupled selectors preserved (the inline IIFE drives all of these) ──


describe('profile.html / JS-coupled selectors preserved byte-identical', () => {
  // Sprint 6.17 chrome unification: 'header-avatar' wrapper removed.
  // Sprint 7.13: 'header-initials' span retired — chrome moved into
  // <aver-chrome> shadow root; profile.html now delegates avatar
  // population via document.querySelector('aver-chrome').setUser({ initials }).
  const requiredIds = [
    'profile-avatar', 'profile-initials', 'profile-avatar-img',
    'profile-display-name', 'profile-email', 'profile-joined',
    'stat-sessions', 'stat-avg-band', 'stat-weekly',
    'profile-form',
    'inp-display-name', 'inp-email', 'inp-exam-date', 'inp-weekly-goal',
    'band-btns', 'level-options', 'goal-display',
    'btn-save', 'toast',
  ];

  for (const id of requiredIds) {
    test(`id="${id}" preserved`, () => {
      assert.match(html, new RegExp(`id=["']${id}["']`));
    });
  }

  test('4 level-card[data-level] options preserved', () => {
    for (const v of ['beginner', 'intermediate', 'upper_intermediate', 'advanced']) {
      assert.match(html, new RegExp(`data-level=["']${v}["']`));
    }
  });

  test('saveProfile() onclick handler + window.saveProfile global preserved', () => {
    assert.match(html, /onclick=["']saveProfile\(\)["']/);
    assert.match(html, /window\.saveProfile\s*=\s*async\s*function/);
  });

  test('BANDS array preserved (4.0–8.0 in 0.5 steps)', () => {
    assert.match(html, /BANDS\s*=\s*\[\s*4\.0\s*,\s*4\.5\s*,\s*5\.0\s*,\s*5\.5\s*,\s*6\.0\s*,\s*6\.5\s*,\s*7\.0\s*,\s*7\.5\s*,\s*8\.0\s*\]/);
  });

  test('GET /auth/profile + PATCH /auth/profile + GET /auth/me fallback preserved', () => {
    assert.match(html, /api\.get\(['"]\/auth\/profile['"]\)/);
    assert.match(html, /api\.patch\(['"]\/auth\/profile['"]/);
    assert.match(html, /api\.get\(['"]\/auth\/me['"]\)/);
  });

  test('Supabase init order preserved (initSupabase before page JS)', () => {
    const initIdx = html.indexOf('initSupabase(');
    const iifeIdx = html.indexOf('window.saveProfile');
    assert.ok(initIdx > -1 && iifeIdx > -1);
    assert.ok(initIdx < iifeIdx);
  });
});


// ── Body class + chrome ───────────────────────────────────────────


describe('profile.html / body class + chrome', () => {
  test('body uses av-page (no ds-canvas, no text-slate-100)', () => {
    assert.match(html, /<body[^>]*class=["'][^"']*\bav-page\b/);
    assert.ok(!/<body[^>]*class=["'][^"']*\bds-canvas\b/.test(html));
    assert.ok(!/<body[^>]*class=["'][^"']*\btext-slate-100\b/.test(html));
  });

  test('Sprint 7.13 — chrome migrated to <aver-chrome active="home">', () => {
    // profile.html ships <aver-chrome active="home"> — profile is not in
    // the 5-skill enum, so it highlights the home tab as the IA parent.
    assert.match(html, /<aver-chrome\s+active="home"\s*>/);
    assert.match(
      html,
      /<script\s+type="module"\s+src="\/js\/components\/aver-chrome\.js">\s*<\/script>/,
    );
  });

  test('Sprint 7.13 — inline chrome retired (.av-theme-toggle / bindToggleButton / .topnav not in page DOM)', () => {
    assert.equal(/class=["'][^"']*\bav-theme-toggle\b/.test(html), false);
    assert.equal(
      /import\s+\{\s*bindToggleButton\s*\}\s+from\s+['"]\/js\/theme-toggle\.js['"]/.test(html),
      false,
    );
    assert.equal(/class=["']topnav["']/.test(html), false);
    assert.equal(/\bid=["']user-menu-logout["']/.test(html), false);
  });

  test('lucide hydration still runs for body-content icons', () => {
    assert.match(html, /lucide\.createIcons/);
  });
});


// ── No inline <style> block ───────────────────────────────────────


describe('profile.html / no inline <style> block (all styling in profile.css)', () => {
  test('zero <style> blocks remain', () => {
    const blocks = (html.match(/<style[\s\S]*?<\/style>/g) || []).length;
    assert.equal(blocks, 0, 'inline <style> block should be migrated to profile.css');
  });

  test('no inline style="color:#…" or "background:#…" on static markup', () => {
    const stripped = html.replace(/<script[\s\S]*?<\/script>/g, '');
    const bad = stripped.match(/style=["'][^"']*(?:color|background)\s*:\s*#[0-9a-fA-F]/g) || [];
    assert.deepEqual(bad, []);
  });

  test('no rgba(255,255,255,…) literals in static markup', () => {
    const stripped = html.replace(/<script[\s\S]*?<\/script>/g, '');
    const bad = stripped.match(/rgba\(\s*255\s*,\s*255\s*,\s*255/g) || [];
    assert.deepEqual(bad, []);
  });

  test('no hardcoded #081829 / #112d52 / #14b8a6 / #0D7377 / #0F766E in static markup', () => {
    const stripped = html.replace(/<script[\s\S]*?<\/script>/g, '');
    const hexes = ['#081829', '#112d52', '#14b8a6', '#0D7377', '#0F766E'];
    for (const h of hexes) {
      assert.ok(!stripped.includes(h), `static markup still contains hardcoded ${h}`);
    }
  });
});


// ── profile.css token discipline ──────────────────────────────────


describe('profile.css / token discipline', () => {
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

  test('no background: hardcoded hex (allow rgba via tokens only)', () => {
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

  test('btn-save CTA routes through --av-text-on-primary (Sprint 6.7.1)', () => {
    assert.match(
      css,
      /\.btn-save[\s\S]{0,400}--av-text-on-primary/,
      'Primary CTA missing --av-text-on-primary text color',
    );
  });

  test('all key component class blocks defined', () => {
    for (const sel of ['.card', '.field-label', '.field-input',
                       '.band-btn', '.level-card', '.goal-slider',
                       '.stat-card', '.btn-save', '.pf-toast',
                       '.pf-header', '.pf-avatar']) {
      assert.match(css, new RegExp(sel.replace(/[.\-]/g, m => '\\' + m)), `Missing rule for ${sel}`);
    }
  });

  test('numeric values use mono font (band-btn + stat value + goal value)', () => {
    // The band-btn (e.g., "6.5"), the stat value (e.g., "12"), and the
    // goal-display number all benefit from tnum tabular alignment.
    // Strip comments first so the docstring's `.band-btn` mention is
    // not picked up by the regex.
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const sel of ['.band-btn', '.stat-card__value', '.pf-goal__value']) {
      const escaped = sel.replace(/[.\-]/g, m => '\\' + m);
      const block = stripped.match(new RegExp('^' + escaped + '\\s*\\{[^}]*\\}', 'm'));
      assert.ok(block, `${sel} block missing`);
      assert.match(block[0], /--av-font-mono/, `${sel} must use --av-font-mono`);
    }
  });

  test('focus-visible affordance defined on field-input + btn-save', () => {
    assert.match(css, /\.field-input:focus[\s\S]{0,200}--av-shadow-focus|\.field-input:focus[\s\S]{0,200}box-shadow/);
    assert.match(css, /\.btn-save:focus-visible[\s\S]{0,200}--av-shadow-focus/);
  });
});


// ── Toast contract preserved ──────────────────────────────────────


describe('profile.html / toast contract preserved', () => {
  test('toast element has both #toast id AND a class hook (pf-toast)', () => {
    // The inline IIFE uses #toast.classList.add('show'). Pin both that
    // the id is preserved (event wiring binds) and that the class hook
    // moved to pf-toast (so the styling lives in profile.css instead of
    // inline-style assignments to t.style.background).
    assert.match(html, /id=["']toast["'][^>]*class=["'][^"']*\bpf-toast\b/);
  });

  test('inline IIFE no longer assigns t.style.background for error variant', () => {
    // Sprint 6.12a removed the legacy `t.style.background = isError ? '#dc2626' : '#0D7377'`
    // in favor of toggling .pf-toast--error class.
    assert.ok(
      !/t\.style\.background\s*=\s*isError/.test(html),
      'inline error coloring should be moved to .pf-toast--error class',
    );
    assert.match(html, /classList\.toggle\(\s*['"]pf-toast--error['"]/);
  });

  test('pf-toast--error rule defined in profile.css', () => {
    assert.match(css, /\.pf-toast--error/);
    assert.match(css, /\.pf-toast--error[\s\S]{0,200}--av-error/);
  });
});
