/**
 * frontend/tests/vocab-landing.test.js — Sprint 6.0 vocabulary
 * landing page tab logic.
 *
 * Run with: node --test frontend/tests/vocab-landing.test.js
 *
 * Covers js/vocab-landing.js (the tab switcher + lazy iframe loader).
 * Pattern mirrors home.test.js: shimmed DOM, sandboxed eval of the
 * production script, exercise via `window.__vocabLanding`.
 *
 * Pinned behaviour:
 *   - activateTab toggles `.active` class + aria-selected on the right
 *     tab button and unhides the matching panel
 *   - The iframe in the activated panel gets its `src` set on first
 *     visit, and only on first visit (no re-fetch on tab re-click)
 *   - Default tab is 'my-vocab' when no hash present
 *   - Initial hash deep-link (#flashcards etc.) activates that tab
 *   - Topic-bank tab is valid but has no iframe src — must not throw
 *   - Unknown tab name falls back to default (defensive)
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
    focus() { /* a11y arrow-key test exercises this */ },
  };
  if (attrs && attrs['data-tab'])   el.dataset.tab   = attrs['data-tab'];
  if (attrs && attrs['data-panel']) el.dataset.panel = attrs['data-panel'];
  return el;
}

function buildPage() {
  // Tab buttons
  const tabs = ['my-vocab', 'flashcards', 'exercises', 'topic-bank'].map(t =>
    makeElement('button', { 'data-tab': t }),
  );
  tabs[0].classList.add('active');

  // Panels with iframe children for the three iframe-backed tabs
  // (topic-bank panel has no iframe — pure static placeholder).
  const panels = ['my-vocab', 'flashcards', 'exercises', 'topic-bank'].map(t => {
    const panel = makeElement('section', { 'data-panel': t });
    if (t !== 'topic-bank') {
      const frame = makeElement('iframe');
      frame.classList.add('tab-frame');
      panel.children.push(frame);
    }
    if (t !== 'my-vocab') panel.hidden = true;
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
      // Used by activateTab to find the iframe inside the active panel.
      const m = sel.match(/^\[data-panel="([\w-]+)"\] \.tab-frame$/);
      if (m) {
        const panel = panels.find(p => p.dataset.panel === m[1]);
        return panel ? panel.children.find(c => c.tagName === 'iframe') || null : null;
      }
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '.vocab-tabs .tab') return tabs;
      if (sel === '.tab-panel')       return panels;
      return [];
    },
    _tabs: tabs,
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
    // history.replaceState can be invoked — make it a no-op.
  };
  sandbox.window.document = doc;
  sandbox.window.history = { replaceState: () => {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.window;
}

// ── Tests ───────────────────────────────────────────────────────────

test('activateTab marks the target tab active and reveals its panel', () => {
  const doc = buildPage();
  const win = loadVocabLanding(doc);

  win.__vocabLanding.activateTab('flashcards');

  const flashcardsTab = doc._tabs.find(t => t.dataset.tab === 'flashcards');
  const myVocabTab = doc._tabs.find(t => t.dataset.tab === 'my-vocab');
  assert.ok(flashcardsTab.classList.contains('active'),
    'flashcards tab gets the active class');
  assert.ok(!myVocabTab.classList.contains('active'),
    'previously-active my-vocab loses active class');
  assert.equal(flashcardsTab.attributes['aria-selected'], 'true',
    'aria-selected is set on the active tab for screen readers');

  const flashcardsPanel = doc._panels.find(p => p.dataset.panel === 'flashcards');
  const myVocabPanel = doc._panels.find(p => p.dataset.panel === 'my-vocab');
  assert.equal(flashcardsPanel.hidden, false, 'target panel is revealed');
  assert.equal(myVocabPanel.hidden, true, 'previously-active panel is hidden');
});

test('activateTab lazy-mounts iframe src on first visit only', () => {
  // Sprint 7.3 migrated my-vocab to TAB_LOADERS; Sprint 7.4 migrated
  // flashcards too. Exercises is the only remaining iframe-backed tab
  // exercising the TAB_SOURCES lazy-load path until Sprint 7.5.
  const doc = buildPage();
  const win = loadVocabLanding(doc);

  const exercisesPanel = doc._panels.find(p => p.dataset.panel === 'exercises');
  const exercisesFrame = exercisesPanel.children.find(c => c.tagName === 'iframe');
  assert.equal(exercisesFrame.src, '',
    'iframe src is empty until the tab is activated');

  win.__vocabLanding.activateTab('exercises');
  const firstSrc = exercisesFrame.src;
  assert.ok(firstSrc.includes('exercises.html'),
    `iframe src should now include exercises.html, got ${firstSrc}`);
  assert.ok(firstSrc.includes('embedded=1'),
    'iframe URL must carry embedded=1 so banner suppression works');

  // Mutate src to a sentinel so we can detect a re-write.
  exercisesFrame.src = '__sentinel__';
  win.__vocabLanding.activateTab('my-vocab');
  win.__vocabLanding.activateTab('exercises');
  assert.equal(exercisesFrame.src, '__sentinel__',
    'iframe src must NOT be re-written on tab re-visit (state preservation)');
});

test('topic-bank tab activates without throwing (no iframe src)', () => {
  const doc = buildPage();
  const win = loadVocabLanding(doc);

  // Coverage for the placeholder branch — no iframe means
  // TAB_SOURCES['topic-bank'] is undefined and the loader skips it.
  assert.doesNotThrow(() => {
    win.__vocabLanding.activateTab('topic-bank');
  }, 'topic-bank tab activation must not throw despite missing iframe src');

  const topicBankTab = doc._tabs.find(t => t.dataset.tab === 'topic-bank');
  assert.ok(topicBankTab.classList.contains('active'));
});

test('activateTab falls back to default when given an unknown tab', () => {
  const doc = buildPage();
  const win = loadVocabLanding(doc);

  win.__vocabLanding.activateTab('not-a-real-tab');

  const myVocabTab = doc._tabs.find(t => t.dataset.tab === 'my-vocab');
  assert.ok(myVocabTab.classList.contains('active'),
    'unknown tab name should fall back to DEFAULT_TAB (my-vocab)');
});

test('VALID_TABS surface lists exactly the four supported tabs', () => {
  const doc = buildPage();
  const win = loadVocabLanding(doc);

  // Cross-vm-context arrays don't share the same Array constructor,
  // so deepStrictEqual fails reference-equality. Compare values instead.
  assert.equal(
    JSON.stringify([...win.__vocabLanding.VALID_TABS].sort()),
    JSON.stringify(['exercises', 'flashcards', 'my-vocab', 'topic-bank'].sort()),
  );
  assert.equal(win.__vocabLanding.DEFAULT_TAB, 'my-vocab');
});
