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
    assert.match(QUEUE_JS, /if \(_mocklane\) \{ setMockLane\(\); return; \}/);
  });
});
