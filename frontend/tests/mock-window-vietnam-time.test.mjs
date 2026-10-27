/**
 * A-MOCK — retake windows are Vietnam wall time on every admin surface.
 *
 * Both the Next dialog and the compatibility script used to turn the
 * datetime-local value into an instant with the BROWSER's zone
 * (`new Date(local).toISOString()`), so an admin abroad shifted the window by
 * their offset, and the dialog displayed the deadline in that zone too. The
 * window is now sent with an explicit +07:00 (as Writing deadlines are) and
 * displayed in Asia/Ho_Chi_Minh. Model behaviour is pinned in
 * admin-mock-exams-next-model.test.mjs; this pins the call sites.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIALOG = readFileSync(join(ROOT, 'app', '(authed-admin-mock-exams)', 'admin', 'mock-exams',
  'retake-assignment-dialog.tsx'), 'utf8');
const LEGACY = readFileSync(join(ROOT, 'public', 'js', 'admin-mock-exams.js'), 'utf8');

describe('mock retake window timezone', () => {
  test('the Next dialog sends and shows Vietnam time', () => {
    assert.match(DIALOG, /vietnamLocalToIso\(openUntil\)/);
    assert.match(DIALOG, /vietnamLocalToIso\(openFrom\)/);
    assert.match(DIALOG, /useState\(\(\) => vietnamDateTimeIn\(7\)\)/);
    assert.match(DIALOG, /formatVietnamDateTime\(row\.openUntil\)/);
    assert.doesNotMatch(DIALOG, /localToIso\(|localDateTimeIn\(|toLocaleString\(/);
  });

  test('the compatibility script no longer uses the browser zone', () => {
    assert.doesNotMatch(LEGACY, /new Date\(localVal\)\.toISOString\(\)/);
    assert.match(LEGACY, /'\+07:00'/);
    assert.match(LEGACY, /timeZone: 'Asia\/Ho_Chi_Minh'/);
    assert.doesNotMatch(LEGACY, /d\.getHours\(\)/);
  });
});
