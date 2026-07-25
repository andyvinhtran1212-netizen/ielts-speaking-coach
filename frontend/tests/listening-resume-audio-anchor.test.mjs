/**
 * listening-resume-audio-anchor.test.mjs — a resume must not give back time.
 *
 * A1 gave Listening a resume path. Two ways that can quietly hand a student
 * something the exam already spent (Codex review, PR #834):
 *
 *   · the remounted <audio> starts at 0, so a refreshed candidate replays audio
 *     they had already heard — in the same file that disables scrubbing to
 *     enforce the full-test single-shot contract;
 *   · "Bắt đầu test" / "Bắt đầu lại từ đầu" is still on screen inside a mock.
 *     That POST ABANDONS the answered attempt and mints a blank one, which
 *     attach_attempt() then refuses ("không thể thay bằng bài trống") — leaving
 *     the sitting bound to the abandoned attempt and the section unusable.
 *     Cancelling a sitting is the admin's "Huỷ lượt", not a button in the paper.
 *
 * Source-sentinels: both are timing/lifecycle properties of the live page.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(__dirname, '..', 'public', 'js', f), 'utf8');
const LIS = read('listening-test-player.js');
const RD = read('reading-exam.js');

describe('resume — audio comes back where the student left it', () => {
  test('a mock anchors on the shared classroom clock, first and always', () => {
    assert.match(LIS, /if \(window\.MockHook && MockHook\.active\(\) && MockHook\.sectionElapsedSeconds\) \{\s*\n\s*return await MockHook\.sectionElapsedSeconds\('listening'\);/);
  });

  test('a standalone FULL test anchors on its own started_at', () => {
    assert.match(LIS, /async function resumeAudioOffsetSeconds\(\)/);
    assert.match(LIS, /const startedAt = STATE\.resumable && STATE\.resumable\.started_at;/);
    assert.match(LIS, /Math\.floor\(\(Date\.now\(\) - started\) \/ 1000\)/);
  });

  test('mini / drill practice deliberately keeps free replay', () => {
    assert.match(LIS, /if \(STATE\.scrub\) return null;/);
  });

  test('the offset is computed before the seek, not inlined in the mock branch', () => {
    assert.match(LIS, /const elapsed = await resumeAudioOffsetSeconds\(\);/);
  });
});

describe('resume — restart is not a student action inside a mock', () => {
  test('Listening hides the start/restart button when resuming a mock', () => {
    assert.match(LIS, /if \(window\.MockHook && MockHook\.active\(\)\) \{\s*\n\s*const restart = \$\('btn-start'\);\s*\n\s*if \(restart\) restart\.hidden = true;/);
  });

  test('Reading hides "Bắt đầu lại từ đầu" when resuming a mock', () => {
    assert.match(RD, /var inMock = !!\(window\.MockHook && MockHook\.active\(\)\);/);
    assert.match(RD, /startBtn\.hidden = hasResumable && inMock;/);
  });

  test('outside a mock both restart affordances are untouched', () => {
    // standalone practice may still start over — losing practice work is fine
    assert.match(RD, /\? 'Bắt đầu lại từ đầu'/);
    assert.match(LIS, /\$\('ft-resume-btn'\)\.hidden = false;/);
  });
});
