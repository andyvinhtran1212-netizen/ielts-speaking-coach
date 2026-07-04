/**
 * Sprint Perf-3 — shared chrome preconnect/dns-prefetch sentinels.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...rel) => readFileSync(join(__dirname, '..', ...rel), 'utf8');

const PERF_HINTS = read('js', 'components', 'perf-hints.js');
const CHROME = read('js', 'components', 'aver-chrome.js');
const ADMIN_CHROME = read('js', 'components', 'aver-admin-chrome.js');
const COMPONENTS_CSS = read('css', 'aver-design', 'components.css');


describe('Sprint Perf-3 — shared chrome resource hints', () => {
  it('declares the 3 warmed production origins', () => {
    for (const origin of [
      'https://ielts-speaking-coach-production.up.railway.app',
      'https://huwsmtubwulikhlmcirx.supabase.co',
      'https://res.cloudinary.com',
    ]) {
      assert.match(PERF_HINTS, new RegExp(origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  it('installs both preconnect and dns-prefetch hints', () => {
    assert.match(PERF_HINTS, /appendHint\(['"]preconnect['"]/);
    assert.match(PERF_HINTS, /appendHint\(['"]dns-prefetch['"]/);
    assert.match(PERF_HINTS, /crossOrigin\s*=/);
  });

  it('skips preconnect work for Save-Data users', () => {
    assert.match(PERF_HINTS, /navigator\.connection[\s\S]{0,80}\.saveData/);
    assert.match(PERF_HINTS, /if\s*\([^)]+saveData\)\s*return/);
  });

  it('dedupes repeated installs across page modules', () => {
    assert.match(PERF_HINTS, /querySelector\(`link\[rel="\$\{rel\}"\]\[href="\$\{href\}"\]`\)/);
  });

  it('student and admin chrome both install the shared hints', () => {
    assert.match(CHROME, /import\s+\{\s*installPerfResourceHints\s*\}/);
    assert.match(CHROME, /installPerfResourceHints\(\)/);
    assert.match(ADMIN_CHROME, /import\s+\{\s*installPerfResourceHints\s*\}/);
    assert.match(ADMIN_CHROME, /installPerfResourceHints\(\)/);
  });
});


// P0-3 CLS — <aver-chrome> is upgraded by a deferred module, so it must
// reserve its footprint in LIGHT DOM (components.css) or the host goes
// 0 -> full height on upgrade and shoves <div class="shell"> (the whole
// page) down. The :host{display:block} inside the shadow is too late.
describe('P0-3 CLS — aver-chrome reserves height in light DOM', () => {
  it('components.css gives the aver-chrome host display:block + a min-height', () => {
    // Match the base light-DOM rule: `aver-chrome { … }` (not the @media override).
    const m = COMPONENTS_CSS.match(/(?:^|\n)\s*aver-chrome\s*\{([^}]*)\}/);
    assert.ok(m, 'components.css must declare a light-DOM `aver-chrome { … }` reserve rule');
    assert.match(m[1], /display:\s*block/, 'host must be display:block or min-height is ignored pre-upgrade');
    const minH = m[1].match(/min-height:\s*(\d+)px/);
    assert.ok(minH, 'host must declare a min-height to reserve the chrome footprint (CLS guard)');
    assert.ok(
      Number(minH[1]) >= 120,
      `min-height must reserve the real chrome footprint (>=120px; got ${minH[1]}px)`,
    );
  });

  it('reserves the taller footprint below the nav-wrap breakpoint', () => {
    assert.match(
      COMPONENTS_CSS,
      /@media\s*\(max-width:\s*1023px\)\s*\{\s*aver-chrome\s*\{[^}]*min-height:\s*\d+px/,
      'a max-width:1023px override must reserve the taller (wrapped-nav) footprint',
    );
  });
});


// ── Perf P2.3 — Speculation Rules PREFETCH for main nav dashboards ───────────
describe('Perf P2.3 — aver-chrome injects prefetch speculation rules', () => {
  it('injects a speculationrules script, feature-detected + deduped', () => {
    assert.match(CHROME, /_injectSpeculationRules\(\)/, 'method is called from connectedCallback');
    assert.match(CHROME, /HTMLScriptElement\.supports\('speculationrules'\)/, 'feature-detected');
    assert.match(CHROME, /script\[type="speculationrules"\]\[data-aver-speculation\]/, 'deduped by marker attr');
    assert.match(CHROME, /type = 'speculationrules'/);
  });

  it('uses PREFETCH, not prerender (Codex #653: prerender executes page scripts → analytics beacons + /auth/me side effects on hover)', () => {
    assert.match(CHROME, /prefetch:\s*\[\{/, 'must use the non-executing prefetch hint');
    assert.doesNotMatch(CHROME, /prerender:\s*\[\{/, 'must NOT prerender (would run beacons/auth on speculation)');
  });

  it('uses moderate eagerness (hover intent, not on-load fan-out)', () => {
    assert.match(CHROME, /eagerness:\s*'moderate'/);
  });

  it('allowlists ONLY read-only dashboards — never stateful/admin pages', () => {
    for (const href of [
      '/pages/home.html', '/pages/speaking.html', '/pages/writing-dashboard.html',
      '/pages/listening.html', '/pages/reading-vocab.html', '/grammar.html', '/vocabulary.html',
    ]) {
      assert.match(CHROME, new RegExp(`href_matches: '${href.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}'`),
        `${href} must be in the prerender allowlist`);
    }
    // stateful / privileged pages must NOT be prerender targets
    assert.doesNotMatch(CHROME, /href_matches: '\/pages\/practice\.html'/);
    assert.doesNotMatch(CHROME, /href_matches: '\/pages\/admin/);
  });

  it('fails safe — the whole injection is try/caught so it never breaks chrome', () => {
    assert.match(CHROME, /_injectSpeculationRules\(\)\s*\{\s*try\s*\{/);
  });
});
