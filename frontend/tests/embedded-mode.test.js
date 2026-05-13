/**
 * frontend/tests/embedded-mode.test.js — Sprint 6.0.1 hotfix sentinel.
 *
 * Run with: node --test frontend/tests/embedded-mode.test.js
 *
 * **Sprint 7.5 milestone reshape:** All 3 vocab children (my-vocabulary,
 * flashcards, exercises) are now ES-module mounts under
 * /js/vocab-modules/*. None of them ships the Sprint 6.0.1 embedded-mode
 * IIFE anymore — the iframe path is dead.
 *
 * Prior to Sprint 7.5 this file extracted the IIFE from whichever page
 * still carried it and ran the snippet inside a vm sandbox to verify
 * runtime behavior. With zero surviving extraction sources, the runtime
 * tests are no longer applicable. The file now stands as a **pure
 * symmetric-guard sentinel** — pinning that each of the 3 children has
 * fully retired its IIFE, plus pinning that the embedded-mode.css link
 * still references the file (full deletion deferred to Sprint 7.6).
 *
 * Sprint 7.6 retires embedded-mode.css and may delete this file. Until
 * then the symmetric guards prevent regression (someone re-adding the
 * IIFE during a copy-paste from an older page).
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');


// ── Symmetric guards: all 3 children have retired the IIFE ──────────


test('my-vocabulary.html no longer carries the embedded-mode IIFE (Sprint 7.3)', () => {
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


test('flashcards.html no longer carries the embedded-mode IIFE (Sprint 7.4)', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'pages', 'flashcards.html'),
    'utf8',
  );
  assert.ok(
    !/<!-- Sprint 6\.0\.1[\s\S]*?classList\.add\(\s*['"]embedded-mode['"]\s*\)/.test(html),
    'flashcards.html must NOT carry the Sprint 6.0.1 embedded-mode IIFE ' +
    'after Sprint 7.4 (page migrated to /js/vocab-modules/flashcards.js mount).',
  );
});


test('exercises.html no longer carries the embedded-mode IIFE (Sprint 7.5)', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'pages', 'exercises.html'),
    'utf8',
  );
  assert.ok(
    !/<!-- Sprint 6\.0\.1[\s\S]*?classList\.add\(\s*['"]embedded-mode['"]\s*\)/.test(html),
    'exercises.html must NOT carry the Sprint 6.0.1 embedded-mode IIFE ' +
    'after Sprint 7.5 (page migrated to /js/vocab-modules/exercises.js mount).',
  );
});


// ── Defensive — no class-set call survives anywhere on the 3 children


test('no embedded-mode classList.add call survives on any of the 3 children', () => {
  // Belt-and-braces: independent of the Sprint 6.0.1 marker comment, the
  // class-set itself must not appear. A future copy-paste that drops the
  // comment but keeps the classList.add must still fail this pin.
  const pages = ['my-vocabulary.html', 'flashcards.html', 'exercises.html'];
  for (const name of pages) {
    const html = fs.readFileSync(
      path.join(__dirname, '..', 'pages', name),
      'utf8',
    );
    assert.ok(
      !/classList\.add\(\s*['"]embedded-mode['"]\s*\)/.test(html),
      `${name} must NOT add the embedded-mode class anywhere (Sprint 7.3 → 7.5 milestone).`,
    );
  }
});


// ── embedded-mode.css link still present pending Sprint 7.6 cleanup ─


test('embedded-mode.css link still present on the 3 standalone shells (Sprint 7.6 retires)', () => {
  // The CSS file is unused at runtime now (no page sets the html
  // .embedded-mode class anymore), but the <link> tag stays for the
  // duration of Sprint 7.5 → 7.6 transition window. Sprint 7.6
  // simultaneously deletes the file + drops all 3 link tags.
  const pages = ['my-vocabulary.html', 'flashcards.html', 'exercises.html'];
  for (const name of pages) {
    const html = fs.readFileSync(
      path.join(__dirname, '..', 'pages', name),
      'utf8',
    );
    assert.match(
      html,
      /css\/embedded-mode\.css/,
      `${name} should still link embedded-mode.css until Sprint 7.6 retirement`,
    );
  }
});


// ── CSS surface preserved until Sprint 7.6 retirement ───────────────


test('embedded-mode CSS hides the chrome selectors (preserved until Sprint 7.6)', () => {
  // The selectors stay until Sprint 7.6. Even though no runtime page
  // adds the html.embedded-mode class anymore, the CSS file exists and
  // its contract is pinned here so accidental deletion before Sprint 7.6
  // is caught.
  const css = fs.readFileSync(
    path.join(__dirname, '..', 'css', 'embedded-mode.css'),
    'utf8',
  );
  assert.match(css, /html\.embedded-mode\s*>\s*body\s*>\s*header/);
  assert.match(css, /html\.embedded-mode\s+#vocab-moved-banner/);
  assert.match(css, /display:\s*none\s*!important/);
});
