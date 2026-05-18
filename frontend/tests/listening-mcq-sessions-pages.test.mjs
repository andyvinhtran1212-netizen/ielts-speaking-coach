/**
 * frontend/tests/listening-mcq-sessions-pages.test.mjs
 *
 * Sprint 11.5 — pin the 6 new pages (DEBT-LISTENING-MODULE 5/5 cluster
 * closure):
 *
 *   - frontend/pages/listening-mcq.html             (user)
 *   - frontend/js/listening-mcq.js                  (user)
 *   - frontend/pages/admin-listening-mcq.html       (admin)
 *   - frontend/js/admin-listening-mcq.js            (admin)
 *   - frontend/pages/listening-mini-test.html       (user runner)
 *   - frontend/js/listening-mini-test.js            (user runner)
 *   - frontend/pages/admin-listening-mini-test.html (admin builder)
 *   - frontend/js/admin-listening-mini-test.js      (admin builder)
 *   - frontend/pages/listening-browse.html          (content browse)
 *   - frontend/js/listening-browse.js
 *   - frontend/pages/listening-analytics.html       (analytics)
 *   - frontend/js/listening-analytics.js
 *
 * Sentinel match against the static source — same pattern as Sprint
 * 11.4 page tests. Catches API endpoint drift, missing UI affordances,
 * and design-token regressions.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...rel) => readFileSync(join(__dirname, '..', ...rel), 'utf8');

const USER_MCQ_HTML        = read('pages', 'listening-mcq.html');
const USER_MCQ_JS          = read('js',    'listening-mcq.js');
const ADMIN_MCQ_HTML       = read('pages', 'admin-listening-mcq.html');
const ADMIN_MCQ_JS         = read('js',    'admin-listening-mcq.js');
const USER_MT_HTML         = read('pages', 'listening-mini-test.html');
const USER_MT_JS           = read('js',    'listening-mini-test.js');
const ADMIN_MT_HTML        = read('pages', 'admin-listening-mini-test.html');
const ADMIN_MT_JS          = read('js',    'admin-listening-mini-test.js');
const BROWSE_HTML          = read('pages', 'listening-browse.html');
const BROWSE_JS            = read('js',    'listening-browse.js');
const ANALYTICS_HTML       = read('pages', 'listening-analytics.html');
const ANALYTICS_JS         = read('js',    'listening-analytics.js');


/* ── User MCQ ────────────────────────────────────────────────────── */

