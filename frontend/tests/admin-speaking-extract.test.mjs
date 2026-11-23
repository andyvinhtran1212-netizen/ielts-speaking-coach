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
// LEGACYJS-0075 W4b: both speaking controllers are deleted; the Next owners and
// the typed sessions client hold the wiring (fixtures stay, ADR-005).
const JS_SESSIONS  = read('app', '(authed-admin-speaking-sessions)', 'admin', 'speaking', 'sessions', 'admin-speaking-sessions.tsx');
const API_SESSIONS = read('lib', 'admin-speaking-sessions-api.ts');
const JS_TOPICS    = read('app', '(authed-admin-speaking-topics)', 'admin', 'speaking', 'topics', 'admin-speaking-topics.tsx');
const ADMIN_LEGACY = read('admin.html');


/* ── Speaking landing ─────────────────────────────────────────── */

describe('Sprint 12.5 — speaking landing (pages/admin/speaking/index.html)', () => {
  it('embeds <aver-admin-chrome active="speaking"> (no subsection)', () => {
    assert.match(SPK_INDEX, /<aver-admin-chrome\s+active=["']speaking["']\s*>/);
  });

  it('links Sessions + Topics child pages with LIVE tag', () => {
    assert.match(SPK_INDEX, /href=["']\/admin\/speaking\/sessions["']/);
    assert.match(SPK_INDEX, /href=["']\/admin\/speaking\/topics["']/);
    // Both LIVE — at least two LIVE tags present.
    const liveTags = SPK_INDEX.match(/class="adm-status-pill is-live"\s*>\s*LIVE/g) || [];  // design-fix-2: hub tags reuse .adm-status-pill
    assert.ok(liveTags.length >= 2,
      `expected at least 2 LIVE tags on speaking landing; got ${liveTags.length}`);
  });

  it('AI Usage card points to the native System workspace', () => {
    assert.match(SPK_INDEX, /href=["']\/admin\/system["']/);
    assert.doesNotMatch(SPK_INDEX, /Sprint 12\.8|href=["']\/admin\.html["']/);
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

describe('Sprint 12.5 — sessions controller (Next owner)', () => {
  it('declares PAGE_LIMIT (50) and pagination state', () => {
    assert.match(JS_SESSIONS, /const\s+PAGE_LIMIT\s*=\s*50/);
    assert.match(JS_SESSIONS, /const offset = reset \? 0 : nextOffset/);
  });

  it('keeps the wired backend endpoints from the monolith', () => {
    // Spot-check the four routes the carved-out JS depends on.
    // The user filter now sends user_email to /admin/sessions instead of
    // reading /admin/users first.
    for (const route of [
      "'/admin/sessions'",
      "'/admin/sessions/{session_id}'",
      "'/admin/responses/{response_id}/regrade'",
      "'/admin/sessions/{session_id}/regrade'",
      "'/admin/sessions/{session_id}/rebuild-summary'",
    ]) {
      assert.ok(API_SESSIONS.includes(route), `sessions client missing route ${route}`);
    }
    assert.match(JS_SESSIONS, /query\.set\('user_email', target\.email\)/);
  });

  it('uses VN locale (vi-VN) for date formatting', () => {
    assert.match(JS_SESSIONS, /new Intl\.DateTimeFormat\('vi-VN', \{ timeZone: 'Asia\/Ho_Chi_Minh'/);
  });
});

describe('Sprint 12.5 — topics controller (Next owner)', () => {
  it('keeps topic list, part (default 1) and question snapshot in state', () => {
    assert.match(JS_TOPICS, /const \[snapshot, setSnapshot\] = useState<\{ account: string; rows: SpeakingTopic\[\]; malformed: number \} \| null>\(null\)/);
    assert.match(JS_TOPICS, /const part = \(parsedPart === 2 \|\| parsedPart === 3 \? parsedPart : 1\)/);
    assert.match(JS_TOPICS, /const \[questions, setQuestions\] = useState<QuestionSnapshot \| null>\(null\)/);
  });

  it('keeps the wired topic/question CRUD endpoints', () => {
    // List, CRUD, expand, AI generate.
    assert.match(JS_TOPICS, /window\.api\.get<unknown>\('\/admin\/topics'\)/);
    assert.match(JS_TOPICS, /`\/admin\/topics\/\$\{encodeURIComponent\(topicId\)\}\/questions`/);
    assert.match(JS_TOPICS, /\/generate-questions/);
  });

  it('reads the admin account from the shared access gate (no own Supabase client)', () => {
    for (const src of [JS_TOPICS, JS_SESSIONS]) {
      assert.match(src, /import \{ useAdminProfile \} from '@\/components\/admin-access-gate'/);
      assert.doesNotMatch(src, /createClient\(/);
    }
  });
});


/* ── admin.html monolith — carve banners + dead-JS guards ────── */

describe('Sprint 12.5 — speaking carve survives Sprint 12.8 monolith closure', () => {
  // Sprint 12.8 flipped admin.html to a pure redirect. The old banner
  // assertions (panel-topics / panel-sessions banner markup, dead-JS
  // null guards) are obsolete — those panels no longer exist. What we
  // still want to pin is that the speaking IA pages themselves are
  // intact (covered by the suites above) AND that the now-redirected
  // admin.html doesn't re-introduce the carved markup.
  it('admin.html no longer carries panel-topics / panel-sessions IDs', () => {
    assert.doesNotMatch(ADMIN_LEGACY, /id=["']panel-topics["']/);
    assert.doesNotMatch(ADMIN_LEGACY, /id=["']panel-sessions["']/);
  });

  it('admin.html redirects to the new IA (where Speaking lives)', () => {
    assert.match(ADMIN_LEGACY, /\/admin/);
  });
});

// Sprint 12.5 regression block on still-monolith panels (vocab_monitor /
// vocab_exercises / flashcards / alerts) intentionally retired: those
// surfaces all carved out between Sprints 12.6 and 12.8. Per-section
// closure pins now live in admin-vocab-extract / admin-grammar-extract
// / admin-monolith-redesign tests.
