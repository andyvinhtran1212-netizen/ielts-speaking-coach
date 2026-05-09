/**
 * frontend/tests/embedded-mode.test.js — Sprint 6.0.1 hotfix.
 *
 * Run with: node --test frontend/tests/embedded-mode.test.js
 *
 * The detection script is a tiny IIFE inlined in <head> of each
 * iframe-mounted page (my-vocabulary.html / flashcards.html /
 * exercises.html). All three copies are byte-identical, so we test
 * the canonical form by extracting it from one of the pages and
 * running it inside a vm sandbox where we can fake
 * `window.location.search`.
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
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'pages', 'my-vocabulary.html'),
    'utf8',
  );
  // The IIFE sits between the marker comment and the closing </script>
  // tag. Pull from the literal `(function ()` line up through the
  // matching `})();`. A regex works because the snippet has no nested
  // closure that would confuse the matcher.
  const m = html.match(
    /<!-- Sprint 6\.0\.1[\s\S]*?<script>([\s\S]*?)<\/script>/,
  );
  assert.ok(
    m,
    'embedded-mode IIFE not found in my-vocabulary.html — did the ' +
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

test('all three iframe-mounted pages carry the same detection snippet', () => {
  // Pin: my-vocabulary.html / flashcards.html / exercises.html must
  // all run identical detection. A divergence would be a Sprint 6.0.1
  // regression — for example, if a future PR copy-pastes the snippet
  // and tweaks the param name on one page only.
  const pages = ['my-vocabulary.html', 'flashcards.html', 'exercises.html'];
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
    'my-vocabulary and flashcards must share the embedded-mode IIFE',
  );
  assert.equal(
    snippets[1],
    snippets[2],
    'flashcards and exercises must share the embedded-mode IIFE',
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
