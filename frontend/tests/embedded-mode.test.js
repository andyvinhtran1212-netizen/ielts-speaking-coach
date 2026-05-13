/**
 * frontend/tests/embedded-mode.test.js — Sprint 6.0.1 hotfix.
 *
 * Run with: node --test frontend/tests/embedded-mode.test.js
 *
 * The detection script is a tiny IIFE inlined in <head> of each
 * iframe-mounted page. Originally my-vocabulary / flashcards /
 * exercises (all three byte-identical). Sprint 7.3 (DEBT-2026-05-09-B
 * Phase 1) retired the IIFE from my-vocabulary.html when that page
 * migrated to an ES-module mount. Until Sprint 7.4 + 7.5 migrate the
 * remaining two, the IIFE still ships on flashcards.html +
 * exercises.html. We extract the canonical form from one of the
 * two surviving pages and run it inside a vm sandbox where we can
 * fake `window.location.search`.
 *
 * What's pinned:
 *   - `?embedded=1` → adds `embedded-mode` class to <html>
 *   - empty search → no class added
 *   - `?embedded=0` → no class (only literal "1" triggers)
 *   - `?embedded=true` → no class (defensive — keep matcher strict)
 *   - `?other=foo&embedded=1` → still triggers (real-world URL params)
 *
 * Why a strict-equals match instead of "truthy"? A future page might
 * carry `?embedded=preview` for some other meaning; loose matching
 * would silently fold preview into the iframe-suppression branch.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');


// ── Extract the IIFE from one of the pages ─────────────────────────


function _extractDetectionScript() {
  // Sprint 7.3 — extraction source moved from my-vocabulary.html
  // (now a thin shell) to flashcards.html, which still carries the
  // Sprint 6.0.1 IIFE byte-identical. Sprint 7.4 will retire it from
  // flashcards; this extraction source then moves to exercises.html.
  // Sprint 7.6 retires the IIFE entirely and this file can be deleted.
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'pages', 'flashcards.html'),
    'utf8',
  );
  const m = html.match(
    /<!-- Sprint 6\.0\.1[\s\S]*?<script>([\s\S]*?)<\/script>/,
  );
  assert.ok(
    m,
    'embedded-mode IIFE not found in flashcards.html — did the ' +
    'Sprint 6.0.1 marker comment move? Update the regex above.',
  );
  return m[1].trim();
}


function _runDetectionWith(search) {
  const script = _extractDetectionScript();
  const html = {
    classList: {
      _set: new Set(),
      add(...cs) { cs.forEach(c => this._set.add(c)); },
      contains(c) { return this._set.has(c); },
    },
  };
  const sandbox = {
    document: { documentElement: html },
    window: { location: { search } },
    URLSearchParams,  // Node provides this globally; expose it inside vm.
    console,
  };
  // The IIFE references `window.location.search` directly, but since
  // our sandbox doesn't auto-bind window globals, we evaluate inside a
  // wrapper that aliases location into scope.
  const wrapped = `var location = window.location; ${script}`;
  vm.createContext(sandbox);
  vm.runInContext(wrapped, sandbox);
  return html.classList.contains('embedded-mode');
}


// ── Tests ───────────────────────────────────────────────────────────


test('embedded=1 adds the embedded-mode class', () => {
  assert.equal(_runDetectionWith('?embedded=1'), true);
});

test('empty search does not add the class', () => {
  assert.equal(_runDetectionWith(''), false);
});

test('embedded=0 does not add the class (strict equals "1")', () => {
  assert.equal(_runDetectionWith('?embedded=0'), false);
});

test('embedded=true does not add the class (literal "1" only)', () => {
  assert.equal(_runDetectionWith('?embedded=true'), false);
});

test('embedded=1 still triggers when other params are present', () => {
  assert.equal(_runDetectionWith('?from=home&embedded=1&v=2'), true);
});

test('remaining iframe-mounted pages carry the same detection snippet', () => {
  // Pin: the iframe-mounted pages must all run identical detection.
  // Sprint 7.3 retired the IIFE from my-vocabulary.html (that page is
  // now an ES-module mount). Until Sprint 7.4 + 7.5 retire it from
  // flashcards + exercises, both must still share the byte-identical
  // Sprint 6.0.1 snippet — a divergence would be a regression.
  const pages = ['flashcards.html', 'exercises.html'];
  const snippets = pages.map(name => {
    const html = fs.readFileSync(
      path.join(__dirname, '..', 'pages', name),
      'utf8',
    );
    const m = html.match(
      /<!-- Sprint 6\.0\.1[\s\S]*?<script>([\s\S]*?)<\/script>/,
    );
    assert.ok(m, `Sprint 6.0.1 snippet missing from ${name}`);
    return m[1].replace(/\s+/g, ' ').trim();
  });
  assert.equal(
    snippets[0],
    snippets[1],
    'flashcards and exercises must share the embedded-mode IIFE',
  );
});

test('my-vocabulary.html no longer carries the embedded-mode IIFE (Sprint 7.3)', () => {
  // Symmetric guard for the retired-from-this-page contract.
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'pages', 'my-vocabulary.html'),
    'utf8',
  );
  assert.ok(
    !/<!-- Sprint 6\.0\.1[\s\S]*?classList\.add\(\s*['"]embedded-mode['"]\s*\)/.test(html),
    'my-vocabulary.html must NOT carry the Sprint 6.0.1 embedded-mode IIFE ' +
    'after Sprint 7.3 (page migrated to /js/vocab-modules/my-vocab.js mount).',
  );
});

test('embedded-mode CSS hides the chrome selectors', () => {
  // The CSS is the source of truth for which DOM elements get
  // suppressed. If a future page has chrome that's NOT covered by
  // these selectors, the iframe will leak it — pin the contract.
  const css = fs.readFileSync(
    path.join(__dirname, '..', 'css', 'embedded-mode.css'),
    'utf8',
  );
  // Top header is the universal chrome surface across all 3 pages.
  assert.match(css, /html\.embedded-mode\s*>\s*body\s*>\s*header/);
  // Banner is the Sprint 6.0 affordance — must stay hidden inside
  // iframes (the parent landing already provides the navigation
  // context the banner advertises).
  assert.match(css, /html\.embedded-mode\s+#vocab-moved-banner/);
  assert.match(css, /display:\s*none\s*!important/);
});
