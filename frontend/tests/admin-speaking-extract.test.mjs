/**
 * frontend/tests/admin-speaking-extract.test.mjs
 *
 * Sprint 12.5 — pin the Speaking admin carve from `admin.html` monolith
 * into the new IA at /pages/admin/speaking/.
 *
 * Catches:
 *   - Speaking landing regressing to "Sắp ra mắt" stub
 *   - Sessions/Topics chrome embed regressing (active/subsection drift)
 *   - Filter bar / table headers / modal markup being lost
 *   - JS controllers (admin-speaking-sessions.js,
 *     admin-speaking-topics.js) regressing or losing wired endpoints
 *   - admin.html monolith losing the migration banners on the two
 *     carved panels OR the dead-JS DOM null-guards being removed
 *   - Regression: vocab_monitor / flashcards / ai-usage panels (still
 *     monolith-owned until 12.6/12.7/12.8) being accidentally torn out
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...rel) => readFileSync(join(__dirname, '..', ...rel), 'utf8');

const SPK_INDEX    = read('pages', 'admin', 'speaking', 'index.html');
const SPK_SESSIONS = read('pages', 'admin', 'speaking', 'sessions.html');
const SPK_TOPICS   = read('pages', 'admin', 'speaking', 'topics.html');
const JS_SESSIONS  = read('js', 'admin-speaking-sessions.js');
const JS_TOPICS    = read('js', 'admin-speaking-topics.js');
const ADMIN_LEGACY = read('admin.html');


/* ── Speaking landing ─────────────────────────────────────────── */

