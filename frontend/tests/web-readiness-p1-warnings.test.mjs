/**
 * web-readiness-p1-warnings.test.mjs — P1 W-0 safety banners.
 *
 * Pins that import warnings (dropped rows / unrecognised type labels) surface
 * as a RED banner on the admin preview — never silent. Reading gets a new
 * .ar-warnings banner; Listening already renders import_result.warnings.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...r) => readFileSync(join(__dirname, '..', ...r), 'utf8');

const READING_JS = read('js', 'admin-reading.js');
const READING_CSS = read('css', 'admin-reading.css');
const LISTENING_JS = read('js', 'admin-listening-fulltest-import.js');


describe('P1 — reading import warnings banner (W-0)', () => {
  test('renders res.warnings into a red .ar-warnings banner', () => {
    assert.match(READING_JS, /var warns = \(res && res\.warnings\) \|\| \[\]/);
    assert.match(READING_JS, /id = 'ar-warnings'/);
    assert.match(READING_JS, /warns\.map\(/);
  });
  test('warnings do NOT block commit (non-fatal; recovered rows still importable)', () => {
    // commit.disabled is only set by validation_errors, not warnings.
    assert.doesNotMatch(READING_JS, /warns[\s\S]{0,80}commit\.disabled = true/);
  });
  test('.ar-warnings styled red (error token)', () => {
    assert.match(READING_CSS, /\.ar-warnings\s*\{[^}]*var\(--av-error/);
  });
});


describe('P1 — listening import already surfaces warnings', () => {
  test('listening fulltest import renders p.warnings', () => {
    assert.match(LISTENING_JS, /p\.warnings/);
    assert.match(LISTENING_JS, /fi-banner--warn/);
  });
});
