/**
 * frontend/tests/sprint-20-3-l2-skill-and-admin.test.mjs
 *
 * Sprint 20.3 — L2 Skill Practice student surface + Reading admin authoring UI.
 * Static-analysis sentinels for the L2 pages, the shared question renderer
 * (extracted in 20.3 from the L1 inline renderer), the admin content page,
 * the aver-admin-chrome Reading section, and the L1 library switcher addition.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');


describe('Sprint 20.3 — L2 library page (reading-skill.html)', () => {
  const html = read('frontend/pages/reading-skill.html');

  test('uses the student chrome with active="reading"', () => {
    assert.match(html, /<aver-chrome active="reading"><\/aver-chrome>/);
  });
  test('reuses the shared reading-vocab.css', () => {
    assert.match(html, /href="\/css\/reading-vocab\.css"/);
  });
  test('ships the library switcher pointing back to L1 Vocab', () => {
    assert.match(html, /class="rv-libnav"/);
    assert.match(html, /href="\/pages\/reading-vocab\.html"/);
    assert.match(html, /is-active[^>]*aria-current="page"/);
  });
  test('skill filter covers the D2 enum', () => {
    for (const v of ['skimming','scanning','detail','main_idea','inference',
                     'vocabulary_in_context','reference_cohesion','writer_view_TFNG']) {
      assert.match(html, new RegExp(`<option value="${v}"`), `missing skill option ${v}`);
    }
  });
  test('loads reading-skill.js and ships state + grid containers', () => {
    assert.match(html, /src="\/js\/reading-skill\.js"/);
    for (const id of ['state-loading','state-empty','state-error','rv-grid','filter-difficulty','filter-skill']) {
      assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
    }
  });
});


describe('Sprint 20.3 — L2 exercise page (reading-skill-exercise.html)', () => {
  const html = read('frontend/pages/reading-skill-exercise.html');

  test('chrome + markdown + lightbox + glossary + shared question renderer', () => {
    assert.match(html, /<aver-chrome active="reading">/);
    assert.match(html, /src="\/js\/markdown\.js"/);
    assert.match(html, /src="\/js\/image-lightbox\.js"/);
    assert.match(html, /src="\/js\/components\/glossary-popover\.js"/);
    assert.match(html, /src="\/js\/components\/reading-questions\.js"/);
  });
  test('ships the skill-focus banner + reading shells', () => {
    for (const id of ['rv-skill-banner','rv-progress-fill','rv-passage','rv-title','rv-body','rv-questions']) {
      assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
    }
    assert.match(html, /src="\/js\/reading-skill-exercise\.js"/);
  });
});


describe('Sprint 20.3 — L2 library JS (reading-skill.js)', () => {
  const js = read('frontend/js/reading-skill.js');
  test('fetches the L2 list endpoint with skill filter', () => {
    assert.match(js, /window\.api\.get\(`?\/api\/reading\/skill/);
    assert.match(js, /qs\.set\('skill'/);
  });
  test('deep-links to the exercise page by slug', () => {
    assert.match(js, /reading-skill-exercise\.html\?slug=/);
  });
  test('emphasises the skill_focus pill (brand-coloured)', () => {
    assert.match(js, /skill_focus/);
    assert.match(js, /rv-pill is-brand/);
  });
  test('escapes interpolated card content', () => {
    assert.match(js, /function escapeHtml/);
  });
});


describe('Sprint 20.3 — L2 exercise JS (reading-skill-exercise.js)', () => {
  const js = read('frontend/js/reading-skill-exercise.js');
  test('loads one exercise + delegates Qs to the shared renderer with library "skill"', () => {
    assert.match(js, /\/api\/reading\/skill\/'\s*\+\s*encodeURIComponent\(slug\)/);
    assert.match(js, /window\.ReadingQuestions\.attach/);
    assert.match(js, /library:\s*'skill'/);
  });
  test('displays the skill-focus banner', () => {
    assert.match(js, /rv-skill-banner/);
  });
});


describe('Sprint 20.3 — shared question renderer (reading-questions.js)', () => {
  const js = read('frontend/js/components/reading-questions.js');
  test('exposes window.ReadingQuestions.attach', () => {
    assert.match(js, /window\.ReadingQuestions\s*=\s*\{[^}]*attach/);
  });
  test('supports all Phase-1 question types incl. matching_headings (D7 dropdown)', () => {
    for (const t of ['mcq_single','true_false_not_given','yes_no_not_given','matching_headings']) {
      assert.match(js, new RegExp(`'${t}'`), `missing renderer branch for ${t}`);
    }
  });
  test('routes /check by library param + slug (vocab OR skill)', () => {
    assert.match(js, /\/api\/reading\/' \+ session\.library/);
  });
  test('is XSS-safe (no innerHTML assignment anywhere — uses replaceChildren + textContent)', () => {
    assert.ok(!/\.innerHTML\s*=/.test(js),
      'reading-questions.js must not assign innerHTML (XSS guard)');
    assert.match(js, /\.replaceChildren\(/);
  });
});


describe('Sprint 20.3 — L1 page reuses the shared renderer', () => {
  const js = read('frontend/js/reading-vocab-passage.js');
  test('reading-vocab-passage.js calls ReadingQuestions.attach with library "vocab"', () => {
    assert.match(js, /window\.ReadingQuestions\.attach/);
    assert.match(js, /library:\s*'vocab'/);
  });
  test('the inline renderer was removed (extracted to the component)', () => {
    assert.ok(!/function renderQuestion\(/.test(js),
      'renderQuestion helper should have moved to the shared component');
  });

  const libHtml = read('frontend/pages/reading-vocab.html');
  test('the L1 library page also ships the library switcher', () => {
    assert.match(libHtml, /class="rv-libnav"/);
    assert.match(libHtml, /href="\/pages\/reading-skill\.html"/);
  });
});


describe('Sprint 20.3 — admin Reading content page', () => {
  const html = read('frontend/pages/admin/reading/content.html');

  test('uses aver-admin chrome with active="reading" subsection="content"', () => {
    assert.match(html, /<aver-admin-chrome active="reading" subsection="content">/);
  });
  test('ships an import panel (dropzone + file input + commit) and a list panel', () => {
    for (const id of ['ar-dropzone','ar-file','ar-status','ar-preview','ar-errors',
                       'ar-kv','ar-reset','ar-commit','ar-list-rows']) {
      assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
    }
    assert.match(html, /data-library="l1_vocab"/);
    assert.match(html, /data-library="l2_skill"/);
  });
  test('loads admin-reading.js + admin-reading.css', () => {
    assert.match(html, /src="\/js\/admin-reading\.js"/);
    assert.match(html, /href="\/css\/admin-reading\.css"/);
  });
});


describe('Sprint 20.3 — admin Reading JS (admin-reading.js)', () => {
  const js = read('frontend/js/admin-reading.js');
  test('uploads to the import endpoint with both dry_run modes', () => {
    assert.match(js, /\/admin\/reading\/content\/import\?dry_run=true/);
    assert.match(js, /\/admin\/reading\/content\/import\?dry_run=false/);
    assert.match(js, /window\.api\.upload/);
  });
  test('fetches the admin list endpoint with library filter', () => {
    assert.match(js, /\/admin\/reading\/content\?/);
    assert.match(js, /libraryFilter/);
  });
  test('escapes interpolated row + error content', () => {
    assert.match(js, /function escapeHtml/);
  });
});


describe('Sprint 20.3 — aver-admin chrome ships a Reading section', () => {
  const js = read('frontend/js/components/aver-admin-chrome.js');
  test('Reading appears under Nội dung with a content subsection link', () => {
    assert.match(js, /section:\s*'reading'/);
    assert.match(js, /href:\s*'\/pages\/admin\/reading\/content\.html'/);
  });
});


describe('Sprint 20.3 — Reading tab still unlocked in student chrome', () => {
  const js = read('frontend/js/components/aver-chrome.js');
  test('Reading remains an active nav link (Sprint 20.2 unlock preserved)', () => {
    assert.match(js, /href="\/pages\/reading-vocab\.html"\s+data-tab="reading">Reading<\/a>/);
    assert.ok(!/<span class="locked"[^>]*>Reading<\/span>/.test(js));
  });
});
