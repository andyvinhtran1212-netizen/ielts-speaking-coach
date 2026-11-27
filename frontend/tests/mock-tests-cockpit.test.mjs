/**
 * mock-tests-cockpit.test.mjs — the consolidated Mock Test admin cockpit.
 *
 * Source-sentinels (pages are DOM/IIFE): the new /admin/mock-tests page (exam
 * rail + 3 tabs hosting the existing surfaces embedded), the admin nav entry,
 * the chrome embed mode, and the writing-queue ?embed / ?mocklane hooks.
 *
 * LEGACYJS-0075 W2 retired `admin-mock-tests.js`: the controller assertions now
 * pin the Next cockpit (`admin-mock-tests.tsx`, `lib/admin-mock-tests-model.mjs`);
 * the retired HTML fixture assertions stay (ADR-005).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mockExamStage, mockTestsFrame, normalizeMockExamList } from '../lib/admin-mock-tests-model.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const HTML = read('public', 'pages', 'admin', 'mock-tests', 'index.html');
const COCKPIT = read('app', '(authed-admin)', '(mock-tests)', 'admin', 'mock-tests', 'admin-mock-tests.tsx');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const QUEUE_HTML = read('public', 'pages', 'admin', 'writing', 'queue.html');
// LEGACYJS-0075 W4b: admin-writing-queue.js is deleted; the Next queue and its
// model own the cockpit embed hooks.
const QUEUE_TSX = read('app', '(authed-admin-writing-queue)', 'admin', 'writing', 'queue', 'admin-writing-queue.tsx');
const Q = await import('../lib/admin-writing-queue-model.mjs');
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
});

describe('mock-tests cockpit — controller', () => {
  test('frame src per tab; review is scoped to the selected exam (embed=1)', () => {
    assert.equal(mockTestsFrame('manage'), '/admin/mock-exams?embed=1');
    assert.equal(mockTestsFrame('review', 'e1'), '/admin/mock-reviews?mock_exam_id=e1&embed=1');
    assert.equal(mockTestsFrame('writing'), '/admin/writing/queue?embed=1&mocklane=1');
    // review returns null (→ "chọn đề") when no exam is selected
    assert.equal(mockTestsFrame('review', ''), null);
  });
  test('lifecycle stage derived from status + is_open', () => {
    const { rows } = normalizeMockExamList([
      { id: 'd', status: 'draft', is_open: false },
      { id: 'l', status: 'published', is_open: true },
      { id: 'c', status: 'published', is_open: false },
    ]);
    assert.deepEqual(rows.map(mockExamStage), ['draft', 'live', 'closed']);
  });
  test('exam list from GET /admin/mock-exams', () => {
    assert.match(COCKPIT, /window\.api\.get<AdminMockExamListWire>\('\/admin\/mock-exams'\)/);
  });
});

// The frame navigates ITSELF (queue row-click → grade.html) without touching the
// src attribute. In Next, re-clicking the active tab bumps an epoch that is part
// of the iframe key, so the frame remounts at its tab's src instead of staying
// stranded on grade.html.
describe('mock-tests cockpit — re-clicking a tab reloads the frame', () => {
  test('the active tab bumps the frame epoch, and the epoch keys the iframe', () => {
    assert.match(COCKPIT, /if \(next === tab\) setFrameEpoch\(\(current\) => current \+ 1\);/);
    assert.match(COCKPIT, /<iframe ref=\{frameRef\} key=\{`\$\{frame\}:\$\{frameEpoch\}`\}/);
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
    assert.match(QUEUE_TSX, /mocklane: params\?\.get\('mocklane'\) \|\| ''/);
    assert.equal(Q.normalizeWritingQueueFilters({ mocklane: '1' }).lane, 'mock');
    assert.equal(Q.normalizeWritingQueueFilters({}).lane, 'graded');
  });
  // Embed-only chrome: the cockpit tab names the lane and the rail scopes the
  // exam, so the queue header and lane rail are redundant there. The Next page
  // renders them conditionally (no inline display:none needed).
  test('?embed=1 drops the header and the lane rail', () => {
    assert.match(QUEUE_TSX, /\{!filters\.embed && <header className="awq-header">/);
    assert.match(QUEUE_TSX, /\{!filters\.embed && <nav className="awq-lanes"/);
    assert.equal(Q.normalizeWritingQueueFilters({ embed: '1' }).embed, true);
  });
  test('the standalone queue keeps its lane rail and filters (no cockpit bleed)', () => {
    // Choosing the Mock lane on the standalone page only changes the lane; it
    // never sets embed, so the rail stays.
    assert.match(QUEUE_TSX, /const setLane = \(lane: QueueLane\) => navigate\(\{ \.\.\.filters, lane, overdue: false \}\)/);
    assert.equal(Q.normalizeWritingQueueFilters({ status: 'mock' }).embed, false);
  });
});

// Row-click inside the cockpit navigates the IFRAME (window.location is the
// frame's). Unless the flags ride along and the destination honours ?embed=1,
// the tab panel gets a whole second admin page nested inside the cockpit.
describe('writing queue — opening an essay from the cockpit stays chrome-less', () => {
  test('row click carries embed + mocklane to grade and status', () => {
    assert.match(QUEUE_TSX, /window\.location\.href = writingQueueDestination\(row, filters\)/);
    const cockpit = Q.normalizeWritingQueueFilters({ mocklane: '1', embed: '1' });
    assert.equal(Q.writingQueueDestination({ id: 'e1', status: 'pending' }, cockpit), '/admin/writing/status?essay_id=e1&from=queue&mocklane=1&embed=1');
    assert.equal(Q.writingQueueDestination({ id: 'e1', status: 'delivered' }, cockpit), '/admin/writing/grade?essay_id=e1&from=queue&mocklane=1&embed=1');
  });
  test('the destination drops the flags off the cockpit', () => {
    const href = Q.writingQueueDestination({ id: 'e1', status: 'delivered' }, Q.normalizeWritingQueueFilters({ status: 'all' }));
    assert.doesNotMatch(href, /embed=|mocklane=/);
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
  // Codex review, PR #773: status.html rendered chrome-less but its own CTA out
  // was still un-flagged, so finishing a grade re-nested the admin page.
  test('status.html keeps the flags on its "Xem kết quả" CTA', () => {
    assert.match(STATUS_HTML,
      /viewBtn\.href = _withEmbed\('\/pages\/admin\/writing\/grade\.html\?essay_id=' \+ encodeURIComponent\(_essayId\)\)/);
  });
  // The instructor queue's per-row Edit/View links are hops into grade.html too.
  test('instructor-queue row actions (Edit/View) keep the flags', () => {
    const links = INSTRUCTOR_QUEUE_HTML.match(
      /_withEmbed\('\/pages\/admin\/writing\/grade\.html\?essay_id=' \+ encodeURIComponent\(essayId\)\)/g) || [];
    assert.equal(links.length, 2, 'both the Edit and the View link must carry the flags');
  });
  // "← Writing Coach" escapes to the Writing section home — meaningless inside a
  // Mock tab, so the embed drops it rather than flagging it.
  test('grade.html hides the "Writing Coach" back-link in the embed', () => {
    assert.match(GRADE_HTML, /var back = document\.querySelector\('\.back-link'\);[\s\S]*?back\.hidden = true;/);
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

// Two bugs, one page, both invisible to a source read and obvious to a measure:
// the cockpit never loads tailwind.build.css, where .hidden lives, so every
// classList.add('hidden') here did nothing — #mt-need-exam stayed 687px tall (a
// blank slab under the roster) and #mt-loading showed "Đang tải…" forever. Its
// sibling admin pages already declare .hidden locally; this one didn't.
describe('mock-tests cockpit — .hidden must actually hide', () => {
  test('the page declares .hidden itself (it does not LINK tailwind)', () => {
    // Match the <link>, not any mention — the comment above the rule names the
    // stylesheet, and a bare substring check flagged that as a load.
    assert.doesNotMatch(HTML, /<link[^>]+tailwind\.build\.css/);
    assert.match(HTML, /\.hidden \{ display: none !important; \}/);
  });
});

// The embed reads the theme once in its anti-flash IIFE. Toggling the cockpit
// therefore left the panel on the old theme — a dark review tab under a light page.
describe('mock-tests cockpit — the frame follows the theme toggle', () => {
  test('the theme attribute is mirrored into the frame document', () => {
    assert.match(COCKPIT, /const theme = document\.documentElement\.getAttribute\('data-theme'\) \|\| 'light';\n\s+node\?\.contentDocument\?\.documentElement\.setAttribute\('data-theme', theme\);/);
  });
  test('it fires on toggle AND on every frame navigation', () => {
    assert.match(COCKPIT, /const observer = new MutationObserver\(syncFrameTheme\);\n\s+observer\.observe\(document\.documentElement, \{ attributes: true, attributeFilter: \['data-theme'\] \}\);/);
    assert.match(COCKPIT, /node\?\.addEventListener\('load', syncFrameTheme\);/);
  });
});

// …but mirroring parent → frame is only safe while the cockpit KNOWS the theme.
// The embedded writing grade page carries its OWN theme toggle, which writes
// localStorage and tells the parent nothing (Codex P2, PR #785).
describe('mock-tests cockpit — an embedded page may own the toggle too', () => {
  test('a storage write of av-theme is adopted onto the cockpit', () => {
    assert.match(COCKPIT, /const theme = localStorage\.getItem\('av-theme'\);/);
    assert.match(COCKPIT, /window\.addEventListener\('storage', adoptStoredTheme\);/);
  });
  // storage fires for EVERY key; reacting to all of them would re-read the theme
  // on unrelated writes (auth tokens, drafts) and fight the observer.
  test('it ignores writes to other keys', () => {
    assert.match(COCKPIT, /if \(event\.key !== 'av-theme'\) return;/);
  });
  // A junk/absent value must not blank the attribute out from under the page.
  test('only a valid theme is adopted', () => {
    assert.match(COCKPIT, /if \(theme === 'light' \|\| theme === 'dark'\) document\.documentElement\.setAttribute\('data-theme', theme\);/);
  });
});
