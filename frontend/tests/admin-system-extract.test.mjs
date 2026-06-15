/**
 * frontend/tests/admin-system-extract.test.mjs
 *
 * Sprint 12.8 — pin the FINAL three monolith carves:
 *   - panel-ai_usage    → /pages/admin/system/ai-usage.html
 *   - panel-alerts      → /pages/admin/system/alerts.html
 *   - panel-vocab_exercises → /pages/admin/vocab/exercises.html
 *
 * Plus the Users page promotion (placeholder → real role-management UI)
 * and the closure-state of admin.html (covered separately in
 * admin-monolith-redesign.test.mjs).
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...rel) => readFileSync(join(__dirname, '..', ...rel), 'utf8');

const SYS_INDEX    = read('pages', 'admin', 'system', 'index.html');
const SYS_AIUSAGE  = read('pages', 'admin', 'system', 'ai-usage.html');
const SYS_ALERTS   = read('pages', 'admin', 'system', 'alerts.html');
const VEX          = read('pages', 'admin', 'vocab', 'exercises.html');
const USERS        = read('pages', 'admin', 'users', 'index.html');
const JS_AIUSAGE   = read('js', 'admin-ai-usage.js');
const JS_ALERTS    = read('js', 'admin-alerts.js');
const JS_VEX       = read('js', 'admin-vocab-exercises.js');
const JS_USERS     = read('js', 'admin-users.js');
const ADMIN_LEGACY = read('admin.html');


/* ── System landing ───────────────────────────────────────────── */

