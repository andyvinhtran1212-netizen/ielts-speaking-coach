/**
 * frontend/js/theme-toggle.js — Aver Learning theme toggle.
 *
 * Foundation sprint 2026-05-09. ES module; importable from any page that
 * uses `<script type="module">`.
 *
 * Theme resolution:
 *   1. Stored choice — localStorage key 'av-theme' = 'light' | 'dark'
 *   2. System preference — window.matchMedia('(prefers-color-scheme: dark)')
 *   3. Light — final fallback
 *
 * The active theme is signaled by [data-theme="light"|"dark"] on <html>.
 * Components in components.css read tokens from tokens.css that re-resolve
 * based on that attribute, so flipping it flips the whole page.
 *
 * Anti-flash: the inline IIFE in <head> (documented in DESIGN_SYSTEM.md
 * § 2.4) sets [data-theme] BEFORE any stylesheet loads. This module's
 * initTheme() then briefly applies a `theme-loading` class on <html> to
 * suppress transitions during the first frame after import — without
 * that, the body's `transition: background-color ...` rule animates from
 * the IIFE-applied theme to the same theme on every page load (visible
 * flicker even though the theme doesn't change).
 *
 * Exports: getStoredTheme, getSystemTheme, getEffectiveTheme, applyTheme,
 *          setStoredTheme, toggleTheme, bindToggleButton, initTheme.
 */

'use strict';


// ── Constants ───────────────────────────────────────────────────────


const STORAGE_KEY = 'av-theme';
const VALID_THEMES = ['light', 'dark'];

// Vietnamese aria-labels — updated dynamically on the toggle button.
const ARIA_LABELS = {
  toLight: 'Chuyển sang giao diện sáng',
  toDark:  'Chuyển sang giao diện tối',
};


// ── Storage layer ──────────────────────────────────────────────────


/**
 * Read the stored theme from localStorage.
 *
 * Returns null on:
 *   - Empty localStorage (no choice yet — defer to system preference)
 *   - Invalid value (sanity guard against corrupted entries)
 *   - localStorage access throwing (privacy mode, third-party-cookie blocks)
 */
export function getStoredTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return VALID_THEMES.includes(stored) ? stored : null;
  } catch {
    return null;
  }
}


/**
 * Persist the user's choice. Pass null to clear (revert to system preference).
 * Silent no-op if localStorage access throws.
 */
export function setStoredTheme(theme) {
  try {
    if (theme === null || theme === undefined) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    if (VALID_THEMES.includes(theme)) {
      localStorage.setItem(STORAGE_KEY, theme);
    }
  } catch {
    // localStorage blocked — ignore, theme will be ephemeral for this session.
  }
}


// ── System preference ──────────────────────────────────────────────


/**
 * Detect the OS-level theme preference. Returns 'light' or 'dark'.
 * Defaults to 'light' if matchMedia isn't available.
 */
export function getSystemTheme() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}


// ── Resolution ─────────────────────────────────────────────────────


/**
 * Resolve the effective theme: explicit user choice wins, otherwise
 * system preference, otherwise light.
 */
export function getEffectiveTheme() {
  return getStoredTheme() || getSystemTheme();
}


// ── Application ────────────────────────────────────────────────────


/**
 * Set [data-theme] on <html>. Optionally suppress transitions for one
 * frame to prevent flicker on initial paint.
 *
 * The double-rAF dance is deliberate:
 *   - Frame 1: add .theme-loading (transitions disabled by tokens.css rule)
 *   - Frame 1: also set data-theme — browser layouts new colors
 *   - Frame 2: remove .theme-loading — subsequent flips animate normally
 *
 * Without it, setting data-theme after the IIFE already applied it would
 * still animate (browser sees the attribute "change" even when value is
 * identical, because of how style recalc and transitions interact).
 */
export function applyTheme(theme, { skipTransition = false } = {}) {
  if (!VALID_THEMES.includes(theme)) {
    console.warn(`theme-toggle: invalid theme "${theme}", falling back to light`);
    theme = 'light';
  }

  const html = document.documentElement;

  if (!skipTransition) {
    html.setAttribute('data-theme', theme);
    return;
  }

  html.classList.add('theme-loading');
  html.setAttribute('data-theme', theme);

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        html.classList.remove('theme-loading');
      });
    });
  } else {
    // Test environment without rAF — clear immediately.
    html.classList.remove('theme-loading');
  }
}


/**
 * Flip light↔dark, persist the choice, return the new theme.
 */
export function toggleTheme() {
  const current = getEffectiveTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  setStoredTheme(next);
  applyTheme(next);
  return next;
}


// ── Button binding ─────────────────────────────────────────────────


/**
 * Wire a button element to toggle the theme on click. Updates aria
 * attributes and listens for OS-level preference changes.
 *
 * Returns a teardown function for tests / SPA-style page transitions.
 */
export function bindToggleButton(button) {
  if (!button) return () => {};

  const updateAria = () => {
    const theme = getEffectiveTheme();
    // The button label describes the action that will happen on next click,
    // not the current state — clearer intent for screen readers.
    button.setAttribute(
      'aria-label',
      theme === 'dark' ? ARIA_LABELS.toLight : ARIA_LABELS.toDark,
    );
    button.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
  };

  updateAria();

  const onClick = () => {
    toggleTheme();
    updateAria();
  };
  button.addEventListener('click', onClick);

  // System-preference change: only react if the user hasn't set an
  // explicit choice. Once they pick a theme, their choice sticks even
  // if the OS-level preference flips.
  let mq = null;
  let onMqChange = null;
  if (typeof window !== 'undefined' && window.matchMedia) {
    mq = window.matchMedia('(prefers-color-scheme: dark)');
    onMqChange = () => {
      if (!getStoredTheme()) {
        applyTheme(getSystemTheme());
        updateAria();
      }
    };
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onMqChange);
    } else if (typeof mq.addListener === 'function') {
      // Safari < 14 fallback.
      mq.addListener(onMqChange);
    }
  }

  return function teardown() {
    button.removeEventListener('click', onClick);
    if (mq && onMqChange) {
      if (typeof mq.removeEventListener === 'function') {
        mq.removeEventListener('change', onMqChange);
      } else if (typeof mq.removeListener === 'function') {
        mq.removeListener(onMqChange);
      }
    }
  };
}


// ── Boot ───────────────────────────────────────────────────────────


/**
 * Apply the effective theme on first import. Call from <head> via the
 * inline IIFE (anti-flash) for synchronous behavior, or from a deferred
 * <script type="module"> for the post-paint case.
 *
 * The IIFE in <head> already sets data-theme before any stylesheet
 * loads. This function re-applies it with skipTransition: true to add
 * the .theme-loading guard so the body's transition rule doesn't fire
 * on the first frame.
 */
export function initTheme() {
  applyTheme(getEffectiveTheme(), { skipTransition: true });
}


// Auto-init when imported in a browser context. SSR / test environments
// (where document is undefined) skip this — they call initTheme()
// explicitly after mocking the DOM.
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme, { once: true });
  } else {
    initTheme();
  }
}