describe('Sprint 11.5 — user MCQ page contract', () => {
  it('mounts <aver-chrome active="listening"> + <audio-player>', () => {
    assert.match(USER_MCQ_HTML, /<aver-chrome\s+active=["']listening["']/);
    assert.match(USER_MCQ_HTML, /<audio-player\s+id="player"/);
  });

  it('ships questions list container + submit + reset', () => {
    assert.match(USER_MCQ_HTML, /id="questions-list"/);
    assert.match(USER_MCQ_HTML, /id="btn-submit"/);
    assert.match(USER_MCQ_HTML, /id="btn-reset"/);
  });

  it('POSTs /api/listening/attempts with mode=mcq + mcq_answers[]', () => {
    assert.match(USER_MCQ_JS, /\/api\/listening\/attempts/);
    assert.match(USER_MCQ_JS, /mode:\s*['"]mcq['"]/);
    assert.match(USER_MCQ_JS, /mcq_answers:/);
  });

  it('strips answer_idx client-side (security)', () => {
    // The user JS must NOT keep the canonical answer_idx in STATE.
    assert.match(USER_MCQ_JS, /STATE\.questions/);
    assert.match(USER_MCQ_JS,
      /\.map\(\(q\) =>\s*\(\{[\s\S]*?idx:\s*q\.idx[\s\S]*?stem:\s*q\.stem[\s\S]*?options:\s*q\.options/);
    // answer_idx must not be assigned into the mapped object.
    assert.doesNotMatch(USER_MCQ_JS,
      /\.map\(\(q\) =>\s*\(\{[^}]*answer_idx/);
  });

  it('escapes feedback + option text via escapeHtml', () => {
    assert.match(USER_MCQ_JS, /function escapeHtml/);
  });

  it('uses the canonical Supabase project ref', () => {
    assert.match(USER_MCQ_JS, /nqhrtqspznepmveyurzm\.supabase\.co/);
  });
});


/* ── Admin MCQ editor ───────────────────────────────────────────── */

describe('Sprint 11.5 — admin MCQ editor contract', () => {
  it('ships audio + transcript-ref + questions list + save/publish', () => {
    assert.match(ADMIN_MCQ_HTML, /<audio-player\s+id="player"/);
    assert.match(ADMIN_MCQ_HTML, /id="transcript-ref"/);
    assert.match(ADMIN_MCQ_HTML, /id="questions-list"/);
    assert.match(ADMIN_MCQ_HTML, /id="btn-add"/);
    assert.match(ADMIN_MCQ_HTML, /id="btn-save"/);
    assert.match(ADMIN_MCQ_HTML, /id="btn-publish"/);
  });

  it('enforces 1-20 question MCQ range', () => {
    assert.match(ADMIN_MCQ_JS, /MIN_QUESTIONS\s*=\s*1/);
    assert.match(ADMIN_MCQ_JS, /MAX_QUESTIONS\s*=\s*20/);
  });

  it('POSTs /admin/listening/exercises with exercise_type=mcq', () => {
    assert.match(ADMIN_MCQ_JS, /api\.post\(\s*['"]\/admin\/listening\/exercises['"]/);
    assert.match(ADMIN_MCQ_JS, /exercise_type:\s*['"]mcq['"]/);
    assert.match(ADMIN_MCQ_JS, /questions/);
    assert.match(ADMIN_MCQ_JS, /answer_idx/);
  });

  it('saves draft + publish via separate handlers', () => {
    assert.match(ADMIN_MCQ_JS, /save\(['"]draft['"]\)/);
    assert.match(ADMIN_MCQ_JS, /save\(['"]published['"]\)/);
  });

  it('renders 4 letter options (A/B/C/D)', () => {
    assert.match(ADMIN_MCQ_JS, /LETTERS\s*=\s*\[\s*'A'\s*,\s*'B'\s*,\s*'C'\s*,\s*'D'\s*\]/);
  });
});


/* ── User Mini Test runner ──────────────────────────────────────── */

describe('Sprint 11.5 — user Mini Test runner contract', () => {
  it('mounts <aver-chrome active="listening"> + <audio-player>', () => {
    assert.match(USER_MT_HTML, /<aver-chrome\s+active=["']listening["']/);
    assert.match(USER_MT_HTML, /<audio-player\s+id="player"/);
  });

  it('ships progress bar + step frame + summary frame', () => {
    assert.match(USER_MT_HTML, /id="mt-progress-bar"/);
    assert.match(USER_MT_HTML, /id="mt-step"/);
    assert.match(USER_MT_HTML, /id="mt-summary"/);
    assert.match(USER_MT_HTML, /id="btn-next"/);
  });

  it('reads ?session_id and GETs /api/listening/sessions/{id}', () => {
    assert.match(USER_MT_JS, /URLSearchParams\(\s*window\.location\.search\s*\)/);
    assert.match(USER_MT_JS, /\/api\/listening\/sessions\//);
    assert.match(USER_MT_JS, /session_id/);
  });

  it('POSTs attempts with listening_session_id linkage', () => {
    assert.match(USER_MT_JS, /listening_session_id:\s*STATE\.sessionId/);
  });

  it('POSTs /api/listening/sessions/{id}/complete at end of run', () => {
    assert.match(USER_MT_JS, /\/api\/listening\/sessions\/.*\/complete/);
  });

  it('summary shows correct/total + score % + band estimate', () => {
    assert.match(USER_MT_HTML, /id="sum-correct"/);
    assert.match(USER_MT_HTML, /id="sum-score"/);
    assert.match(USER_MT_HTML, /id="sum-band"/);
  });

  it('dispatches by exercise_type for dictation/gist/true_false/mcq', () => {
    assert.match(USER_MT_JS, /exercise_type === 'dictation'/);
    assert.match(USER_MT_JS, /exercise_type === 'gist'/);
    assert.match(USER_MT_JS, /exercise_type === 'true_false'/);
    assert.match(USER_MT_JS, /exercise_type === 'mcq'/);
  });
});


/* ── Admin Mini Test builder ────────────────────────────────────── */

describe('Sprint 11.5 — admin Mini Test builder contract', () => {
  it('ships title input + pool + lineup + save', () => {
    assert.match(ADMIN_MT_HTML, /id="title-input"/);
    assert.match(ADMIN_MT_HTML, /id="pool-list"/);
    assert.match(ADMIN_MT_HTML, /id="lineup-list"/);
    assert.match(ADMIN_MT_HTML, /id="btn-save"/);
  });

  it('fetches pool from admin endpoints + lists existing sessions', () => {
    assert.match(ADMIN_MT_JS, /\/admin\/listening\/content\?status=published/);
    assert.match(ADMIN_MT_JS, /\/admin\/listening\/exercises\?content_id=/);
    assert.match(ADMIN_MT_JS, /\/admin\/listening\/sessions/);
  });

  it('POSTs to /admin/listening/sessions with exercise_ids[] + ordered_position[]', () => {
    assert.match(ADMIN_MT_JS, /api\.post\(\s*['"]\/admin\/listening\/sessions['"]/);
    assert.match(ADMIN_MT_JS, /exercise_ids:/);
    assert.match(ADMIN_MT_JS, /ordered_position:/);
  });

  it('supports lineup reorder (up / down / remove)', () => {
    assert.match(ADMIN_MT_JS, /data-action="up"/);
    assert.match(ADMIN_MT_JS, /data-action="down"/);
    assert.match(ADMIN_MT_JS, /data-action="remove"/);
  });
});


/* ── Content browse ─────────────────────────────────────────────── */

describe('Sprint 11.5 — content browse page contract', () => {
  it('mounts <aver-chrome active="listening">', () => {
    assert.match(BROWSE_HTML, /<aver-chrome\s+active=["']listening["']/);
  });

  it('ships accent + cefr + section filters', () => {
    assert.match(BROWSE_HTML, /id="filter-accent"/);
    assert.match(BROWSE_HTML, /id="filter-cefr"/);
    assert.match(BROWSE_HTML, /id="filter-section"/);
  });

  it('GETs /api/listening/content with filter query string', () => {
    assert.match(BROWSE_JS, /\/api\/listening\/content\?/);
    assert.match(BROWSE_JS, /accent_tag/);
    assert.match(BROWSE_JS, /cefr_level/);
    assert.match(BROWSE_JS, /ielts_section/);
  });

  it('renders per-card deep links into all 4 modes', () => {
    assert.match(BROWSE_JS, /\/pages\/listening-dictation\.html\?content_id=/);
    assert.match(BROWSE_JS, /\/pages\/listening-gist\.html\?content_id=/);
    assert.match(BROWSE_JS, /\/pages\/listening-tf\.html\?content_id=/);
    assert.match(BROWSE_JS, /\/pages\/listening-mcq\.html\?content_id=/);
  });
});


/* ── Analytics dashboard ────────────────────────────────────────── */

describe('Sprint 11.5 — analytics dashboard contract', () => {
  it('mounts <aver-chrome active="listening">', () => {
    assert.match(ANALYTICS_HTML, /<aver-chrome\s+active=["']listening["']/);
  });

  it('ships range tabs (7d / 30d / all)', () => {
    assert.match(ANALYTICS_HTML, /data-range="7d"/);
    assert.match(ANALYTICS_HTML, /data-range="30d"/);
    assert.match(ANALYTICS_HTML, /data-range="all"/);
  });

  it('GETs /api/listening/analytics with range param', () => {
    assert.match(ANALYTICS_JS, /\/api\/listening\/analytics\?range=/);
  });

  it('ships summary cards (total, avg, accuracy) + mode table + 14-day chart', () => {
    assert.match(ANALYTICS_HTML, /id="stat-total"/);
    assert.match(ANALYTICS_HTML, /id="stat-avg"/);
    assert.match(ANALYTICS_HTML, /id="stat-acc"/);
    assert.match(ANALYTICS_HTML, /id="mode-table-body"/);
    assert.match(ANALYTICS_HTML, /id="day-chart"/);
    assert.match(ANALYTICS_HTML, /id="recent-list"/);
    assert.match(ANALYTICS_HTML, /id="weakest-banner"/);
  });

  it('localises mode names to Vietnamese', () => {
    assert.match(ANALYTICS_JS, /'Chép chính tả'/);
    assert.match(ANALYTICS_JS, /'Nghe ý chính'/);
    assert.match(ANALYTICS_JS, /'Đúng \/ Sai'/);
    assert.match(ANALYTICS_JS, /'Trắc nghiệm'/);
  });
});


/* ── Cross-cutting design-token discipline ──────────────────────── */

describe('Sprint 11.5 — design-token discipline across the 6 new pages', () => {
  it('every page references --av-brand-teal-700 (canonical brand)', () => {
    for (const [name, html] of [
      ['user mcq',      USER_MCQ_HTML],
      ['admin mcq',     ADMIN_MCQ_HTML],
      ['user mt',       USER_MT_HTML],
      ['admin mt',      ADMIN_MT_HTML],
      ['browse',        BROWSE_HTML],
      ['analytics',     ANALYTICS_HTML],
    ]) {
      assert.match(html, /var\(--av-brand-teal-700\)/,
        `${name} page missing canonical brand teal token`);
    }
  });

  it('no raw #0F766E or #14B8A6 hex literals on any new page', () => {
    for (const [name, html] of [
      ['user mcq',      USER_MCQ_HTML],
      ['admin mcq',     ADMIN_MCQ_HTML],
      ['user mt',       USER_MT_HTML],
      ['admin mt',      ADMIN_MT_HTML],
      ['browse',        BROWSE_HTML],
      ['analytics',     ANALYTICS_HTML],
    ]) {
      assert.doesNotMatch(html, /#0F766E/i, `${name} regressed to hex brand teal 700`);
      assert.doesNotMatch(html, /#14B8A6/i, `${name} regressed to hex brand teal 500`);
    }
  });
});