describe('Sprint 12.8 — system landing', () => {
  it('embeds <aver-admin-chrome active="system"> (no subsection)', () => {
    assert.match(SYS_INDEX, /<aver-admin-chrome\s+active=["']system["']\s*>/);
  });

  it('links to the 2 system sub-pages (ai-usage + alerts)', () => {
    assert.match(SYS_INDEX, /href=["']\/pages\/admin\/system\/ai-usage\.html["']/);
    assert.match(SYS_INDEX, /href=["']\/pages\/admin\/system\/alerts\.html["']/);
  });

  it('is no longer a placeholder', () => {
    assert.doesNotMatch(SYS_INDEX, /Sắp ra mắt/);
  });
});


/* ── AI Usage sub-page ────────────────────────────────────────── */

describe('Sprint 12.8 — AI Usage page', () => {
  it('embeds <aver-admin-chrome active="system" subsection="ai-usage">', () => {
    assert.match(
      SYS_AIUSAGE,
      /<aver-admin-chrome\s+active=["']system["']\s+subsection=["']ai-usage["']/,
    );
  });

  it('renders the 4 service tiles (total / claude / gemini / other)', () => {
    for (const stat of ['total_cost', 'claude_cost', 'gemini_cost', 'other_cost']) {
      assert.match(SYS_AIUSAGE, new RegExp(`data-stat=["']${stat}["']`));
    }
  });

  it('renders period selector with 5 windows', () => {
    assert.match(SYS_AIUSAGE, /id=["']aiu-days["']/);
    for (const v of ['1', '7', '30', '90']) {
      assert.match(SYS_AIUSAGE, new RegExp(`value=["']${v}["']`));
    }
  });

  it('renders per-user breakdown table with tbody', () => {
    assert.match(SYS_AIUSAGE, /id=["']users-tbody["']/);
  });

  it('loads admin-ai-usage.js as type=module', () => {
    assert.match(SYS_AIUSAGE, /<script\s+type="module"\s+src="\/js\/admin-ai-usage\.js"/);
  });
});


/* ── Alerts sub-page ──────────────────────────────────────────── */

describe('Sprint 12.8 — Alerts page', () => {
  it('embeds <aver-admin-chrome active="system" subsection="alerts">', () => {
    assert.match(
      SYS_ALERTS,
      /<aver-admin-chrome\s+active=["']system["']\s+subsection=["']alerts["']/,
    );
  });

  it('renders both alert sections (session errors + grading failures)', () => {
    assert.match(SYS_ALERTS, /id=["']alr-sessions-tbody["']/);
    assert.match(SYS_ALERTS, /id=["']alr-grading-tbody["']/);
  });

  it('renders refresh button + status banner', () => {
    assert.match(SYS_ALERTS, /id=["']btn-refresh["']/);
    assert.match(SYS_ALERTS, /id=["']alr-status["']/);
  });

  it('loads admin-alerts.js as type=module', () => {
    assert.match(SYS_ALERTS, /<script\s+type="module"\s+src="\/js\/admin-alerts\.js"/);
  });
});


/* ── Vocab Exercises sub-page ─────────────────────────────────── */

describe('Sprint 12.8 — Vocab Exercises page', () => {
  it('embeds <aver-admin-chrome active="vocab" subsection="exercises">', () => {
    assert.match(
      VEX,
      /<aver-admin-chrome\s+active=["']vocab["']\s+subsection=["']exercises["']/,
    );
  });

  it('renders the 3 status tabs (draft / published / rejected)', () => {
    for (const status of ['draft', 'published', 'rejected']) {
      assert.match(VEX, new RegExp(`data-status=["']${status}["']`),
        `vex page missing status tab ${status}`);
      assert.match(VEX, new RegExp(`id=["']vex-tab-${status}["']`));
    }
  });

  it('renders bulk action bar (select-all + publish + reject)', () => {
    assert.match(VEX, /id=["']btn-select-all["']/);
    assert.match(VEX, /id=["']btn-bulk-publish["']/);
    assert.match(VEX, /id=["']btn-bulk-reject["']/);
  });

  it('renders the Generate batch modal with words + count fields', () => {
    assert.match(VEX, /id=["']vex-batch-backdrop["']/);
    assert.match(VEX, /id=["']vex-batch-words["']/);
    assert.match(VEX, /id=["']vex-batch-count["']/);
    assert.match(VEX, /id=["']btn-batch-submit["']/);
  });

  it('loads admin-vocab-exercises.js as type=module', () => {
    assert.match(VEX, /<script\s+type="module"\s+src="\/js\/admin-vocab-exercises\.js"/);
  });
});


/* ── Users page promotion ─────────────────────────────────────── */

describe('Sprint 12.8 — Users page (promoted from placeholder)', () => {
  it('embeds <aver-admin-chrome active="users"> (no subsection)', () => {
    assert.match(USERS, /<aver-admin-chrome\s+active=["']users["']\s*>/);
  });

  it('renders role filter + search input', () => {
    assert.match(USERS, /id=["']usr-role["']/);
    assert.match(USERS, /id=["']usr-search["']/);
    for (const role of ['admin', 'instructor', 'student']) {
      assert.match(USERS, new RegExp(`value=["']${role}["']`));
    }
  });

  it('renders users table with merged code columns + role-change select', () => {
    assert.match(USERS, /id=["']usr-tbody["']/);
    // merge-codes PR-2: header gained Mã/Loại/Quyền/Trạng-thái + sortable cols.
    assert.match(USERS, /data-sort="display_name"[\s\S]*?<th>Email<\/th>[\s\S]*?<th>Mã<\/th>[\s\S]*?data-sort="code_type"[\s\S]*?data-sort="role"/);
  });

  it('loads admin-users.js as type=module', () => {
    assert.match(USERS, /<script\s+type="module"\s+src="\/js\/admin-users\.js"/);
  });

  it('no longer carries the Sprint 12.1 placeholder banner', () => {
    assert.doesNotMatch(USERS, /Sắp ra mắt/);
  });
});


/* ── JS controllers ───────────────────────────────────────────── */

describe('Sprint 12.8 — system + vocab-exercises JS controllers', () => {
  it('admin-ai-usage.js wires /admin/ai-usage with optional days', () => {
    assert.match(JS_AIUSAGE, /['"]\/admin\/ai-usage['"]/);
    assert.match(JS_AIUSAGE, /\?days=/);
  });

  it('admin-alerts.js wires /admin/alerts', () => {
    assert.match(JS_ALERTS, /\/admin\/alerts/);
  });

  it('admin-vocab-exercises.js wires the 5 monolith endpoints', () => {
    assert.match(JS_VEX, /\/admin\/exercises\?/);
    assert.match(JS_VEX, /\/admin\/exercises\/[^'"]*\/' \+ action|exercises\/[^'"]+\/' \+ action|\/' \+ action/);
    assert.match(JS_VEX, /\/admin\/exercises\/bulk/);
    assert.match(JS_VEX, /\/admin\/exercises\/d1\/generate-batch/);
  });

  it('admin-users.js wires GET /admin/users + PATCH /admin/users/{id}/role', () => {
    assert.match(JS_USERS, /['"]\/admin\/users['"]/);
    assert.match(JS_USERS, /api\.patch\(\s*['"]\/admin\/users\//);
    assert.match(JS_USERS, /\/role/);
  });
});


/* ── Cluster closure regression ───────────────────────────────── */

describe('Sprint 12.8 — admin.html is a pure redirect (cluster closure)', () => {
  it('zero panel-* IDs survive the closure', () => {
    const panels = ADMIN_LEGACY.match(/id=["']panel-[a-z_]+["']/g) || [];
    assert.equal(panels.length, 0,
      `Expected zero panel-* IDs; found: ${panels.join(', ')}`);
  });

  it('meta refresh + JS replace() both target /pages/admin/index.html', () => {
    assert.match(
      ADMIN_LEGACY,
      /<meta\s+http-equiv=["']refresh["'][^>]*url=\/pages\/admin\/index\.html/,
    );
    assert.match(
      ADMIN_LEGACY,
      /window\.location\.replace\(\s*['"]\/pages\/admin\/index\.html['"]\s*\)/,
    );
  });
});