describe('Sprint 12.5 — speaking landing (pages/admin/speaking/index.html)', () => {
  it('embeds <aver-admin-chrome active="speaking"> (no subsection)', () => {
    assert.match(SPK_INDEX, /<aver-admin-chrome\s+active=["']speaking["']\s*>/);
  });

  it('links Sessions + Topics child pages with LIVE tag', () => {
    assert.match(SPK_INDEX, /href=["']\/pages\/admin\/speaking\/sessions\.html["']/);
    assert.match(SPK_INDEX, /href=["']\/pages\/admin\/speaking\/topics\.html["']/);
    // Both LIVE — at least two LIVE tags present.
    const liveTags = SPK_INDEX.match(/class="spk-tag"\s*>\s*LIVE/g) || [];
    assert.ok(liveTags.length >= 2,
      `expected at least 2 LIVE tags on speaking landing; got ${liveTags.length}`);
  });

  it('AI Usage card still flagged as Sprint 12.8 placeholder', () => {
    // Until cluster close, AI usage stays under the monolith — landing
    // should advertise that, not pretend it carved already.
    assert.match(SPK_INDEX, /Sprint 12\.8/);
    assert.match(SPK_INDEX, /spk-tag is-soon/);
  });

  it('loads the aver-admin-chrome module + error-reporter', () => {
    assert.match(SPK_INDEX, /<script\s+type="module"\s+src="\/js\/components\/aver-admin-chrome\.js"/);
    assert.match(SPK_INDEX, /<script\s+src="\/js\/error-reporter\.js"/);
  });
});


/* ── Sessions sub-page ────────────────────────────────────────── */

describe('Sprint 12.5 — speaking sessions page', () => {
  it('embeds <aver-admin-chrome active="speaking" subsection="sessions">', () => {
    assert.match(
      SPK_SESSIONS,
      /<aver-admin-chrome\s+active=["']speaking["']\s+subsection=["']sessions["']/,
    );
  });

  it('renders the 6-field filter bar (email/mode/status/error/from/to)', () => {
    for (const id of [
      'sf-email', 'sf-mode', 'sf-status', 'sf-error',
      'sf-date-from', 'sf-date-to',
    ]) {
      assert.match(SPK_SESSIONS, new RegExp(`id=["']${id}["']`),
        `sessions filter bar missing #${id}`);
    }
    assert.match(SPK_SESSIONS, /id=["']btn-search["']/);
    assert.match(SPK_SESSIONS, /id=["']btn-reset["']/);
  });

  it('renders the 9-column sessions table (ID/User/Mode/Topic/Band/...)', () => {
    assert.match(SPK_SESSIONS, /id=["']sessions-tbody["']/);
    // Spot-check three header cells in source order.
    assert.match(SPK_SESSIONS, /<th>ID<\/th>[\s\S]*?<th>User<\/th>[\s\S]*?<th>Mode<\/th>/);
    assert.match(SPK_SESSIONS, /<th>Band<\/th>[\s\S]*?<th>Status<\/th>[\s\S]*?<th>Lỗi<\/th>/);
  });

  it('carries detail modal + pagination button', () => {
    assert.match(SPK_SESSIONS, /id=["']modal-backdrop["']/);
    assert.match(SPK_SESSIONS, /id=["']detail-content["']/);
    assert.match(SPK_SESSIONS, /id=["']btn-more["']/);
  });

  it('loads admin-speaking-sessions.js as type=module', () => {
    assert.match(
      SPK_SESSIONS,
      /<script\s+type="module"\s+src="\/js\/admin-speaking-sessions\.js"/,
    );
  });
});


/* ── Topics sub-page ──────────────────────────────────────────── */

describe('Sprint 12.5 — speaking topics page', () => {
  it('embeds <aver-admin-chrome active="speaking" subsection="topics">', () => {
    assert.match(
      SPK_TOPICS,
      /<aver-admin-chrome\s+active=["']speaking["']\s+subsection=["']topics["']/,
    );
  });

  it('renders Part 1/2/3 tab buttons with data-part attribute', () => {
    assert.match(SPK_TOPICS, /data-part=["']1["'][^>]*>Part 1/);
    assert.match(SPK_TOPICS, /data-part=["']2["'][^>]*>Part 2/);
    assert.match(SPK_TOPICS, /data-part=["']3["'][^>]*>Part 3/);
  });

  it('renders search box + add-topic button + topics table', () => {
    assert.match(SPK_TOPICS, /id=["']search["']/);
    assert.match(SPK_TOPICS, /id=["']btn-add["']/);
    assert.match(SPK_TOPICS, /id=["']topics-tbody["']/);
  });

  it('renders both modals (topic CRUD + question CRUD with cue card row)', () => {
    // Topic modal
    assert.match(SPK_TOPICS, /id=["']modal-backdrop["']/);
    assert.match(SPK_TOPICS, /id=["']m-title["']/);
    assert.match(SPK_TOPICS, /id=["']m-part["']/);
    // Question modal
    assert.match(SPK_TOPICS, /id=["']modal-q-backdrop["']/);
    assert.match(SPK_TOPICS, /id=["']mq-text["']/);
    assert.match(SPK_TOPICS, /id=["']mq-cue-row["']/);  // Part-2 only row
  });

  it('loads admin-speaking-topics.js as type=module', () => {
    assert.match(
      SPK_TOPICS,
      /<script\s+type="module"\s+src="\/js\/admin-speaking-topics\.js"/,
    );
  });
});


/* ── JS controllers ───────────────────────────────────────────── */

describe('Sprint 12.5 — sessions JS controller', () => {
  it('declares PAGE_LIMIT (50) and pagination state', () => {
    assert.match(JS_SESSIONS, /const\s+PAGE_LIMIT\s*=\s*50/);
    assert.match(JS_SESSIONS, /let\s+_offset\s*=\s*0/);
  });

  it('keeps the wired backend endpoints from the monolith', () => {
    // Spot-check the four routes the carved-out JS depends on.
    for (const route of [
      '/admin/users',
      '/admin/sessions',
      '/admin/responses',
      '/admin/sessions',  // detail + regrade + rebuild-summary all share this prefix
    ]) {
      assert.ok(JS_SESSIONS.includes(route),
        `sessions JS missing route ${route}`);
    }
    // Specific regrade + rebuild paths.
    assert.match(JS_SESSIONS, /\/regrade/);
    assert.match(JS_SESSIONS, /\/rebuild-summary/);
  });

  it('uses VN locale (vi-VN) for date formatting', () => {
    assert.match(JS_SESSIONS, /toLocaleString\(\s*['"]vi-VN['"]/);
  });
});

describe('Sprint 12.5 — topics JS controller', () => {
  it('declares cached state (_all, _currentPart, _expanded)', () => {
    assert.match(JS_TOPICS, /let\s+_all\s*=\s*\[\]/);
    assert.match(JS_TOPICS, /let\s+_currentPart\s*=\s*1/);
    assert.match(JS_TOPICS, /const\s+_expanded\s*=\s*new Map\(\)/);
  });

  it('keeps the wired topic/question CRUD endpoints', () => {
    // List, CRUD, expand, AI generate.
    assert.match(JS_TOPICS, /\/admin\/topics/);
    assert.match(JS_TOPICS, /\/questions/);
    assert.match(JS_TOPICS, /\/generate-questions/);
  });

  it('bootstraps Supabase via the shared initSupabase API', () => {
    assert.match(JS_TOPICS, /window\.initSupabase/);
    assert.match(JS_SESSIONS, /window\.initSupabase/);
  });
});


/* ── admin.html monolith — carve banners + dead-JS guards ────── */

describe('Sprint 12.5 — admin.html carved panels still ship migration banners', () => {
  it('panel-topics carries banner linking to /pages/admin/speaking/topics.html', () => {
    // The Sprint-12.5 carve replaces the live markup with a banner.
    // Look for both the banner copy and the destination link.
    assert.match(ADMIN_LEGACY, /id=["']panel-topics["']/);
    assert.match(ADMIN_LEGACY, /Topics \+ Questions đã chuyển sang IA mới/);
    assert.match(
      ADMIN_LEGACY,
      /href=["']\/pages\/admin\/speaking\/topics\.html["']/,
    );
  });

  it('panel-sessions carries banner linking to /pages/admin/speaking/sessions.html', () => {
    assert.match(ADMIN_LEGACY, /id=["']panel-sessions["']/);
    assert.match(ADMIN_LEGACY, /Sessions Speaking đã chuyển sang IA mới/);
    assert.match(
      ADMIN_LEGACY,
      /href=["']\/pages\/admin\/speaking\/sessions\.html["']/,
    );
  });

  it('dead-JS DOM null-guards prevent 12.3 reporter noise on carved tabs', () => {
    // loadTopics() guards on #topics-loading; loadSessions() guards on
    // #sessions-loading. If either guard is removed, clicking a carved
    // tab in legacy admin.html would throw and the reporter would log
    // a phantom error.
    assert.match(
      ADMIN_LEGACY,
      /if\s*\(\s*!document\.getElementById\(\s*['"]topics-loading['"]\s*\)\s*\)\s*return/,
      'loadTopics() missing #topics-loading null-guard',
    );
    assert.match(
      ADMIN_LEGACY,
      /loadEl\s*=\s*document\.getElementById\(\s*['"]sessions-loading['"]\s*\)[\s\S]*?if\s*\(\s*!loadEl\s*\)\s*return/,
      'window.loadSessions missing #sessions-loading null-guard',
    );
  });
});

describe('Sprint 12.5 regression — other monolith panels still intact', () => {
  it('vocab_monitor / vocab_exercises panels still render (Sprint 12.6 target)', () => {
    assert.match(ADMIN_LEGACY, /id=["']panel-vocab_monitor["']/);
    assert.match(ADMIN_LEGACY, /id=["']panel-vocab_exercises["']/);
  });

  it('flashcards panel still renders (Sprint 12.6 target)', () => {
    assert.match(ADMIN_LEGACY, /id=["']panel-flashcards["']/);
  });

  it('alerts panel still renders (AI Usage carve = Sprint 12.8)', () => {
    assert.match(ADMIN_LEGACY, /id=["']panel-alerts["']/);
  });
});
