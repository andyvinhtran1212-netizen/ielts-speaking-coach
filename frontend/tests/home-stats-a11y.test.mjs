/**
 * frontend/tests/home-stats-a11y.test.mjs
 *
 * The Next home shell marks its loading `…` placeholders aria-hidden so a screen
 * reader never announces a not-yet-loaded number. The flip side is a hard
 * contract: once the real value lands (or the error `—` sweep runs) the span
 * MUST rejoin the accessibility tree — otherwise loaded band scores and activity
 * counts stay permanently hidden from screen-reader users.
 *
 * Source-string assertions against the Next shell + behavior (same pattern as
 * home-stats-loading.test.mjs), since home-behavior.tsx is not node-importable
 * and setStat / clearStatLoading are not exported.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const front = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');

const SHELL = front('app', '(authed-home)', 'home', 'page-shell.tsx');
const BEHAVIOR = front('app', '(authed-home)', 'home', 'home-behavior.tsx');

describe('home stats — loaded values rejoin the accessibility tree', () => {
  test('the shell hides the loading placeholders from screen readers', () => {
    // skill-card metric placeholders: aria-hidden only while loading
    assert.match(SHELL, /js-val is-loading['"][\s\S]{0,80}aria-hidden=\{skill\.loading \? true : undefined\}/);
    // hero stat placeholders: always start aria-hidden with the `…`
    assert.match(SHELL, /value-num is-loading["'] aria-hidden="true"/);
  });

  test('setStat removes aria-hidden when it writes a real value', () => {
    assert.match(
      BEHAVIOR,
      /function setStat\([\s\S]{0,240}classList\.remove\('is-loading'\)[\s\S]{0,400}removeAttribute\('aria-hidden'\)/,
    );
  });

  test('the clearStatLoading sweep also removes aria-hidden (success 0 and error —)', () => {
    assert.match(
      BEHAVIOR,
      /function clearStatLoading\([\s\S]{0,320}\.value-num\.is-loading, \.js-val\.is-loading[\s\S]{0,320}removeAttribute\('aria-hidden'\)/,
    );
  });
});
