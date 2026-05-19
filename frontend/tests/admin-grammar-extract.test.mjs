/**
 * frontend/tests/admin-grammar-extract.test.mjs
 *
 * Sprint 12.7 — pin the Grammar admin surfaces. Grammar is the LAST
 * skill carve in the DEBT-ADMIN-IA-REFACTOR cluster (7/8). Per Andy
 * lock 2(c), articles stay file-based — admin is read-only browsing
 * + analytics + recommendation dogfood only.
 *
 * Catches:
 *   - Landing/articles/analytics/recommend-test chrome embed regressing
 *   - Read-only banner being silently dropped (would imply edit UI snuck in)
 *   - Filter bar / table headers / preset chips being lost
 *   - JS controllers losing wired endpoints
 *   - admin.html being accidentally edited to add Grammar (was clean — no carve needed)
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...rel) => readFileSync(join(__dirname, '..', ...rel), 'utf8');

const GRM_INDEX     = read('pages', 'admin', 'grammar', 'index.html');
const GRM_ARTICLES  = read('pages', 'admin', 'grammar', 'articles.html');
const GRM_ANALYTICS = read('pages', 'admin', 'grammar', 'analytics.html');
const GRM_RECOMMEND = read('pages', 'admin', 'grammar', 'recommend-test.html');
const JS_ARTICLES   = read('js', 'admin-grammar-articles.js');
const JS_ANALYTICS  = read('js', 'admin-grammar-analytics.js');
const JS_RECOMMEND  = read('js', 'admin-grammar-recommend.js');
const ADMIN_LEGACY  = read('admin.html');


/* ── Grammar landing ──────────────────────────────────────────── */

