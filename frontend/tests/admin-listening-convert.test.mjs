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
    // Sprint 13.4.2 — both accept markdown only.
    const mdAccept = /accept=["'][^"']*\.md[^"']*["']/g;
    const matches = html.match(mdAccept) || [];
    assert.ok(matches.length >= 2, 'expected ≥2 .md accept attrs');
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

  test('1MB file-size guard before parse', () => {
    // Sprint 13.4.2 — tighter cap for text files.
    assert.match(js, /1\s*\*\s*1024\s*\*\s*1024/);
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

  test('convert create card live; upload + render cards stay removed', () => {
    // 2026-07-17 usage audit: MP3 upload + ElevenLabs render cards were
    // decommissioned; convert remains the markdown entry point.
    const convert = html.match(/<a[^>]*data-create=["']convert["'][^>]*>/);
    assert.ok(convert, 'convert create card must exist');
    assert.doesNotMatch(convert[0], /aria-disabled=["']true["']/);
    assert.doesNotMatch(html, /data-create=["']upload["']/);
    assert.doesNotMatch(html, /data-create=["']render["']/);
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


// ── Sprint 13.4.1 hotfix — auth bootstrap + null safety + redirect ──────────


describe('Sprint 13.4.1 — convert controller bootstraps Supabase at load', () => {
  const js = read('js', 'admin-listening-convert.js');

  test('declares SUPABASE_URL + SUPABASE_ANON module-level constants', () => {
    assert.match(js, /const\s+SUPABASE_URL\s*=\s*['"]https:\/\/[a-z0-9]+\.supabase\.co['"]/);
    assert.match(js, /const\s+SUPABASE_ANON\s*=\s*['"]sb_publishable_/);
  });

  test('runs bootstrapSupabase IIFE before init() (so first POST has auth)', () => {
    // Pin "bootstrapSupabase" function + its IIFE invocation pattern.
    assert.match(js, /function\s+bootstrapSupabase\s*\(\)/);
    assert.match(js, /window\.initSupabase\(SUPABASE_URL,\s*SUPABASE_ANON\)/);
  });

  test('onParse null-checks the multipart response before nested access', () => {
    // The fix's distinctive guard — a stray "result.test_metadata"
    // without the null-check is what crashed Andy's dogfood.
    assert.match(
      js,
      /!result\s*\|\|\s*typeof\s+result\s*!==\s*['"]object['"]\s*\|\|\s*!result\.test_metadata/,
    );
  });

  test('onParse catch block tolerates undefined error objects', () => {
    assert.match(js, /e\s*&&\s*e\.message\s*\?\s*e\.message/);
  });

  test('onCommit null-checks the commit response before nested access', () => {
    assert.match(
      js,
      /!result\s*\|\|\s*typeof\s+result\s*!==\s*['"]object['"]\s*\|\|\s*!result\.test_id/,
    );
  });
});


describe('Sprint 13.4.1 — tests-list controller bootstraps Supabase at load', () => {
  const js = read('js', 'admin-listening-tests-list.js');

  test('declares SUPABASE_URL + SUPABASE_ANON module-level constants', () => {
    assert.match(js, /const\s+SUPABASE_URL\s*=\s*['"]https:\/\/[a-z0-9]+\.supabase\.co['"]/);
    assert.match(js, /const\s+SUPABASE_ANON\s*=\s*['"]sb_publishable_/);
  });

  test('runs bootstrapSupabase IIFE so GET /tests carries auth', () => {
    assert.match(js, /function\s+bootstrapSupabase\s*\(\)/);
    assert.match(js, /window\.initSupabase\(SUPABASE_URL,\s*SUPABASE_ANON\)/);
  });
});


describe('Sprint 13.4.1 — api.js 401 redirect uses absolute /login.html', () => {
  const js = read('js', 'api.js');

  test('401 branch sets window.location.href to absolute /login.html', () => {
    // Old code: `_appRoot + 'login.html'` (broke for 3-level paths).
    // New: literal '/login.html'. Pin the literal.
    assert.match(
      js,
      /response\.status\s*===\s*401[\s\S]{0,600}?window\.location\.href\s*=\s*['"]\/login\.html['"]/,
    );
  });

  test('no relative login.html redirect remains in the 401 branch', () => {
    // Guard against future regressions adding `_appRoot + 'login.html'` back.
    assert.doesNotMatch(
      js,
      /window\.location\.href\s*=\s*_appRoot\s*\+\s*['"]login\.html['"]/,
    );
  });

  test('Authorization header still attached to every request (incl. multipart)', () => {
    // Sprint 13.4.1 root cause for Bug 1 wasn't the helper itself —
    // it was that convert/tests pages didn't bootstrap Supabase, so
    // _getAuthToken() returned null. Pin the helper's header-attach
    // line as a regression guard so a future "simplify auth" patch
    // can't strip it.
    assert.match(
      js,
      /if\s*\(token\)\s*headers\[['"]Authorization['"]\]\s*=\s*['"]Bearer\s+['"]\s*\+\s*token/,
    );
  });
});


// ── Sprint 13.4.2 — markdown parser pivot ───────────────────────────────────


describe('Sprint 13.4.2 — convert page accepts markdown bundle', () => {
  const html = read('pages', 'admin', 'listening', 'convert.html');

  test('header copy mentions markdown (was DOCX)', () => {
    assert.match(html, /Convert đề từ markdown/);
  });

  test('subtitle explains 2-file Cambridge template', () => {
    assert.match(html, /2 file markdown/);
    assert.match(html, /Cambridge IELTS/);
  });

  test('both file inputs accept .md / .markdown / text/markdown', () => {
    assert.match(html, /accept=["']\.md,\.markdown,text\/markdown["']/);
  });

  test('drop-zone hints reference .md (not .docx)', () => {
    assert.match(html, /Kéo thả file \.md/);
    assert.doesNotMatch(html, /Kéo thả file \.docx/);
  });

  test('size cap shown as 1MB/file (was 5MB)', () => {
    assert.match(html, /1MB\/file/);
    assert.doesNotMatch(html, /5MB\/file/);
  });
});


describe('Sprint 13.4.2 — convert controller validates markdown extensions', () => {
  const js = read('js', 'admin-listening-convert.js');

  test('ALLOWED_EXTENSIONS lists .md + .markdown', () => {
    assert.match(js, /ALLOWED_EXTENSIONS\s*=\s*\[\s*['"]\.md['"]\s*,\s*['"]\.markdown['"]/);
  });

  test('rejects non-markdown files with Vietnamese error', () => {
    assert.match(js, /Cả hai file phải là \.md hoặc \.markdown/);
  });

  test('rejects oversize files with 1MB message', () => {
    assert.match(js, /File vượt 1MB/);
    assert.doesNotMatch(js, /File vượt 5MB/);
  });

  test('no .docx extension check left over from Sprint 13.4', () => {
    assert.doesNotMatch(js, /\.docx/);
  });

  test('multipart FormData keys unchanged from 13.4 contract', () => {
    // Bundle keys stay question_paper + script_answerkey — backend
    // accepts the same fields, just different extensions.
    assert.match(js, /append\(['"]question_paper['"]/);
    assert.match(js, /append\(['"]script_answerkey['"]/);
  });
});
