/**
 * frontend/tests/theme-toggle.test.mjs — foundation sprint 2026-05-09.
 *
 * Run with: node --test frontend/tests/theme-toggle.test.mjs
 *
 * Tests the public surface of theme-toggle.js (8 exports) plus a few
 * file-existence pins on tokens.css + components.css that the rest of
 * the design system depends on.
 *
 * Why .mjs (vs .test.js): theme-toggle.js is a native ES module
 * (`export function ...`). Node loads it via dynamic import, which is
 * easiest from an `.mjs` file with top-level await. The other frontend
 * test files stay CommonJS — they extract IIFEs from HTML and run them
 * in a vm sandbox, no module loading needed.
 *
 * Mocking strategy: install a localStorage shim, matchMedia stub, and
 * document.documentElement stand-in as globals BEFORE importing the
 * module under test, because the module auto-runs initTheme() on first
 * import. Each test calls reset() to wipe state between runs without
 * needing to re-import (Node caches imports, so re-importing wouldn't
 * re-run the auto-init anyway).
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));


// ── Global mocks ────────────────────────────────────────────────────


const _store = {};
let _systemPrefersDark = false;
const _mqListeners = [];


globalThis.localStorage = {
  getItem(key) { return key in _store ? _store[key] : null; },
  setItem(key, value) { _store[key] = String(value); },
  removeItem(key) { delete _store[key]; },
};

globalThis.window = {
  matchMedia(query) {
    return {
      get matches() {
        return query === '(prefers-color-scheme: dark)' && _systemPrefersDark;
      },
      addEventListener(_, fn) { _mqListeners.push(fn); },
      removeEventListener(_, fn) {
        const i = _mqListeners.indexOf(fn);
        if (i >= 0) _mqListeners.splice(i, 1);
      },
    };
  },
};

globalThis.document = {
  _attrs: {},
  _classes: new Set(),
  documentElement: {
    setAttribute(key, value) { globalThis.document._attrs[key] = value; },
    getAttribute(key) {
      return key in globalThis.document._attrs
        ? globalThis.document._attrs[key]
        : null;
    },
    classList: {
      add(c)      { globalThis.document._classes.add(c); },
      remove(c)   { globalThis.document._classes.delete(c); },
      contains(c) { return globalThis.document._classes.has(c); },
    },
  },
  readyState: 'complete',
  addEventListener(_event, _fn) { /* no-op for tests */ },
};

// requestAnimationFrame: synchronous fallback so the rAF cleanup in
// applyTheme() runs deterministically inside tests.
globalThis.requestAnimationFrame = (fn) => { fn(); return 0; };


function reset() {
  for (const k of Object.keys(_store)) delete _store[k];
  globalThis.document._attrs = {};
  globalThis.document._classes = new Set();
  _systemPrefersDark = false;
  _mqListeners.length = 0;
}


// ── Module under test ─────────────────────────────────────────────


// Imports happen AFTER the globals are installed above so the auto-init
// at module load time sees a stable mocked DOM.
const themeToggleModule = await import('../js/theme-toggle.js');
const {
  getStoredTheme,
  setStoredTheme,
  getSystemTheme,
  getEffectiveTheme,
  applyTheme,
  toggleTheme,
  bindToggleButton,
  initTheme,
} = themeToggleModule;


// ── Tests: storage layer ───────────────────────────────────────────


describe('theme-toggle / storage', () => {
  beforeEach(reset);

  test('getStoredTheme returns null when localStorage is empty', () => {
    assert.equal(getStoredTheme(), null);
  });

  test('getStoredTheme returns a valid stored value', () => {
    localStorage.setItem('av-theme', 'dark');
    assert.equal(getStoredTheme(), 'dark');
  });

  test('getStoredTheme rejects invalid stored values (returns null)', () => {
    localStorage.setItem('av-theme', 'sepia');
    assert.equal(
      getStoredTheme(),
      null,
      'an unexpected value in localStorage should be treated as no choice',
    );
  });

  test('setStoredTheme persists a valid theme', () => {
    setStoredTheme('dark');
    assert.equal(localStorage.getItem('av-theme'), 'dark');
  });

  test('setStoredTheme(null) clears the stored value', () => {
    localStorage.setItem('av-theme', 'dark');
    setStoredTheme(null);
    assert.equal(localStorage.getItem('av-theme'), null);
  });

  test('setStoredTheme silently ignores invalid input', () => {
    setStoredTheme('rainbow');
    assert.equal(
      localStorage.getItem('av-theme'),
      null,
      'invalid theme must not pollute storage',
    );
  });
});


// ── Tests: system preference ───────────────────────────────────────


describe('theme-toggle / system preference', () => {
  beforeEach(reset);

  test('getSystemTheme returns light when prefers-color-scheme is light', () => {
    _systemPrefersDark = false;
    assert.equal(getSystemTheme(), 'light');
  });

  test('getSystemTheme returns dark when prefers-color-scheme is dark', () => {
    _systemPrefersDark = true;
    assert.equal(getSystemTheme(), 'dark');
  });
});


