/**
 * frontend/tests/sprint-20-2-l1-reading.test.mjs
 *
 * Sprint 20.2 — L1 Vocab Reading student surface (cluster 20.x).
 * Static-analysis sentinels for the two new pages + their JS + the glossary
 * popover component + the chrome Reading-tab unlock. Mirrors the existing
 * frontend contract tests (read file → assert canonical patterns).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');


describe('Sprint 20.2 — L1 library page (reading-vocab.html)', () => {
  const html = read('frontend/pages/reading-vocab.html');

  test('uses the student chrome with active="reading"', () => {
    assert.match(html, /<aver-chrome active="reading"><\/aver-chrome>/);
    assert.match(html, /src="\/js\/components\/aver-chrome\.js"/);
  });
  test('links shared reading-vocab.css + api.js', () => {
    assert.match(html, /href="\/css\/reading-vocab\.css"/);
    assert.match(html, /src="\/js\/api\.js"/);
  });
  test('ships loading / empty / error states + a card grid', () => {
    for (const id of ['state-loading', 'state-empty', 'state-error', 'rv-grid']) {
      assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
    }
  });
  test('ships difficulty + topic filters and loads its page script', () => {
    assert.match(html, /id="filter-difficulty"/);
    assert.match(html, /id="filter-tag"/);
    assert.match(html, /src="\/js\/reading-vocab\.js"/);
  });
});


describe('Sprint 20.2 — L1 passage page (reading-vocab-passage.html)', () => {
  const html = read('frontend/pages/reading-vocab-passage.html');

  test('student chrome + markdown + lightbox + glossary wiring', () => {
    assert.match(html, /<aver-chrome active="reading">/);
    assert.match(html, /marked@12\/marked\.min\.js/);
    assert.match(html, /dompurify@3\/dist\/purify\.min\.js/);
    assert.match(html, /src="\/js\/markdown\.js"/);
    assert.match(html, /href="\/css\/image-lightbox\.css"/);
    assert.match(html, /src="\/js\/image-lightbox\.js"/);
    assert.match(html, /src="\/js\/components\/glossary-popover\.js"/);
  });
  test('ships progress bar + passage body + questions containers', () => {
    for (const id of ['rv-progress-fill', 'rv-passage', 'rv-title', 'rv-body', 'rv-questions']) {
      assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
    }
    assert.match(html, /src="\/js\/reading-vocab-passage\.js"/);
  });
});


describe('Sprint 20.2 — library JS (reading-vocab.js)', () => {
  const js = read('frontend/js/reading-vocab.js');
  test('fetches the L1 list endpoint', () => {
    assert.match(js, /window\.api\.get\(`?\/api\/reading\/vocab/);
  });
  test('deep-links to the passage page by slug', () => {
    assert.match(js, /reading-vocab-passage\.html\?slug=/);
  });
  test('escapes interpolated card content (XSS guard)', () => {
    assert.match(js, /function escapeHtml/);
  });
});


describe('Sprint 20.2 — passage JS (reading-vocab-passage.js)', () => {
  const js = read('frontend/js/reading-vocab-passage.js');
  test('loads one passage + checks answers server-side', () => {
    assert.match(js, /\/api\/reading\/vocab\/'\s*\+\s*encodeURIComponent\(slug\)/);
    assert.match(js, /\/check'/);
    assert.match(js, /window\.api\.post/);
  });
  test('renders markdown + glossary + lightbox via shared modules', () => {
    assert.match(js, /window\.renderMarkdown/);
    assert.match(js, /window\.GlossaryPopover\.attach/);
    assert.match(js, /window\.AvImageLightbox\.open/);
  });
});


describe('Sprint 20.2 — glossary popover component', () => {
  const js = read('frontend/js/components/glossary-popover.js');
  test('exposes window.GlossaryPopover.attach', () => {
    assert.match(js, /window\.GlossaryPopover\s*=\s*\{[^}]*attach/);
  });
  test('is XSS-safe: term/definition set via textContent, never innerHTML', () => {
    assert.match(js, /\.textContent\s*=/);
    assert.ok(!/\.innerHTML\s*=/.test(js), 'popover must not assign innerHTML');
  });
  test('dismisses on Escape (lightbox idiom)', () => {
    assert.match(js, /'Escape'/);
  });
});


describe('Sprint 20.2 — Reading tab unlocked in aver-chrome.js', () => {
  const js = read('frontend/js/components/aver-chrome.js');
  test('Reading is an active nav link, not a locked span', () => {
    assert.match(js, /href="\/pages\/reading-vocab\.html"\s+data-tab="reading">Reading<\/a>/);
    assert.ok(
      !/<span class="locked"[^>]*>Reading<\/span>/.test(js),
      'Reading must no longer be a locked span (Sprint 20.2 unlock)',
    );
  });
});
