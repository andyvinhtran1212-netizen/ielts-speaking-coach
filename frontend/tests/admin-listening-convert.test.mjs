/**
 * frontend/tests/admin-listening-convert.test.mjs — Sprint 13.4
 * (DEBT-ADMIN-LISTENING-AUTHORING 6/N).
 *
 * Pins the markup + JS-module contract for the Convert DOCX surface:
 *   - /pages/admin/listening/convert.html (3-step upload → preview → commit)
 *   - /js/admin-listening-convert.js (file capture, POST /convert,
 *     POST /convert/commit, results render)
 *
 * And the integration touch-points:
 *   - listening landing /pages/admin/listening/index.html exposes the
 *     "Convert đề từ DOCX" card as a live link
 *   - chrome NAV_GROUPS lists the `convert` slug
 *
 * No DOM runtime in node:test — structural string assertions only.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

const read = (...parts) =>
  readFileSync(path.join(REPO_ROOT, 'frontend', ...parts), 'utf8');


// ── Convert page structure ──────────────────────────────────────────────────


describe('Sprint 13.4 — convert page structure', () => {
  const html = read('pages', 'admin', 'listening', 'convert.html');

  test('embeds chrome with active=listening + subsection=convert', () => {
    assert.match(
      html,
      /<aver-admin-chrome\s+active=["']listening["']\s+subsection=["']convert["']/,
    );
  });

  test('back link returns to listening landing', () => {
    assert.match(html, /href=["']\/pages\/admin\/listening\/index\.html["']/);
  });

  test('two upload zones for Question Paper + Script+AnswerKey', () => {
    assert.match(html, /id=["']cv-zone-qp["']/);
    assert.match(html, /id=["']cv-zone-sa["']/);
    assert.match(html, /id=["']cv-file-qp["']/);
    assert.match(html, /id=["']cv-file-sa["']/);
    // Both accept .docx only
    assert.match(html, /accept=["']\.docx["'][\s\S]*?accept=["']\.docx["']/);
  });

  test('parse button starts disabled (both files required)', () => {
    assert.match(html, /id=["']cv-parse["'][^>]*disabled/);
  });

  test('preview section scaffold present (metadata pills + sections + warnings + errors)', () => {
    assert.match(html, /id=["']cv-preview["']/);
    for (const id of ['cv-meta-test-id', 'cv-meta-version', 'cv-meta-band',
                      'cv-meta-accents', 'cv-meta-words', 'cv-meta-source']) {
      assert.match(html, new RegExp(`id=["']${id}["']`),
        `missing preview meta pill ${id}`);
    }
    assert.match(html, /id=["']cv-sections["']/);
    assert.match(html, /id=["']cv-warnings["']/);
    assert.match(html, /id=["']cv-errors["']/);
  });

  test('commit button + reset button live in preview section', () => {
    assert.match(html, /id=["']cv-commit["'][^>]*disabled/);
    assert.match(html, /id=["']cv-reset["']/);
  });

  test('results section scaffold present (banner + list + warnings)', () => {
    assert.match(html, /id=["']cv-results["']/);
    assert.match(html, /id=["']cv-results-banner["']/);
    assert.match(html, /id=["']cv-results-list["']/);
    assert.match(html, /id=["']cv-results-warnings["']/);
  });

  test('preview + results sections start hidden', () => {
    assert.match(html, /id=["']cv-preview["'][\s\S]*?hidden/);
    assert.match(html, /id=["']cv-results["'][\s\S]*?hidden/);
  });
});


// ── Convert controller logic ────────────────────────────────────────────────


describe('Sprint 13.4 — convert controller logic', () => {
  const js = read('js', 'admin-listening-convert.js');

  test('parse button POSTs multipart to /admin/listening/convert', () => {
    assert.match(
      js,
      /window\.api\.upload\(\s*['"]\/admin\/listening\/convert['"]/,
    );
  });

  test('FormData carries both files keyed question_paper + script_answerkey', () => {
    assert.match(js, /append\(['"]question_paper['"]/);
    assert.match(js, /append\(['"]script_answerkey['"]/);
  });

  test('commit POSTs envelope to /admin/listening/convert/commit', () => {
    assert.match(
      js,
      /window\.api\.post\(\s*['"]\/admin\/listening\/convert\/commit['"]/,
    );
  });

  test('errors block commit (disabled = errors.length > 0)', () => {
    assert.match(js, /errors[\s\S]*?length[\s\S]*?cv-commit/);
  });

  test('5MB file-size guard before parse', () => {
    assert.match(js, /5\s*\*\s*1024\s*\*\s*1024/);
  });

  test('section card renders speakers + exercises + transcript preview', () => {
    assert.match(js, /speakers/);
    assert.match(js, /exercises/);
    assert.match(js, /transcript_clean/);
  });
});


// ── Listening landing exposes Convert + Tests cards ─────────────────────────


describe('Sprint 13.4 — listening landing integrates convert + tests entry', () => {
  const html = read('pages', 'admin', 'listening', 'index.html');

  test('"Convert đề từ DOCX" card is a live link to convert.html', () => {
    const card = html.match(/<a[^>]*data-create=["']convert["'][^>]*>/);
    assert.ok(card, 'convert card markup not found');
    assert.match(
      card[0],
      /href=["']\/pages\/admin\/listening\/convert\.html["']/,
      'convert card must point to /pages/admin/listening/convert.html',
    );
  });

  test('"Test Cambridge IELTS" card links to tests.html', () => {
    const card = html.match(/<a[^>]*data-create=["']tests["'][^>]*>/);
    assert.ok(card, 'tests card markup not found');
    assert.match(
      card[0],
      /href=["']\/pages\/admin\/listening\/tests\.html["']/,
      'tests card must point to /pages/admin/listening/tests.html',
    );
  });

  test('all three create cards live (upload + render + convert)', () => {
    const upload  = html.match(/<a[^>]*data-create=["']upload["'][^>]*>/);
    const render  = html.match(/<a[^>]*data-create=["']render["'][^>]*>/);
    const convert = html.match(/<a[^>]*data-create=["']convert["'][^>]*>/);
    assert.ok(upload && render && convert, 'all three create cards must exist');
    assert.doesNotMatch(upload[0],  /aria-disabled=["']true["']/);
    assert.doesNotMatch(render[0],  /aria-disabled=["']true["']/);
    assert.doesNotMatch(convert[0], /aria-disabled=["']true["']/);
  });
});


// ── Chrome NAV exposes convert + tests slugs ────────────────────────────────


describe('Sprint 13.4 — chrome NAV includes convert + tests slugs', () => {
  const chrome = read('js', 'components', 'aver-admin-chrome.js');

  test('listening subsections list contains convert slug + href', () => {
    assert.match(
      chrome,
      /slug:\s*['"]convert['"][\s\S]*?\/pages\/admin\/listening\/convert\.html/,
    );
  });

  test('listening subsections list contains tests slug + href', () => {
    assert.match(
      chrome,
      /slug:\s*['"]tests['"][\s\S]*?\/pages\/admin\/listening\/tests\.html/,
    );
  });
});
