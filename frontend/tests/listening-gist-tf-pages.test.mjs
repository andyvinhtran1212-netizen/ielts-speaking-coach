/**
 * frontend/tests/listening-gist-tf-pages.test.mjs
 *
 * Sprint 11.4 — pin the 4 new Listening pages (DEBT-LISTENING-MODULE 4/5):
 *
 *   - frontend/pages/listening-gist.html              (user)
 *   - frontend/js/listening-gist.js                   (user)
 *   - frontend/pages/listening-tf.html                (user)
 *   - frontend/js/listening-tf.js                     (user)
 *   - frontend/pages/admin/listening/gist.html        (admin authoring)
 *   - frontend/js/admin-listening-gist.js             (admin authoring)
 *   - frontend/pages/admin/listening/tf.html          (admin authoring)
 *   - frontend/js/admin-listening-tf.js               (admin authoring)
 *
 * Sentinel match against the static source — same pattern as Sprint
 * 11.2/11.3 page tests. Catches API endpoint drift, missing key UI
 * affordances, and design-token regressions.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...rel) => readFileSync(join(__dirname, '..', ...rel), 'utf8');

const USER_GIST_HTML  = read('pages', 'listening-gist.html');
const USER_GIST_JS    = read('js',    'listening-gist.js');
const USER_TF_HTML    = read('pages', 'listening-tf.html');
const USER_TF_JS      = read('js',    'listening-tf.js');
const ADMIN_GIST_HTML = read('pages', 'admin/listening/gist.html');
const ADMIN_GIST_JS   = read('js',    'admin-listening-gist.js');
const ADMIN_TF_HTML   = read('pages', 'admin/listening/tf.html');
const ADMIN_TF_JS     = read('js',    'admin-listening-tf.js');


/* ── User Gist ──────────────────────────────────────────────────── */

