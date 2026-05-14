/**
 * frontend/tests/vocab-landing.test.js — Sprint 6.0 vocabulary
 * landing logic. Sprint 8.2 refactored the IA: the ARIA tablist row
 * was retired in favor of a `.mode-card[data-mode]` dashboard grid.
 *
 * Run with: node --test frontend/tests/vocab-landing.test.js
 *
 * Covers js/vocab-landing.js (the mode-card click delegator + lazy
 * module loader). Pattern mirrors home.test.js: shimmed DOM, sandboxed
 * eval of the production script, exercise via `window.__vocabLanding`.
 *
 * Pinned behaviour (post Sprint 8.2):
 *   - activateTab hides the .vocab-modes dashboard view and reveals
 *     the matching .tab-panel via `hidden` attribute toggle
 *   - Default landing state when no URL hash present is the dashboard
 *     view itself — no panel auto-activates on cold load
 *   - Initial hash deep-link (#flashcards etc.) activates that panel
 *     during bootstrap()
 *   - Topic-bank tab is valid but has no module loader — must not throw
 *   - Unknown tab name falls back to DEFAULT_TAB (defensive)
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

// ── DOM shim ──────────────────────────────────────────────────────────

function makeElement(tagName = 'div', attrs = {}) {
  const el = {
    tagName,
    attributes: { ...attrs },
    dataset: {},
    children: [],
    innerHTML: '',
    textContent: '',
    src: '',
    hidden: false,
    disabled: false,
    tabIndex: -1,
    classList: {
      _set: new Set(),
      add(...cs) { cs.forEach(c => this._set.add(c)); },
      remove(...cs) { cs.forEach(c => this._set.delete(c)); },
      contains(c) { return this._set.has(c); },
      toggle(c, on) {
        if (on === undefined) on = !this._set.has(c);
        if (on) this._set.add(c); else this._set.delete(c);
        return on;
      },
    },
    _listeners: {},
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k]; },
    addEventListener(ev, fn) {
      (this._listeners[ev] = this._listeners[ev] || []).push(fn);
    },
    dispatchEvent(ev) {
      (this._listeners[ev.type] || []).forEach(fn => fn(ev));
    },
    focus() { /* no-op for shim */ },
  };
  if (attrs && attrs['data-mode'])  el.dataset.mode  = attrs['data-mode'];
  if (attrs && attrs['data-panel']) el.dataset.panel = attrs['data-panel'];
  return el;
}

function buildPage() {
  // Sprint 8.2 — the dashboard view (.vocab-modes) replaces the tab-
  // row. 4 mode-cards, each carrying data-mode. The legacy tab-row
  // ARIA tablist DOM was retired alongside the vocab-tabs CSS block.
  const dashboard = makeElement('section');
  dashboard.classList.add('vocab-modes');
  const modeCards = ['my-vocab', 'flashcards', 'exercises', 'topic-bank'].map(m =>
    makeElement('a', { 'data-mode': m }),
  );

  // 4 panels — all hidden by default; activateTab() reveals the target.
  const panels = ['my-vocab', 'flashcards', 'exercises', 'topic-bank'].map(t => {
    const panel = makeElement('section', { 'data-panel': t });
    panel.hidden = true;
    // The 3 module-backed panels carry a .tab-mount container (the
    // dynamic-import target). Topic-bank has no mount — it's a static
    // placeholder.
    if (t !== 'topic-bank') {
      const mount = makeElement('div');
      mount.classList.add('tab-mount');
      panel.children.push(mount);
    }
    return panel;
  });

  // Stat slots (loadStats writes here — null tolerant via getElementById).
  const statEls = {
    'stat-words-count':       makeElement(),
    'stat-flashcards-due':    makeElement(),
    'stat-stacks-count':      makeElement(),
  };

  return {
    readyState: 'complete',
    addEventListener() {},
    getElementById(id) { return statEls[id] || null; },
    querySelector(sel) {
      if (sel === '.vocab-modes') return dashboard;
      // Used by activateTab to find the .tab-mount inside the active panel.
      const m = sel.match(/^\[data-panel="([\w-]+)"\] \.tab-mount$/);
      if (m) {
        const panel = panels.find(p => p.dataset.panel === m[1]);
        return panel ? panel.children.find(c => c.classList.contains('tab-mount')) || null : null;
      }
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '.mode-card[data-mode]') return modeCards;
      if (sel === '.tab-panel')            return panels;
      return [];
    },
    _dashboard: dashboard,
    _modeCards: modeCards,
    _panels: panels,
    _stats: statEls,
  };
}