describe('Sprint 12.7 — grammar landing (pages/admin/grammar/index.html)', () => {
  it('embeds <aver-admin-chrome active="grammar"> (no subsection)', () => {
    assert.match(GRM_INDEX, /<aver-admin-chrome\s+active=["']grammar["']\s*>/);
  });

  it('links to the 3 grammar admin child pages', () => {
    assert.match(GRM_INDEX, /href=["']\/pages\/admin\/grammar\/articles\.html["']/);
    assert.match(GRM_INDEX, /href=["']\/pages\/admin\/grammar\/analytics\.html["']/);
    assert.match(GRM_INDEX, /href=["']\/pages\/admin\/grammar\/recommend-test\.html["']/);
  });

  it('carries the hybrid file-based banner explaining workflow', () => {
    // Andy lock 2(c) — banner must surface why admin is read-only.
    assert.match(GRM_INDEX, /Hybrid file-based pattern/);
    assert.match(GRM_INDEX, /backend\/content/);
    assert.match(GRM_INDEX, /git commit/);
  });

  it('Articles card is tagged READ-ONLY', () => {
    assert.match(GRM_INDEX, /grm-tag is-readonly[^"]*">\s*READ-ONLY/);
  });
});


/* ── Articles browser ─────────────────────────────────────────── */

describe('Sprint 12.7 — grammar articles browser', () => {
  it('embeds <aver-admin-chrome active="grammar" subsection="articles">', () => {
    assert.match(
      GRM_ARTICLES,
      /<aver-admin-chrome\s+active=["']grammar["']\s+subsection=["']articles["']/,
    );
  });

  it('renders the prominent READ-ONLY banner with workflow explanation', () => {
    // Hard pin: if anyone ships edit UI on this page, removing the
    // banner would be a giveaway — this assertion catches that.
    assert.match(GRM_ARTICLES, /class=["']gra-readonly["']/);
    assert.match(GRM_ARTICLES, /READ-ONLY/);
    assert.match(GRM_ARTICLES, /backend\/content/);
  });

  it('renders filter bar (category dropdown + search input) + reset', () => {
    assert.match(GRM_ARTICLES, /id=["']gra-category["']/);
    assert.match(GRM_ARTICLES, /id=["']gra-search["']/);
    assert.match(GRM_ARTICLES, /id=["']btn-search["']/);
    assert.match(GRM_ARTICLES, /id=["']btn-reset["']/);
  });

  it('renders 7-column table including views + saves columns', () => {
    assert.match(GRM_ARTICLES, /id=["']gra-tbody["']/);
    assert.match(GRM_ARTICLES, /<th>Title<\/th>[\s\S]*?<th>Slug<\/th>[\s\S]*?<th>Category<\/th>/);
    assert.match(GRM_ARTICLES, /<th>Views<\/th>[\s\S]*?<th>Saves<\/th>[\s\S]*?<th>Source path<\/th>/);
  });

  it('does NOT render any edit/create/delete affordance', () => {
    // Pin the read-only contract.
    assert.doesNotMatch(GRM_ARTICLES, /onclick=["'][^"']*(?:edit|delete|create)Article/i);
    assert.doesNotMatch(GRM_ARTICLES, /<button[^>]*>\s*Xoá article/i);
  });

  it('loads admin-grammar-articles.js as type=module', () => {
    assert.match(GRM_ARTICLES, /<script\s+type="module"\s+src="\/js\/admin-grammar-articles\.js"/);
  });
});


/* ── Analytics ────────────────────────────────────────────────── */

describe('Sprint 12.7 — grammar analytics', () => {
  it('embeds <aver-admin-chrome active="grammar" subsection="analytics">', () => {
    assert.match(
      GRM_ANALYTICS,
      /<aver-admin-chrome\s+active=["']grammar["']\s+subsection=["']analytics["']/,
    );
  });

  it('renders the 4 required stat tiles', () => {
    for (const stat of [
      'views_total', 'views_recent', 'saves_total', 'zero_view_total',
    ]) {
      assert.match(GRM_ANALYTICS, new RegExp(`data-stat=["']${stat}["']`),
        `analytics page missing stat tile ${stat}`);
    }
  });

  it('renders top-viewed + top-saved + zero-view tables', () => {
    assert.match(GRM_ANALYTICS, /id=["']top-tbody["']/);
    assert.match(GRM_ANALYTICS, /id=["']saved-tbody["']/);
    assert.match(GRM_ANALYTICS, /id=["']zero-tbody["']/);
  });

  it('renders window selector (7/14/30/90 days) + refresh button', () => {
    assert.match(GRM_ANALYTICS, /id=["']gan-days["']/);
    for (const days of ['7', '14', '30', '90']) {
      assert.match(GRM_ANALYTICS, new RegExp(`value=["']${days}["']`));
    }
    assert.match(GRM_ANALYTICS, /id=["']btn-refresh["']/);
  });

  it('loads admin-grammar-analytics.js as type=module', () => {
    assert.match(GRM_ANALYTICS, /<script\s+type="module"\s+src="\/js\/admin-grammar-analytics\.js"/);
  });
});


/* ── Recommendation tester ───────────────────────────────────── */

describe('Sprint 12.7 — grammar recommendation tester', () => {
  it('embeds <aver-admin-chrome active="grammar" subsection="recommend-test">', () => {
    assert.match(
      GRM_RECOMMEND,
      /<aver-admin-chrome\s+active=["']grammar["']\s+subsection=["']recommend-test["']/,
    );
  });

  it('renders the form (textarea + match button + clear button)', () => {
    assert.match(GRM_RECOMMEND, /id=["']grt-issue["']/);
    assert.match(GRM_RECOMMEND, /id=["']btn-match["']/);
    assert.match(GRM_RECOMMEND, /id=["']btn-clear["']/);
  });

  it('renders ≥3 preset chips so Andy can dogfood quickly', () => {
    const presets = GRM_RECOMMEND.match(/class=["']grt-preset["']/g) || [];
    assert.ok(presets.length >= 3,
      `expected ≥3 preset chips, got ${presets.length}`);
  });

  it('renders result + no-match result blocks (both hidden by default)', () => {
    assert.match(GRM_RECOMMEND, /id=["']grt-result["']\s+hidden/);
    assert.match(GRM_RECOMMEND, /id=["']grt-no-match["']\s+hidden/);
    assert.match(GRM_RECOMMEND, /id=["']grt-score["']/);
  });

  it('loads admin-grammar-recommend.js as type=module', () => {
    assert.match(GRM_RECOMMEND, /<script\s+type="module"\s+src="\/js\/admin-grammar-recommend\.js"/);
  });
});


/* ── JS controllers ───────────────────────────────────────────── */

describe('Sprint 12.7 — grammar JS controllers', () => {
  it('articles controller wires list + preview endpoints', () => {
    assert.match(JS_ARTICLES, /\/admin\/grammar\/articles/);
    assert.match(JS_ARTICLES, /\/preview/);
  });

  it('analytics controller wires /admin/grammar/analytics with days param', () => {
    assert.match(JS_ANALYTICS, /\/admin\/grammar\/analytics\?days=/);
  });

  it('recommend controller posts to /admin/grammar/recommend-test', () => {
    assert.match(JS_RECOMMEND, /api\.post\(['"]\/admin\/grammar\/recommend-test['"]/);
  });
});


/* ── admin.html regression — Grammar was never in monolith ───── */

describe('Sprint 12.7 regression — admin.html monolith untouched', () => {
  it('no grammar-related panel or tab IDs leaked into admin.html', () => {
    // Per Discovery #73 inventory, Grammar had ZERO presence in
    // admin.html before Sprint 12.7. Pin the carve was clean —
    // no accidental "tab-btn-grammar" or "panel-grammar" snuck in.
    assert.doesNotMatch(ADMIN_LEGACY, /id=["']tab-btn-grammar["']/);
    assert.doesNotMatch(ADMIN_LEGACY, /id=["']panel-grammar["']/);
  });

  it('still-monolith panels (vocab_exercises / alerts / ai_usage) intact', () => {
    // Vocab Exercises admin pool stays (per Sprint 12.6 deferral).
    // Alerts + AI usage stay until Sprint 12.8 cluster close.
    assert.match(ADMIN_LEGACY, /id=["']panel-vocab_exercises["']/);
    assert.match(ADMIN_LEGACY, /id=["']panel-alerts["']/);
    assert.match(ADMIN_LEGACY, /id=["']panel-ai_usage["']/);
  });
});