describe('Sprint 11.4 — user Gist page contract', () => {

  it('mounts <aver-chrome active="listening"> + <audio-player>', () => {
    assert.match(USER_GIST_HTML, /<aver-chrome\s+active=["']listening["']/);
    assert.match(USER_GIST_HTML, /<audio-player\s+id="player"/);
  });

  it('ships prompt-box + textarea + submit + feedback block', () => {
    assert.match(USER_GIST_HTML, /id="prompt-box"/);
    assert.match(USER_GIST_HTML, /id="answer"/);
    assert.match(USER_GIST_HTML, /id="btn-submit"/);
    assert.match(USER_GIST_HTML, /id="feedback-block"/);
    assert.match(USER_GIST_HTML, /id="keyword-row"/);
  });

  it('POSTs /api/listening/attempts with mode=gist', () => {
    assert.match(USER_GIST_JS, /\/api\/listening\/attempts/);
    assert.match(USER_GIST_JS, /mode:\s*['"]gist['"]/);
    assert.match(USER_GIST_JS, /user_transcript/);
  });

  it('reads ?content_id + fetches user GET /api/listening/exercises', () => {
    assert.match(USER_GIST_JS, /URLSearchParams\(\s*window\.location\.search\s*\)/);
    assert.match(USER_GIST_JS, /\/api\/listening\/exercises\?content_id=/);
    assert.match(USER_GIST_JS, /exercise_type=gist/);
  });

  it('displays AI vs keyword-fallback indicator in score pill', () => {
    // The Gist grader returns ai_used boolean — the pill must surface
    // the keyword-fallback state so users understand a lower score
    // isn't necessarily a worse answer.
    assert.match(USER_GIST_JS, /ai_used/);
    assert.match(USER_GIST_JS, /keyword/);
  });

  it('escapes feedback + keyword text before innerHTML', () => {
    assert.match(USER_GIST_JS, /function escapeHtml/);
  });

  it('uses the canonical Supabase project ref', () => {
    assert.match(USER_GIST_JS, /nqhrtqspznepmveyurzm\.supabase\.co/);
  });
});


/* ── User T/F ───────────────────────────────────────────────────── */

describe('Sprint 11.4 — user T/F page contract', () => {

  it('mounts <aver-chrome active="listening"> + <audio-player>', () => {
    assert.match(USER_TF_HTML, /<aver-chrome\s+active=["']listening["']/);
    assert.match(USER_TF_HTML, /<audio-player\s+id="player"/);
  });

  it('ships statements list container + submit + reset', () => {
    assert.match(USER_TF_HTML, /id="statements-list"/);
    assert.match(USER_TF_HTML, /id="btn-submit"/);
    assert.match(USER_TF_HTML, /id="btn-reset"/);
  });

  it('POSTs /api/listening/attempts with mode=true_false + answers[]', () => {
    assert.match(USER_TF_JS, /mode:\s*['"]true_false['"]/);
    assert.match(USER_TF_JS, /answers:\s*STATE\.answers/);
  });

  it('renders 3 radio options per statement — T / F / NG', () => {
    // The radio markup is built in JS, so we check the value strings.
    assert.match(USER_TF_JS, /value="T"/);
    assert.match(USER_TF_JS, /value="F"/);
    assert.match(USER_TF_JS, /value="NG"/);
  });

  it('strips server-side answer field client-side (security)', () => {
    // The user must NOT see the canonical answer in the DOM — only
    // text + idx are kept. A regression that exposed `answer` to the
    // client would let the user inspect the correct answer.
    assert.match(USER_TF_JS, /STATE\.statements\s*=\s*stmts\.slice\(\)/);
    // The map MUST NOT include the answer field.
    assert.match(USER_TF_JS, /\.map\(\(s\) =>\s*\(\{\s*idx:\s*s\.idx,\s*text:\s*s\.text\s*\}\)/);
  });

  it('per-statement result paint after submit (is-correct / is-incorrect)', () => {
    assert.match(USER_TF_JS, /is-correct/);
    assert.match(USER_TF_JS, /is-incorrect/);
  });

  it('rejects submit when not all answers selected', () => {
    assert.match(USER_TF_JS, /some\(\(a\) =>\s*!a\)/);
  });
});


/* ── Admin Gist editor ──────────────────────────────────────────── */

describe('Sprint 11.4 — admin Gist editor contract', () => {

  it('ships audio + transcript-ref + 3 form fields + save/publish buttons', () => {
    assert.match(ADMIN_GIST_HTML, /<audio-player\s+id="player"/);
    assert.match(ADMIN_GIST_HTML, /id="transcript-ref"/);
    assert.match(ADMIN_GIST_HTML, /id="prompt-text"/);
    assert.match(ADMIN_GIST_HTML, /id="model-answer"/);
    assert.match(ADMIN_GIST_HTML, /id="rubric-keywords"/);
    assert.match(ADMIN_GIST_HTML, /id="btn-save"/);
    assert.match(ADMIN_GIST_HTML, /id="btn-publish"/);
  });

  it('fetches admin GET /admin/listening/content + /admin/listening/exercises', () => {
    assert.match(ADMIN_GIST_JS, /\/admin\/listening\/content\//);
    assert.match(ADMIN_GIST_JS, /\/admin\/listening\/exercises\?content_id=/);
    assert.match(ADMIN_GIST_JS, /exercise_type=gist/);
  });

  it('POSTs to /admin/listening/exercises with payload shape', () => {
    assert.match(ADMIN_GIST_JS, /api\.post\(\s*['"]\/admin\/listening\/exercises['"]/);
    assert.match(ADMIN_GIST_JS, /exercise_type:\s*['"]gist['"]/);
    assert.match(ADMIN_GIST_JS, /prompt_text/);
    assert.match(ADMIN_GIST_JS, /model_answer/);
    assert.match(ADMIN_GIST_JS, /rubric_keywords/);
  });

  it('saves as draft and publish via separate handlers', () => {
    assert.match(ADMIN_GIST_JS, /save\(['"]draft['"]\)/);
    assert.match(ADMIN_GIST_JS, /save\(['"]published['"]\)/);
  });
});


/* ── Admin T/F editor ───────────────────────────────────────────── */

describe('Sprint 11.4 — admin T/F editor contract', () => {

  it('ships audio + transcript-ref + statements list + add/save/publish', () => {
    assert.match(ADMIN_TF_HTML, /<audio-player\s+id="player"/);
    assert.match(ADMIN_TF_HTML, /id="transcript-ref"/);
    assert.match(ADMIN_TF_HTML, /id="statements-list"/);
    assert.match(ADMIN_TF_HTML, /id="btn-add"/);
    assert.match(ADMIN_TF_HTML, /id="btn-save"/);
    assert.match(ADMIN_TF_HTML, /id="btn-publish"/);
  });

  it('enforces 3-12 statement IELTS range', () => {
    assert.match(ADMIN_TF_JS, /MIN_STATEMENTS\s*=\s*3/);
    assert.match(ADMIN_TF_JS, /MAX_STATEMENTS\s*=\s*12/);
  });

  it('POSTs to /admin/listening/exercises with statements[] payload', () => {
    assert.match(ADMIN_TF_JS, /api\.post\(\s*['"]\/admin\/listening\/exercises['"]/);
    assert.match(ADMIN_TF_JS, /exercise_type:\s*['"]true_false['"]/);
    assert.match(ADMIN_TF_JS, /statements\s*\}/);
  });

  it('answer dropdown carries Vietnamese labels for T / F / NG', () => {
    // Vietnamese-localized labels are non-negotiable per the locale
    // style guide (Andy direct).
    assert.match(ADMIN_TF_HTML.toLowerCase() + ADMIN_TF_JS.toLowerCase(),
                 /đúng \(t\)/);
    assert.match(ADMIN_TF_HTML.toLowerCase() + ADMIN_TF_JS.toLowerCase(),
                 /sai \(f\)/);
    assert.match(ADMIN_TF_HTML.toLowerCase() + ADMIN_TF_JS.toLowerCase(),
                 /không có \(ng\)/);
  });

  it('seeds with MIN_STATEMENTS empty rows when no existing exercise', () => {
    assert.match(ADMIN_TF_JS, /Array\.from\(\s*\{\s*length:\s*MIN_STATEMENTS/);
  });
});


/* ── Cross-cutting design-token discipline ────────────────────── */

describe('Sprint 11.4 — design-token discipline across the 4 new pages', () => {

  it('every page references --av-brand-teal-700 (canonical brand)', () => {
    for (const [name, html] of [
      ['user gist',  USER_GIST_HTML],
      ['user tf',    USER_TF_HTML],
      ['admin gist', ADMIN_GIST_HTML],
      ['admin tf',   ADMIN_TF_HTML],
    ]) {
      assert.match(html, /var\(--av-brand-teal-700\)/,
        `${name} page missing canonical brand teal token`);
    }
  });

  it('no raw #0F766E or #14B8A6 hex literals in any new page', () => {
    for (const [name, html] of [
      ['user gist',  USER_GIST_HTML],
      ['user tf',    USER_TF_HTML],
      ['admin gist', ADMIN_GIST_HTML],
      ['admin tf',   ADMIN_TF_HTML],
    ]) {
      assert.doesNotMatch(html, /#0F766E/i, `${name} regressed to hex brand teal 700`);
      assert.doesNotMatch(html, /#14B8A6/i, `${name} regressed to hex brand teal 500`);
    }
  });
});