function loadVocabLanding(doc) {
  const scriptPath = path.join(__dirname, '..', 'js', 'vocab-landing.js');
  const code = fs.readFileSync(scriptPath, 'utf8');
  const sandbox = {
    document: doc,
    setTimeout,
    clearTimeout,
    console,
    window: {
      api: { get: async () => null },  // loadStats short-circuits on falsy.
      location: { hash: '' },
      addEventListener: () => {},
    },
  };
  sandbox.window.document = doc;
  sandbox.window.history = { replaceState: () => {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.window;
}

// ── Tests ───────────────────────────────────────────────────────────

test('activateTab hides the .vocab-modes dashboard and reveals the target panel', () => {
  const doc = buildPage();
  const win = loadVocabLanding(doc);

  // Cold-start sanity: dashboard visible, every panel hidden.
  assert.equal(doc._dashboard.hidden, false, 'dashboard starts visible (Sprint 8.2 default landing state)');
  assert.ok(doc._panels.every(p => p.hidden), 'all panels start hidden');

  win.__vocabLanding.activateTab('flashcards');

  assert.equal(doc._dashboard.hidden, true,
    '.vocab-modes dashboard is hidden once a panel activates');
  const flashcardsPanel = doc._panels.find(p => p.dataset.panel === 'flashcards');
  const myVocabPanel    = doc._panels.find(p => p.dataset.panel === 'my-vocab');
  assert.equal(flashcardsPanel.hidden, false, 'target panel is revealed');
  assert.equal(myVocabPanel.hidden, true,    'non-target panels stay hidden');
});

// Sprint 7.6 — DEBT-2026-05-09-B CLOSED. The legacy iframe path
// (TAB_SOURCES + _loaded Set + frame.src else-branch) was retired
// in this sprint. All 3 vocab children go through TAB_LOADERS only.

test('all 3 vocab children are registered in TAB_LOADERS', () => {
  const doc = buildPage();
  const win = loadVocabLanding(doc);

  const loaders = win.__vocabLanding.TAB_LOADERS;
  assert.deepEqual(
    [...loaders].sort(),
    ['exercises', 'flashcards', 'my-vocab'],
    'TAB_LOADERS must list all 3 vocab children',
  );
});

test('TAB_SOURCES no longer exposed on the test seam (Sprint 7.6 retirement)', () => {
  const doc = buildPage();
  const win = loadVocabLanding(doc);

  assert.equal(
    win.__vocabLanding.TAB_SOURCES,
    undefined,
    'TAB_SOURCES seam must be removed after Sprint 7.6 (the const itself is gone)',
  );
});

test('topic-bank tab activates without throwing (static placeholder)', () => {
  const doc = buildPage();
  const win = loadVocabLanding(doc);

  // Coverage for the placeholder branch — topic-bank is not in
  // TAB_LOADERS so activateTab must no-op the module-mount path
  // gracefully while still revealing the panel + hiding the dashboard.
  assert.doesNotThrow(() => {
    win.__vocabLanding.activateTab('topic-bank');
  }, 'topic-bank tab activation must not throw');

  const topicBankPanel = doc._panels.find(p => p.dataset.panel === 'topic-bank');
  assert.equal(topicBankPanel.hidden, false,
    'topic-bank panel is revealed after activateTab');
  assert.equal(doc._dashboard.hidden, true,
    'dashboard is hidden even when the target mode has no module loader');
});

test('activateTab falls back to DEFAULT_TAB when given an unknown mode', () => {
  const doc = buildPage();
  const win = loadVocabLanding(doc);

  win.__vocabLanding.activateTab('not-a-real-tab');

  const myVocabPanel = doc._panels.find(p => p.dataset.panel === 'my-vocab');
  assert.equal(myVocabPanel.hidden, false,
    'unknown mode name should fall back to DEFAULT_TAB (my-vocab) panel');
});

test('VALID_TABS surface lists exactly the four supported modes', () => {
  const doc = buildPage();
  const win = loadVocabLanding(doc);

  // Cross-vm-context arrays don't share the same Array constructor,
  // so deepStrictEqual fails reference-equality. Compare values instead.
  assert.equal(
    JSON.stringify([...win.__vocabLanding.VALID_TABS].sort()),
    JSON.stringify(['exercises', 'flashcards', 'my-vocab', 'topic-bank'].sort()),
  );
  assert.equal(win.__vocabLanding.DEFAULT_TAB, 'my-vocab',
    'DEFAULT_TAB stays my-vocab as the unknown-mode fallback (Sprint 8.2: no longer the page-load default)');
});
