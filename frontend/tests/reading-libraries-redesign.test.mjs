/**
 * Reading library redesign — shared hierarchy and interaction contracts.
 * The four legacy pages and their Next shells intentionally share one CSS and
 * one controller per library; these sentinels keep the redesign coherent.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...rel) => readFileSync(join(__dirname, '..', ...rel), 'utf8');

const PAGE_NAMES = ['reading-vocab', 'reading-skill', 'reading-test', 'reading-mini-test'];
const PAGES = PAGE_NAMES.map((name) => read('pages', `${name}.html`));
const CONTROLLERS = PAGE_NAMES.map((name) => read('js', `${name}.js`));
const ROUTES = ['/reading/vocab', '/reading/skill', '/reading/test', '/reading/mini-test'];
const ACTIVE_LABELS = ['Vocab Reading', 'Skill Practice', 'Full Tests', 'Mini Tests'];
const NEXT_SHELLS = ['vocab', 'skill', 'test', 'mini-test'].map((name) =>
  read('app', '(authed-reading)', 'reading', name, 'page-shell.tsx'));
const READING_VOCAB_BEHAVIOR = read(
  'app', '(authed-reading)', 'reading', 'vocab', 'reading-vocab-behavior.tsx');
const READING_SKILL_BEHAVIOR = read(
  'app', '(authed-reading)', 'reading', 'skill', 'reading-skill-behavior.tsx');
const NEXT_BEHAVIORS = [READING_VOCAB_BEHAVIOR, READING_SKILL_BEHAVIOR, '', ''];
const NEXT_SURFACES = NEXT_SHELLS.map((shell, index) =>
  `${shell}\n${NEXT_BEHAVIORS[index]}`);
const CSS = read('css', 'reading-vocab.css');

describe('Reading libraries — shared information hierarchy', () => {
  it('gives every library a summary hero, result toolbar, and clear-filter action', () => {
    for (const [index, html] of PAGES.entries()) {
      assert.match(html, /class="rv-header rv-header--/,
        `${PAGE_NAMES[index]} missing redesigned hero`);
      assert.match(html, /class="rv-header__stats"/,
        `${PAGE_NAMES[index]} missing truthful summary facts`);
      assert.match(html, /id="rv-total-count"/,
        `${PAGE_NAMES[index]} missing live item count`);
      assert.match(html, /class="rv-library__toolbar"/,
        `${PAGE_NAMES[index]} missing library toolbar`);
      assert.match(html, /id="rv-result-count"[^>]*aria-live="polite"/,
        `${PAGE_NAMES[index]} missing accessible result count`);
      assert.match(html, /id="clear-filters"[^>]*hidden/,
        `${PAGE_NAMES[index]} missing clear-filter action`);
    }
  });

  it('keeps all four canonical Reading routes in every switcher', () => {
    for (const [pageIndex, html] of PAGES.entries()) {
      assert.match(html, new RegExp(`is-active" aria-current="page">${ACTIVE_LABELS[pageIndex]}</a>`));
      for (const [routeIndex, path] of ROUTES.entries()) {
        if (routeIndex !== pageIndex) assert.ok(html.includes(`href="${path}"`));
      }
    }
  });

  it('keeps the Next shells aligned with the legacy DOM hooks', () => {
    for (const [index, surface] of NEXT_SURFACES.entries()) {
      assert.match(surface, /className="rv-header rv-header--/);
      assert.match(surface, /id="rv-total-count"/);
      assert.match(surface, /id="rv-result-count"/);
      assert.match(surface, /id="clear-filters"/);
      assert.match(surface, new RegExp(`is-active" aria-current="page">${ACTIVE_LABELS[index]}</a>`));
    }
  });
});

describe('Reading libraries — card and filter behavior', () => {
  it('renders explicit card CTAs and live summary text in every controller', () => {
    for (const [index, js] of CONTROLLERS.entries()) {
      assert.match(js, /rv-card__cta/,
        `${PAGE_NAMES[index]} missing visible card action`);
      assert.match(js, /rv-result-count/,
        `${PAGE_NAMES[index]} missing result-count wiring`);
      assert.match(js, /clear-filters/,
        `${PAGE_NAMES[index]} missing reset wiring`);
      assert.match(js, /setAttribute\('aria-label'/,
        `${PAGE_NAMES[index]} missing descriptive card label`);
      assert.match(js, /revealActiveLibraryTab/,
        `${PAGE_NAMES[index]} does not reveal its active mobile tab`);
    }
  });

  it('does not invent full-test defaults for mini tests', () => {
    const mini = CONTROLLERS[3];
    assert.match(mini, /passage_count \|\| 1/);
    assert.match(mini, /total_questions \|\| '—'/);
    assert.match(mini, /time_limit_minutes \|\| '—'/);
  });

  it('uses the API exact total and distinguishes it from the rendered page', () => {
    for (const [index, js] of CONTROLLERS.entries()) {
      assert.match(js, /renderSummary\(res\)/,
        `${PAGE_NAMES[index]} does not pass the canonical response to its summary`);
      assert.match(js, /typeof res\?\.total === 'number'/,
        `${PAGE_NAMES[index]} does not prefer the API exact total`);
      assert.match(js, /total > shown[\s\S]*đang hiển thị/,
        `${PAGE_NAMES[index]} does not distinguish total matches from rendered cards`);
    }
  });
});

describe('Reading libraries — responsive and accessible styling', () => {
  it('provides touch targets, mobile horizontal tabs, and reduced motion', () => {
    assert.match(CSS, /\.rv-filters select[\s\S]*min-height: 44px/);
    assert.match(CSS, /\.rv-libnav[\s\S]*overflow-x: auto/);
    assert.match(CSS, /scroll-snap-type: x proximity/);
    assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
  });
});