// ── Tests: resolution ──────────────────────────────────────────────


describe('theme-toggle / effective theme resolution', () => {
  beforeEach(reset);

  test('getEffectiveTheme prefers stored choice over system', () => {
    _systemPrefersDark = true;
    localStorage.setItem('av-theme', 'light');
    assert.equal(getEffectiveTheme(), 'light');
  });

  test('getEffectiveTheme falls back to system when no stored choice', () => {
    _systemPrefersDark = true;
    assert.equal(getEffectiveTheme(), 'dark');
  });

  test('getEffectiveTheme falls back to light when nothing else applies', () => {
    _systemPrefersDark = false;
    assert.equal(getEffectiveTheme(), 'light');
  });
});


// ── Tests: applyTheme ──────────────────────────────────────────────


describe('theme-toggle / applyTheme', () => {
  beforeEach(reset);

  test('applyTheme sets data-theme on <html>', () => {
    applyTheme('dark');
    assert.equal(
      document.documentElement.getAttribute('data-theme'),
      'dark',
    );
  });

  test('applyTheme rejects invalid input (warns + falls back to light)', () => {
    applyTheme('neon');
    assert.equal(
      document.documentElement.getAttribute('data-theme'),
      'light',
      'invalid input must coerce to a safe default, not crash',
    );
  });

  test('applyTheme with skipTransition adds + removes theme-loading class', () => {
    // Our rAF mock runs callbacks synchronously, so by the time
    // applyTheme returns, the class is already removed.
    applyTheme('dark', { skipTransition: true });
    assert.equal(
      document.documentElement.classList.contains('theme-loading'),
      false,
      'theme-loading must be cleared after the rAF callbacks resolve',
    );
    assert.equal(
      document.documentElement.getAttribute('data-theme'),
      'dark',
      'theme should still apply when skipTransition is true',
    );
  });
});


// ── Tests: toggleTheme ─────────────────────────────────────────────


describe('theme-toggle / toggleTheme', () => {
  beforeEach(reset);

  test('toggleTheme flips light → dark and persists', () => {
    localStorage.setItem('av-theme', 'light');
    const next = toggleTheme();
    assert.equal(next, 'dark');
    assert.equal(localStorage.getItem('av-theme'), 'dark');
    assert.equal(document.documentElement.getAttribute('data-theme'), 'dark');
  });

  test('toggleTheme flips dark → light and persists', () => {
    localStorage.setItem('av-theme', 'dark');
    const next = toggleTheme();
    assert.equal(next, 'light');
    assert.equal(localStorage.getItem('av-theme'), 'light');
  });

  test('toggleTheme starts from system preference when no stored choice', () => {
    _systemPrefersDark = true;
    const next = toggleTheme();
    assert.equal(next, 'light', 'system says dark, so toggle goes to light');
    assert.equal(localStorage.getItem('av-theme'), 'light');
  });
});


// ── Tests: bindToggleButton ────────────────────────────────────────


describe('theme-toggle / bindToggleButton', () => {
  beforeEach(reset);

  function makeButton() {
    const _attrs = {};
    const _listeners = {};
    return {
      _attrs,
      setAttribute(k, v) { _attrs[k] = v; },
      getAttribute(k) { return k in _attrs ? _attrs[k] : null; },
      addEventListener(event, fn) { _listeners[event] = fn; },
      removeEventListener(event, fn) {
        if (_listeners[event] === fn) delete _listeners[event];
      },
      _click() { if (_listeners.click) _listeners.click(); },
    };
  }

  test('bindToggleButton sets initial aria-label + aria-pressed', () => {
    const btn = makeButton();
    bindToggleButton(btn);
    // Default: no stored choice, system light → effective light
    assert.equal(btn.getAttribute('aria-label'), 'Chuyển sang giao diện tối');
    assert.equal(btn.getAttribute('aria-pressed'), 'false');
  });

  test('bindToggleButton updates aria after a click', () => {
    const btn = makeButton();
    bindToggleButton(btn);
    btn._click();
    assert.equal(
      btn.getAttribute('aria-label'),
      'Chuyển sang giao diện sáng',
      'aria-label should describe the next action, which after going dark is "back to light"',
    );
    assert.equal(btn.getAttribute('aria-pressed'), 'true');
    assert.equal(localStorage.getItem('av-theme'), 'dark');
  });

  test('bindToggleButton returns a teardown that detaches handlers', () => {
    const btn = makeButton();
    const teardown = bindToggleButton(btn);
    teardown();
    btn._click();
    assert.equal(
      localStorage.getItem('av-theme'),
      null,
      'click after teardown must not toggle (handler detached)',
    );
  });

  test('bindToggleButton(null) is a safe no-op', () => {
    // Defensive: a page without the toggle button shouldn't crash.
    const teardown = bindToggleButton(null);
    assert.equal(typeof teardown, 'function');
    teardown();  // also a no-op
  });

  test('system preference change retrieves new theme only when no explicit choice', () => {
    const btn = makeButton();
    bindToggleButton(btn);

    // No stored choice → mq listener should react when the system flips.
    _systemPrefersDark = true;
    _mqListeners.forEach(fn => fn());
    assert.equal(
      document.documentElement.getAttribute('data-theme'),
      'dark',
    );

    // Now the user makes an explicit choice — mq changes shouldn't override.
    setStoredTheme('light');
    applyTheme('light');
    _systemPrefersDark = false;
    _mqListeners.forEach(fn => fn());
    assert.equal(
      document.documentElement.getAttribute('data-theme'),
      'light',
      'explicit choice must persist even when OS preference changes',
    );
  });
});


