/**
 * mock-tests-cockpit.test.mjs — the consolidated Mock Test admin cockpit.
 *
 * Source-sentinels (pages are DOM/IIFE): the new /admin/mock-tests page (exam
 * rail + 3 tabs hosting the existing surfaces embedded), the admin nav entry,
 * the chrome embed mode, and the writing-queue ?embed / ?mocklane hooks.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const HTML = read('public', 'pages', 'admin', 'mock-tests', 'index.html');
const JS = read('public', 'js', 'admin-mock-tests.js');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const QUEUE_HTML = read('public', 'pages', 'admin', 'writing', 'queue.html');
const QUEUE_JS = read('public', 'js', 'admin-writing-queue.js');
const GRADE_HTML = read('public', 'pages', 'admin', 'writing', 'grade.html');
const STATUS_HTML = read('public', 'pages', 'admin', 'writing', 'status.html');
const INSTRUCTOR_QUEUE_HTML = read('public', 'pages', 'admin', 'writing', 'instructor-queue.html');

describe('mock-tests cockpit — page shell', () => {
  test('uses the admin chrome (active=mock-tests) + design-system sheets', () => {
    assert.match(HTML, /<aver-admin-chrome active="mock-tests"/);
    assert.match(HTML, /href="\/css\/aver-design\/tokens\.css"/);
    assert.match(HTML, /href="\/css\/aver-design\/admin-components\.css"/);
  });
  test('exam rail with stage filter chips + list', () => {
    assert.match(HTML, /class="mt-rail"/);
    for (const s of ['all', 'draft', 'live', 'closed']) {
      assert.match(HTML, new RegExp(`data-stage="${s}"`), `missing chip ${s}`);
    }
    assert.match(HTML, /id="mt-list"/);
  });
  test('three tabs (manage / review / writing) + one embedded frame', () => {
    for (const t of ['manage', 'review', 'writing']) {
      assert.match(HTML, new RegExp(`data-tab="${t}"`), `missing tab ${t}`);
    }
    assert.match(HTML, /id="mt-frame"/);
    assert.match(HTML, /id="mt-need-exam"/);   // review with no exam selected
  });
  test('loads the cockpit controller', () => {
    assert.match(HTML, /src="\/js\/admin-mock-tests\.js"/);
  });
});

describe('mock-tests cockpit — controller', () => {
  test('frame src per tab; review is scoped to the selected exam (embed=1)', () => {
    assert.match(JS, /mock-exams\/index\.html\?embed=1/);
    assert.match(JS, /mock-reviews\/index\.html\?mock_exam_id=' \+ encodeURIComponent\(id\) \+ '&embed=1/);
    assert.match(JS, /writing\/queue\.html\?embed=1&mocklane=1/);
    // review returns null (→ "chọn đề") when no exam is selected
    assert.match(JS, /review:\s*function \(id\) \{ return id \?/);
  });
  test('lifecycle stage derived from status + is_open', () => {
    assert.match(JS, /function stageOf\(ex\)[\s\S]*?status !== 'published'[\s\S]*?is_open \? 'live' : 'closed'/);
  });
  test('exam list from GET /admin/mock-exams', () => {
    assert.match(JS, /api\.get\('\/admin\/mock-exams'\)/);
  });
  test('inits Supabase so window.api carries the admin token (rail is require_admin)', () => {
    assert.match(JS, /initSupabase\('https:\/\/huwsmtubwulikhlmcirx/);
  });
});

describe('mock-tests — admin nav entry', () => {
  test('mock-tests section + subsections registered in the nav + VALID_ACTIVE', () => {
    assert.match(CHROME, /section: 'mock-tests', label: 'Mock Test'/);
    assert.match(CHROME, /'grammar', 'mock-tests'/);   // VALID_ACTIVE
    for (const slug of ['manage', 'review', 'writing']) {
      assert.match(CHROME, new RegExp(`slug: '${slug}'`), `missing subsection ${slug}`);
    }
  });
  test('chrome embed mode renders slot only (no nav)', () => {
    assert.match(CHROME, /this\.hasAttribute\('embed'\)[\s\S]*?'<style>:host\{display:block\}<\/style><slot><\/slot>'/);
  });
});

describe('writing queue — cockpit embed hooks', () => {
  test('?embed=1 sets the chrome embed attribute (before the module upgrades)', () => {
    assert.match(QUEUE_HTML, /get\('embed'\) === '1'[\s\S]*?setAttribute\('embed', ''\)/);
  });
  test('?mocklane=1 opens the Mock lane on load', () => {
    assert.match(QUEUE_JS, /get\('mocklane'\) === '1'/);
    assert.match(QUEUE_JS, /if \(_mocklane\) \{ _stripEmbedChrome\(\); setMockLane\(\); return; \}/);
  });
  // Mock-only embed: the cockpit tab names the lane and the rail scopes the
  // exam, so the queue's lane rail + filter row are redundant there.
  test('?mocklane=1 strips the lane rail and the filter row', () => {
    const body = QUEUE_JS.match(/function _stripEmbedChrome\(\) \{([\s\S]*?)\n\}/);
    assert.ok(body, '_stripEmbedChrome() not found — sentinel is stale');
    assert.match(body[1], /querySelectorAll\('\.adm-subtabs, \.q-toolbar'\)/);
  });
  // Must be inline display:none, not the hidden attribute: both rows set
  // `display: flex` in the author stylesheet, which beats the UA's
  // `[hidden] { display: none }` — hidden alone leaves them on screen.
  test('embed chrome is stripped with inline display:none (author CSS beats [hidden])', () => {
    const body = QUEUE_JS.match(/function _stripEmbedChrome\(\) \{([\s\S]*?)\n\}/);
    assert.match(body[1], /style\.display = 'none'/);
  });
  test('the standalone queue keeps its lane rail and filters (no cockpit bleed)', () => {
    // _stripEmbedChrome fires from the ?mocklane=1 branch ONLY: the Mock chip's
    // own click handler (setMockLane) must never strip the chrome, or clicking
    // Mock on the standalone page would strand the admin there.
    const body = QUEUE_JS.match(/function setMockLane\(\) \{([\s\S]*?)\n\}/);
    assert.ok(body, 'setMockLane() not found — sentinel is stale');
    assert.ok(!body[1].includes('_stripEmbedChrome'), 'setMockLane() must not strip the embed chrome');
  });
});

// Row-click inside the cockpit navigates the IFRAME (window.location is the
// frame's). Unless the flags ride along and the destination honours ?embed=1,
// the tab panel gets a whole second admin page nested inside the cockpit.
describe('writing queue — opening an essay from the cockpit stays chrome-less', () => {
  test('openEssay carries embed + mocklane to grade.html and status.html', () => {
    const body = QUEUE_JS.match(/function openEssay\(essayId\) \{([\s\S]*?)\n\}/);
    assert.ok(body, 'openEssay() not found — sentinel is stale');
    assert.match(body[1], /_withEmbed\('\/pages\/admin\/writing\/status\.html\?essay_id=/);
    assert.match(body[1], /_withEmbed\('\/pages\/admin\/writing\/grade\.html\?essay_id=/);
  });
  test('_withEmbed forwards both flags and no-ops off the cockpit', () => {
    const body = QUEUE_JS.match(/function _withEmbed\(url\) \{([\s\S]*?)\n\}/);
    assert.ok(body, '_withEmbed() not found — sentinel is stale');
    assert.match(body[1], /get\('embed'\) === '1'/);
    assert.match(body[1], /get\('mocklane'\) === '1'/);
    assert.match(body[1], /if \(!out\.length\) return url;/);   // standalone → untouched
  });
  // grade.html and status.html are both row-click destinations, so both need
  // the hook queue.html already had — otherwise the flag arrives and is ignored.
  for (const [name, html] of [
    ['grade.html', GRADE_HTML],
    ['status.html', STATUS_HTML],
    ['instructor-queue.html', INSTRUCTOR_QUEUE_HTML],
  ]) {
    test(`${name} honours ?embed=1 by putting the chrome in embed mode`, () => {
      assert.match(html, /get\('embed'\) === '1'[\s\S]*?setAttribute\('embed', ''\)/);
    });
  }
  // grade → (release claim) → instructor-queue → (claim) → grade is a LOOP: a
  // flag dropped at either hop re-nests a whole admin page in the tab panel.
  test('the instructor-claim loop keeps the flags at both hops', () => {
    assert.match(GRADE_HTML, /_withEmbed\('\/pages\/admin\/writing\/instructor-queue\.html'\)/);
    assert.match(INSTRUCTOR_QUEUE_HTML,
      /_withEmbed\('\/pages\/admin\/writing\/grade\.html\?essay_id=' \+ encodeURIComponent\(review\.essay_id\)\)/);
  });
  test('instructor-queue._withEmbed forwards both flags and no-ops off the cockpit', () => {
    const body = INSTRUCTOR_QUEUE_HTML.match(/function _withEmbed\(url\) \{([\s\S]*?)\n    \}/);
    assert.ok(body, '_withEmbed() not found in instructor-queue — sentinel is stale');
    assert.match(body[1], /get\('embed'\) === '1'/);
    assert.match(body[1], /get\('mocklane'\) === '1'/);
    assert.match(body[1], /if \(!out\.length\) return url;/);   // standalone → untouched
  });
  test('grade.html keeps the flags on every hop out (next essay + back to queue)', () => {
    assert.match(GRADE_HTML, /_withEmbed\('\/pages\/admin\/writing\/grade\.html\?essay_id=' \+ encodeURIComponent\(nxt\)\)/);
    assert.match(GRADE_HTML, /_withEmbed\('\/pages\/admin\/writing\/queue\.html'\)/);
    // The back link's href is static in the markup — it must be re-pointed.
    assert.match(GRADE_HTML, /back\.href = _withEmbed\('\/pages\/admin\/writing\/queue\.html'\)/);
  });
});
