/**
 * frontend/tests/sprint-20-6-l3-exam-ui.test.mjs
 *
 * Sprint 20.6 — L3 exam UI sentinel (cluster 20.x). Static-analysis pins on
 * the structural pieces + the key backend-wiring contracts so the
 * approved-mockup fidelity stays intact when 20.7+ extends the surface.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');


describe('Sprint 20.6 — L3 test list page (reading-test.html)', () => {
  const html = read('frontend/pages/reading-test.html');
  test('uses the student chrome with active="reading"', () => {
    assert.match(html, /<aver-chrome active="reading"><\/aver-chrome>/);
  });
  test('library switcher shows L1/L2/L3 with L3 active', () => {
    assert.match(html, /class="rv-libnav"/);
    assert.match(html, /href="\/pages\/reading-vocab\.html"/);
    assert.match(html, /href="\/pages\/reading-skill\.html"/);
    assert.match(html, /is-active[^>]*aria-current="page"[^>]*>Full Tests/);
  });
  test('module filter ships Academic + GT-disabled (Phase B)', () => {
    assert.match(html, /<option value="academic">Academic/);
    assert.match(html, /<option value="general_training" disabled/);
  });
  test('ships loading/empty/error states + the grid + page JS', () => {
    for (const id of ['state-loading', 'state-empty', 'state-error', 'rv-grid']) {
      assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
    }
    assert.match(html, /src="\/js\/reading-test\.js"/);
  });
});


describe('Sprint 20.6 — L3 list page JS (reading-test.js)', () => {
  const js = read('frontend/js/reading-test.js');
  test('fetches the L3 list endpoint with module filter', () => {
    assert.match(js, /window\.api\.get\(`?\/api\/reading\/test/);
    assert.match(js, /qs\.set\('module'/);
  });
  test('deep-links cards to the exam page by test_id', () => {
    assert.match(js, /reading-exam\.html\?test_id=/);
  });
  test('escapes interpolated card content (XSS guard)', () => {
    assert.match(js, /function escapeHtml/);
  });
});


describe('Sprint 20.6 — library switcher: L1/L2 pages add the Full Tests entry', () => {
  test('L1 page (reading-vocab.html) links L3', () => {
    const html = read('frontend/pages/reading-vocab.html');
    assert.match(html, /href="\/pages\/reading-test\.html"[^>]*>Full Tests/);
  });
  test('L2 page (reading-skill.html) links L3', () => {
    const html = read('frontend/pages/reading-skill.html');
    assert.match(html, /href="\/pages\/reading-test\.html"[^>]*>Full Tests/);
  });
});


describe('Sprint 20.6 — production exam page (reading-exam.html)', () => {
  const html = read('frontend/pages/reading-exam.html');
  test('uses the dedicated exam chrome — NOT the student aver-chrome', () => {
    assert.match(html, /class="exam-chrome"/);
    assert.ok(!/<aver-chrome\b/.test(html));
    assert.ok(!/<aver-admin-chrome\b/.test(html));
  });
  test('links both exam CSS files (mockup chrome + production additions)', () => {
    assert.match(html, /href="\/css\/reading-exam-mockup\.css"/);
    assert.match(html, /href="\/css\/reading-exam\.css"/);
  });
  test('ships ALL state-shells (loading/error/prestart/inprogress/results)', () => {
    for (const id of ['state-loading', 'state-error', 'state-prestart',
                       'state-inprogress', 'state-results']) {
      assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
    }
  });
  test('production top bar + split-view + palette + Hide overlay', () => {
    assert.match(html, /id="exam-timer"[^>]*data-state="normal"/);
    assert.match(html, /id="exam-timer-wrap"[^>]*hidden/);
    assert.match(html, /id="exam-passage"/);
    assert.match(html, /id="exam-questions"/);
    assert.match(html, /id="exam-divider"/);
    assert.match(html, /id="exam-palette"/);
    assert.match(html, /id="exam-hide-overlay"/);
  });
  test('ships submit confirmation + Help modals (Q8 + Q6)', () => {
    assert.match(html, /id="exam-submit-modal"/);
    assert.match(html, /id="exam-help-modal"/);
    assert.match(html, /id="exam-submit-confirm"/);
    assert.match(html, /id="exam-help-close"/);
  });
  test('ports the context menu + note popover from the mockup', () => {
    assert.match(html, /id="exam-context-menu"/);
    assert.match(html, /id="exam-note-popover"/);
    assert.match(html, /data-action="highlight"/);
    assert.match(html, /data-action="note"/);
  });
});


describe('Sprint 20.6 — exam page JS (reading-exam.js)', () => {
  const js = read('frontend/js/reading-exam.js');

  test('boot wires combined GET /test/{id}/boot + POST /attempts (start)', () => {
    // reading-access-tracking — boot/start now use getWith/postWith to carry
    // the locked-test X-Reading-Password header (F1).
    assert.match(js, /window\.api\.getWith\(\s*'\/api\/reading\/test\/'/);
    assert.match(js, /\/boot'/);
    assert.match(js, /bootPayload\.in_progress/);
    assert.match(js, /window\.api\.postWith\(\s*'\/api\/reading\/test\/'\s*\+\s*encodeURIComponent\(SESSION\.test_id\)\s*\+\s*'\/attempts', null, _pwHeaders\(\)\)/);
  });
  test('auto-save: PATCH /answers debounced (500ms) on input/change', () => {
    assert.match(js, /\/api\/reading\/test\/attempts\//);
    assert.match(js, /\/answers/);
    assert.match(js, /window\.api\.patch/);
    assert.match(js, /setTimeout[\s\S]{0,200}500/);
  });
  test('submit wires POST .../submit and renders results inline', () => {
    assert.match(js, /window\.api\.post\(\s*\n?\s*'\/api\/reading\/test\/attempts\/'\s*\+\s*encodeURIComponent\(SESSION\.attempt_id\)\s*\+\s*'\/submit'/);
    assert.match(js, /function renderResults/);
    assert.match(js, /results-band/);
    assert.match(js, /results-by-part/);
    assert.match(js, /results-skill/);
  });
  test('production timer counts down from started_at, escalates at 10:00 / 5:00, auto-submits at 0', () => {
    assert.match(js, /function startTimer/);
    assert.match(js, /Date\.parse\(SESSION\.started_at\)/);
    assert.match(js, /remaining <= 600/);
    assert.match(js, /remaining <= 300/);
    assert.match(js, /autoSubmit\(\)/);
  });
  test('time-up locks the chrome (.is-locked) and stops the interval', () => {
    assert.match(js, /classList\.add\(\s*['"]is-locked['"]\s*\)/);
    assert.match(js, /clearInterval\(SESSION\.timer_interval\)/);
  });
  test('Q5 server-guard 422 is surfaced gracefully (not silently logged)', () => {
    assert.match(js, /e\.status\s*===\s*422/);
    assert.match(js, /hết giờ/);
  });
  test('highlight implementation is XSS-safe (TreeWalker + textContent, no innerHTML on highlight span)', () => {
    assert.match(js, /createTreeWalker/);
    assert.match(js, /span\.textContent\s*=/);
    // Specifically the highlight wrap path uses textContent for the span,
    // never innerHTML — innerHTML lives only on the container-clear paths
    // (host.innerHTML = '') which are XSS-safe (empty string).
    // Sprint 20.13a A5 extended the className to carry a per-highlight
    // colour class (`'exam-highlight is-user ' + colorClass`); the XSS
    // claim is unchanged (still textContent), only the class string
    // grew a trailing space + variable. The regex below accepts both
    // the pre-20.13a and the post-20.13a forms so the 20.6 contract
    // still pins the right line.
    assert.match(js, /class="exam-highlight is-user"|className\s*=\s*'exam-highlight is-user(?:\s*['"])?/);
  });
  test('draggable split divider clamps 30-70% and persists in sessionStorage', () => {
    assert.match(js, /Math\.max\(30,\s*Math\.min\(70/);
    assert.match(js, /sessionStorage\.setItem\(\s*['"]exam-split-pct['"]/);
  });
});


describe('Sprint 20.6 — production CSS (reading-exam.css)', () => {
  const css = read('frontend/css/reading-exam.css');
  test('ships state-shell + card scaffolds for loading/prestart/results', () => {
    assert.match(css, /\.exam-state-shell\s*\{/);
    assert.match(css, /\.exam-card\s*\{/);
    assert.match(css, /\.exam-card--results/);
  });
  test('results layout: band-row + by-part grid + skill grid + review list', () => {
    assert.match(css, /\.exam-results-band-row/);
    assert.match(css, /\.exam-results-bygrid/);
    assert.match(css, /\.exam-results-skillgrid/);
    assert.match(css, /\.exam-results-skillrow__bar-fill/);
    assert.match(css, /\.exam-results-review/);
  });
  test('modals: submit confirmation + Help (backdrop + panel)', () => {
    assert.match(css, /\.exam-modal\s*\{/);
    assert.match(css, /\.exam-modal__backdrop/);
    assert.match(css, /\.exam-modal__panel/);
  });
  test('Hide overlay + locked state (time-up disables inputs)', () => {
    assert.match(css, /\.exam-hide-overlay/);
    assert.match(css, /\.exam-chrome\.is-locked/);
    assert.match(css, /pointer-events:\s*none/);
  });
});