// ── Tests: initTheme ───────────────────────────────────────────────


describe('theme-toggle / initTheme', () => {
  beforeEach(reset);

  test('initTheme applies the resolved theme with skipTransition', () => {
    _systemPrefersDark = true;
    initTheme();
    assert.equal(
      document.documentElement.getAttribute('data-theme'),
      'dark',
      'initTheme should pick up the system preference when no stored choice',
    );
  });
});


// ── Tests: design-system file pins ─────────────────────────────────


describe('design-system files', () => {
  function _read(rel) {
    return readFileSync(path.join(__dirname, '..', rel), 'utf8');
  }

  test('tokens.css declares both light and dark theme blocks', () => {
    const css = _read('css/aver-design/tokens.css');
    // Light theme: matched by either :root or :root[data-theme="light"]
    assert.match(
      css,
      /:root,\s*\n\s*:root\[data-theme="light"\]/,
      'tokens.css must declare the default + explicit-light selector pair',
    );
    assert.match(
      css,
      /:root\[data-theme="dark"\]/,
      'tokens.css must declare the dark theme overrides',
    );
  });

  test('tokens.css includes prefers-color-scheme fallback', () => {
    const css = _read('css/aver-design/tokens.css');
    assert.match(
      css,
      /@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)/,
      'tokens.css must include the system-preference fallback @media block',
    );
    assert.match(
      css,
      /:root:not\(\[data-theme\]\)/,
      'the @media block must scope to roots without an explicit data-theme',
    );
  });

  test('tokens.css declares the av-theme-transition variable', () => {
    const css = _read('css/aver-design/tokens.css');
    assert.match(
      css,
      /--av-theme-transition\s*:/,
      'theme transitions are declared as a single token so they stay in sync',
    );
  });

  test('tokens.css guards against transition flicker via .theme-loading', () => {
    const css = _read('css/aver-design/tokens.css');
    assert.match(
      css,
      /html\.theme-loading/,
      'the .theme-loading guard suppresses the body transition during initial paint',
    );
  });

  test('components.css defines .av-theme-toggle', () => {
    const css = _read('css/aver-design/components.css');
    assert.match(
      css,
      /\.av-theme-toggle\s*\{/,
      '.av-theme-toggle is the canonical toggle button class',
    );
  });

  test('components.css defines .av-button + .av-button-primary', () => {
    const css = _read('css/aver-design/components.css');
    assert.match(css, /\.av-button\s*\{/);
    assert.match(css, /\.av-button-primary\b/);
  });

  test('components.css defines .av-card', () => {
    const css = _read('css/aver-design/components.css');
    assert.match(css, /\.av-card\s*\{/);
  });

  test('components.css references --av-* tokens (no hardcoded colors check)', () => {
    const css = _read('css/aver-design/components.css');
    // Every component should reference at least some av-* token. Verify
    // the file contains the token namespace heavily.
    const tokenRefs = (css.match(/var\(--av-/g) || []).length;
    assert.ok(
      tokenRefs > 50,
      `components.css should reference --av-* tokens throughout (found ${tokenRefs}); ` +
      `if this drops, components are likely hardcoding colors`,
    );
  });

  test('DESIGN_SYSTEM.md documents both themes + Vietnamese typography', () => {
    const md = _read('css/aver-design/DESIGN_SYSTEM.md');
    assert.match(md, /Light\b/);
    assert.match(md, /Dark\b/);
    assert.match(md, /Vietnamese/);
  });

  test('UNIFIED_DESIGN_BRIEF.md exists with per-page checklist + JS-coupled class list', () => {
    const md = _read('css/aver-design/UNIFIED_DESIGN_BRIEF.md');
    assert.match(md, /Per-page checklist/i);
    assert.match(md, /\.btn-primary/, 'must list the JS-coupled classes that cannot be renamed');
    assert.match(md, /\.skill-card/);
    assert.match(md, /\.main-tab-btn/);
  });
});
