/**
 * exam-nothing-saved-alarm.test.mjs — telling a student the server has NONE of
 * their work, while there is still time to act.
 *
 * PROD 2026-07-26. A student sat a full 30-minute Listening section and a
 * 60-minute Reading section, both auto-submitted, and both were graded 0
 * because the server held ZERO answers. No error was logged anywhere, no other
 * student was affected, and nothing on his screen said anything was wrong: the
 * per-question cue only speaks for a question whose OWN save failed, so
 * "nothing at all is reaching the server" — the one failure a student can still
 * act on — had no voice.
 *
 * Both exam pages run inside the mock runner's iframe as large IIFEs driving a
 * live DOM, and the branch that matters only fires when every save fails for
 * 45s. Source-sentinels pin the SHAPE so a refactor cannot quietly remove it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pub = (...p) => readFileSync(join(__dirname, '..', 'public', ...p), 'utf8');

const LIS = pub('js', 'listening-test-player.js');
const LIS_HTML = pub('pages', 'listening-test.html');
const READ = pub('js', 'reading-exam.js');
const READ_HTML = pub('pages', 'reading-exam.html');
const READ_CSS = pub('css', 'reading-exam.css');

const PAGES = [
  {
    name: 'listening',
    js: LIS, html: LIS_HTML,
    hostId: 'ft-nothing-saved',
    tried: /STATE\.triedSaveAt === null\) STATE\.triedSaveAt = Date\.now\(\)/,
    confirmed: /STATE\.serverHasOne = true;/,
    gate: /if \(STATE\.serverHasOne \|\| !overdue \|\| STATE\.submitting\)/,
    watch: /startNothingSavedWatch\(\)/,
  },
  {
    name: 'reading',
    js: READ, html: READ_HTML,
    hostId: 'exam-nothing-saved',
    tried: /SESSION\.tried_save_at === null\) SESSION\.tried_save_at = Date\.now\(\)/,
    confirmed: /SESSION\.server_has_one = true;/,
    gate: /if \(SESSION\.server_has_one \|\| !overdue \|\| SESSION\.timer_locked\)/,
    watch: /_startNothingSavedWatch\(\)/,
  },
];

for (const p of PAGES) {
  describe(`${p.name} — "the server has none of your work" alarm`, () => {
    test('the clock starts on the first save ATTEMPT, not on page load', () => {
      // Anchoring on load would fire for a student who has simply not answered
      // yet — the normal opening minutes of a section, not a fault.
      assert.match(p.js, p.tried);
    });

    test('one CONFIRMED save disarms it permanently', () => {
      // Proof the pipe works. Anything after that is a per-question problem and
      // belongs to the existing amber cue, not to this alarm.
      assert.match(p.js, p.confirmed);
    });

    test('it stays silent while the server has something, or after submit', () => {
      assert.match(p.js, p.gate);
    });

    test('it is re-checked on a timer, not only on a failed save', () => {
      // The failure being detected is that saves stop landing — so the check
      // cannot depend on a save completing to run.
      assert.match(p.js, /setInterval\(\s*_?renderNothingSavedAlarm,\s*10000\)/);
      assert.match(p.js, p.watch);
    });

    test('it fires late enough to be certain, early enough to matter', () => {
      const m = p.js.match(/NOTHING_SAVED_AFTER_MS\s*=\s*(\d+)/);
      assert.ok(m, 'threshold constant missing');
      const ms = Number(m[1]);
      // The retry ladder + debounce resolve a healthy save many times over
      // inside this; much longer and it eats the exam it exists to save.
      assert.ok(ms >= 20000 && ms <= 90000, `threshold ${ms}ms is out of range`);
    });

    test('it offers a remedy, not just a warning', () => {
      // A warning with no remedy tells the student something they cannot fix.
      assert.match(p.js, /Gửi lại toàn bộ/);
      assert.match(p.js, /_?resendEverything/);
    });

    test('it names the consequence in the student\'s own language', () => {
      assert.match(p.js, /CHƯA NHẬN ĐƯỢC CÂU TRẢ LỜI NÀO/);
      assert.match(p.js, /chấm 0/);
      assert.match(p.js, /BÁO GIÁM THỊ NGAY/);
    });

    test('it has its own host, separate from the per-question cue', () => {
      // Reusing the amber note would let one message overwrite the other, and
      // they say different things.
      assert.ok(p.html.includes(`id="${p.hostId}"`), `missing #${p.hostId}`);
      assert.match(p.html, new RegExp(`id="${p.hostId}"[^>]*hidden`));
    });

    test('screen readers are interrupted, not merely informed', () => {
      const at = p.html.indexOf(`id="${p.hostId}"`);
      const tag = p.html.slice(p.html.lastIndexOf('<', at),
                               p.html.indexOf('>', at) + 1);
      assert.match(tag, /role="alert"/);
      assert.match(tag, /aria-live="assertive"/);
    });
  });
}

describe('the alarm is visually louder than the per-question cue', () => {
  test('listening uses the error token, not the warning one', () => {
    const css = LIS_HTML.slice(LIS_HTML.indexOf('.ft-nothing-saved'));
    const block = css.slice(0, css.indexOf('}'));
    assert.match(block, /--av-error/);
    assert.doesNotMatch(block, /--av-warning/);
  });

  test('reading gets a heavier border than the amber note', () => {
    const block = READ_CSS.slice(READ_CSS.indexOf('.exam-chrome .exam-palette__nothing'));
    assert.match(block.slice(0, block.indexOf('}')), /border:\s*2px/);
  });

  test('the retry button reuses the existing styled class, not an invented one', () => {
    assert.match(READ, /btn\.className = 'exam-unsaved-retry'/);
    assert.ok(READ_CSS.includes('.exam-chrome .exam-unsaved-retry'));
  });
});
