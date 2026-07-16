/**
 * back-nav-origin.test.mjs — back buttons must land in the mode you came from.
 *
 * Three pages are reachable from MORE THAN ONE entry point, so a hardcoded back
 * target is wrong for every entry but one:
 *   • reading-exam   ← full-test library AND mini-test library
 *   • reading-review ← reading-exam (either library) AND a mock-exam result
 *   • admin writing sub-pages ← the Writing section AND the admin sidebar
 *
 * reading-review's old target (/pages/reading.html) never existed at all — a 404
 * dead end. These tests EXECUTE the real wireBack() lifted from the shipped JS
 * rather than grepping for hrefs: the earlier audit was fooled twice by static
 * hrefs that JS rewrites at runtime.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');

const lift = (src, re, what) => {
  const m = src.match(re);
  assert.ok(m, `could not lift ${what} — did the shape change?`);
  return m[0];
};

const REVIEW_JS = read('public', 'js', 'reading-review.js');
const EXAM_JS = read('public', 'js', 'reading-exam.js');

// ── reading-review.wireBack() ────────────────────────────────────────
const reviewSrc = lift(
  REVIEW_JS,
  /var BACK_TARGETS = \{[\s\S]*?el\.textContent = t\.label; \}\n  \}/,
  'reading-review wireBack',
);
function reviewBack(search) {
  const el = { href: null, textContent: null };
  const $ = (id) => (id === 'rr-back' ? el : null);
  const win = { location: { search } };
  new Function('$', 'window', 'URLSearchParams', 'encodeURIComponent',
    `${reviewSrc}\nwireBack();`)($, win, URLSearchParams, encodeURIComponent);
  return el;
}

// ── reading-exam.wireBack() ──────────────────────────────────────────
const examSrc = lift(
  EXAM_JS,
  /var BACK_TARGETS = \{ full[\s\S]*?a\.href = href; \}\);\n  \}/,
  'reading-exam wireBack',
);
function examBack(search) {
  const links = [{ href: 'x' }, { href: 'x' }, { href: 'x' }];
  const doc = { querySelectorAll: () => links };
  const win = { location: { search } };
  new Function('document', 'window', 'URLSearchParams',
    `${examSrc}\nwireBack();`)(doc, win, URLSearchParams);
  return [...new Set(links.map((l) => l.href))];
}

describe('reading-review — back follows the entry point', () => {
  test('mini-test taker goes back to the MINI library, not the full one', () => {
    assert.equal(reviewBack('?attempt_id=A&from=mini').href, '/pages/reading-mini-test.html');
  });
  test('full-test taker goes back to the full library', () => {
    assert.equal(reviewBack('?attempt_id=A&from=full').href, '/pages/reading-test.html');
  });
  test('mock taker goes back to THEIR sitting, not a test shelf', () => {
    assert.equal(reviewBack('?attempt_id=A&from=mock&sitting=S9').href,
      '/pages/mock-result.html?sitting=S9');
  });
  test('a legacy link with no origin still lands on a page that EXISTS', () => {
    // The bug: this used to be /pages/reading.html, which is a 404.
    const el = reviewBack('?attempt_id=A');
    assert.equal(el.href, '/pages/reading-test.html');
    assert.ok(existsSync(join(root, 'public', 'pages', 'reading-test.html')));
    assert.ok(!existsSync(join(root, 'public', 'pages', 'reading.html')),
      'reading.html must stay non-existent — nothing may point at it again');
  });
  test('mock without a sitting id degrades to a real page, not a broken one', () => {
    assert.equal(reviewBack('?attempt_id=A&from=mock').href, '/pages/reading-test.html');
  });
  test('?from= is allowlisted — never navigated to raw (open redirect)', () => {
    for (const evil of ['//evil.com', 'javascript:alert(1)', 'https://evil.com', '../../etc']) {
      assert.equal(reviewBack(`?attempt_id=A&from=${encodeURIComponent(evil)}`).href,
        '/pages/reading-test.html', `raw ?from=${evil} must not survive`);
    }
  });
});

describe('reading-exam — back follows the library you came from', () => {
  test('mini library entry backs to the mini library', () => {
    assert.deepEqual(examBack('?test_id=T&from=mini'), ['/pages/reading-mini-test.html']);
  });
  test('full library entry backs to the full library', () => {
    assert.deepEqual(examBack('?test_id=T&from=full'), ['/pages/reading-test.html']);
  });
  test('no origin → full library (the historical default)', () => {
    assert.deepEqual(examBack('?test_id=T'), ['/pages/reading-test.html']);
  });
  test('?from= is allowlisted here too', () => {
    assert.deepEqual(examBack('?test_id=T&from=//evil.com'), ['/pages/reading-test.html']);
  });
});

// ── listening mirrors reading: same dual library + mock, same fix ────
const LREVIEW_JS = read('public', 'js', 'listening-review.js');
const LPLAYER_JS = read('public', 'js', 'listening-test-player.js');

const lReviewSrc = lift(
  LREVIEW_JS,
  /var BACK_TARGETS = \{[\s\S]*?el\.textContent = t\.label; \}\n  \}/,
  'listening-review wireBack',
);
function lReviewBack(search) {
  const el = { href: null, textContent: null };
  const $ = (id) => (id === 'lr-back' ? el : null);
  const win = { location: { search } };
  new Function('$', 'window', 'URLSearchParams', 'encodeURIComponent',
    `${lReviewSrc}\nwireBack();`)($, win, URLSearchParams, encodeURIComponent);
  return el;
}

const lPlayerSrc = lift(
  LPLAYER_JS,
  /const BACK_TARGETS = \{ full[\s\S]*?a\.href = href; \}\);\n\}/,
  'listening player wireBack',
);
function lPlayerBack(search) {
  const links = [{ href: 'x' }, { href: 'x' }, { href: 'x' }];
  const doc = { querySelectorAll: () => links };
  const win = { location: { search } };
  new Function('document', 'window', 'URLSearchParams',
    `${lPlayerSrc}\nwireBack();`)(doc, win, URLSearchParams);
  return [...new Set(links.map((l) => l.href))];
}

describe('listening-review — back follows the entry point', () => {
  test('mini-test taker goes back to the MINI library', () => {
    assert.equal(lReviewBack('?attempt_id=A&from=mini').href, '/pages/listening-mini-test.html');
  });
  test('mock taker goes back to THEIR sitting, not a test shelf', () => {
    assert.equal(lReviewBack('?attempt_id=A&from=mock&sitting=S9').href,
      '/pages/mock-result.html?sitting=S9');
  });
  test('legacy link with no origin → the full library (unchanged behaviour)', () => {
    assert.equal(lReviewBack('?attempt_id=A').href, '/pages/listening-tests.html');
  });
  test('?from= is allowlisted — never navigated to raw', () => {
    for (const evil of ['//evil.com', 'javascript:alert(1)', 'https://evil.com']) {
      assert.equal(lReviewBack(`?attempt_id=A&from=${encodeURIComponent(evil)}`).href,
        '/pages/listening-tests.html', `raw ?from=${evil} must not survive`);
    }
  });
});

describe('listening player — back follows the library you came from', () => {
  test('mini library entry backs to the mini library', () => {
    assert.deepEqual(lPlayerBack('?id=T&from=mini'), ['/pages/listening-mini-test.html']);
  });
  test('full library entry backs to the full library', () => {
    assert.deepEqual(lPlayerBack('?id=T&from=full'), ['/pages/listening-tests.html']);
  });
  test('the mock embed (no ?from=) is unaffected — defaults to full', () => {
    assert.deepEqual(lPlayerBack('?id=T&sitting_id=S&mock_embed=1'), ['/pages/listening-tests.html']);
  });
  test('?from= is allowlisted here too', () => {
    assert.deepEqual(lPlayerBack('?id=T&from=//evil.com'), ['/pages/listening-tests.html']);
  });
});

describe('the callers stamp the origin', () => {
  test('both reading libraries tag their link into the exam', () => {
    assert.match(read('public', 'js', 'reading-test.js'), /reading-exam\.html\?test_id=\$\{[^}]+\}&from=full/);
    assert.match(read('public', 'js', 'reading-mini-test.js'), /reading-exam\.html\?test_id=\$\{[^}]+\}&from=mini/);
  });
  test('the exam carries the origin through to the review page', () => {
    assert.match(EXAM_JS, /reading-review\.html\?attempt_id=[\s\S]{0,120}&from=' \+ originFromUrl\(\)/);
  });
  test('both listening libraries tag their link into the player', () => {
    assert.match(read('public', 'js', 'listening-tests-list.js'), /listening-test\.html\?id=\$\{[^}]+\}&from=full/);
    assert.match(read('public', 'js', 'listening-mini-test.js'), /listening-test\.html\?id=\$\{[^}]+\}&from=mini/);
  });
  test('the listening player carries the origin through to its review page', () => {
    assert.match(LPLAYER_JS, /listening-review\.html\?attempt_id=[\s\S]{0,120}&from=' \+ originFromUrl\(\)/);
  });
  test('the mock result tags BOTH its reviews with the sitting to return to', () => {
    const MOCK = read('public', 'pages', 'mock-result.html');
    assert.match(MOCK, /var mockOrigin = '&from=mock&sitting=' \+ encodeURIComponent\(sitting\)/);
    assert.match(MOCK, /listening-review\.html\?attempt_id=[^\n]*\+ mockOrigin/);
    assert.match(MOCK, /reading-review\.html\?attempt_id=[^\n]*\+ mockOrigin/);
  });
});

describe('admin writing sub-pages back to their SECTION, like listening does', () => {
  const PAGES = ['prompts', 'tips', 'assignments', 'cohorts', 'regrade-requests'];
  test('no writing sub-page backs out to the admin.html redirect stub', () => {
    for (const p of PAGES) {
      assert.doesNotMatch(read('public', 'pages', 'admin', 'writing', `${p}.html`),
        /href="\/admin\.html"/,
        `${p}.html still backs to /admin.html (a redirect stub, not the section)`);
    }
  });
  test('each backs to the Writing section index', () => {
    for (const p of PAGES) {
      assert.match(read('public', 'pages', 'admin', 'writing', `${p}.html`),
        /<a href="\/pages\/admin\/writing\/index\.html" class="aw-back-link[^"]*">← Quản lý Writing<\/a>/,
        `${p}.html does not back to the writing section`);
    }
  });
});

describe('admin mock-review report — a real href, not history.back()', () => {
  test('history.back() is gone (its only opener uses target="_blank")', () => {
    const REPORT = read('public', 'pages', 'admin', 'mock-reviews', 'report.html');
    // Match the ATTRIBUTE, not the bare phrase — the comment above the fix
    // mentions history.back() by name and would trip a looser regex.
    assert.doesNotMatch(REPORT, /href="javascript:history\.back\(\)"/);
    assert.match(REPORT, /href="\/pages\/admin\/mock-reviews\/index\.html"/);
  });
  test('the opener really does open a new tab — so history.back could never work', () => {
    assert.match(read('public', 'js', 'admin-mock-reviews.js'),
      /target="_blank" href="\/pages\/admin\/mock-reviews\/report\.html/);
  });
});
