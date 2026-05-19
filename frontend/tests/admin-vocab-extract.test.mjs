/**
 * frontend/tests/admin-vocab-extract.test.mjs
 *
 * Sprint 12.6 — pin the Vocab admin carve from `admin.html` monolith
 * into the new IA at /pages/admin/vocab/, plus the brand-new D1
 * curation + lemma overrides surfaces.
 *
 * Catches:
 *   - Vocab landing regressing to "Sắp ra mắt" stub
 *   - Stats / D1 curation / Lemmas chrome embed regressing
 *   - Filter bars / tables / modal markup being lost
 *   - JS controllers (admin-vocab-stats.js, admin-vocab-d1.js,
 *     admin-vocab-lemmas.js) regressing or losing wired endpoints
 *   - admin.html monolith losing the migration banners on the two
 *     carved panels (vocab_monitor + flashcards)
 *   - Regression: AI usage + alerts + vocab_exercises panels (still
 *     monolith-owned) being accidentally torn out
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...rel) => readFileSync(join(__dirname, '..', ...rel), 'utf8');

const VCB_INDEX     = read('pages', 'admin', 'vocab', 'index.html');
const VCB_STATS     = read('pages', 'admin', 'vocab', 'stats.html');
const VCB_D1        = read('pages', 'admin', 'vocab', 'd1-curation.html');
const VCB_LEMMAS    = read('pages', 'admin', 'vocab', 'lemmas.html');
const JS_STATS      = read('js', 'admin-vocab-stats.js');
const JS_D1         = read('js', 'admin-vocab-d1.js');
const JS_LEMMAS     = read('js', 'admin-vocab-lemmas.js');
const ADMIN_LEGACY  = read('admin.html');


/* ── Vocab landing ────────────────────────────────────────────── */

describe('Sprint 12.6 — vocab landing (pages/admin/vocab/index.html)', () => {
  it('embeds <aver-admin-chrome active="vocab"> (no subsection)', () => {
    assert.match(VCB_INDEX, /<aver-admin-chrome\s+active=["']vocab["']\s*>/);
  });

  it('links Stats + D1 Curation + Lemmas child pages', () => {
    assert.match(VCB_INDEX, /href=["']\/pages\/admin\/vocab\/stats\.html["']/);
    assert.match(VCB_INDEX, /href=["']\/pages\/admin\/vocab\/d1-curation\.html["']/);
    assert.match(VCB_INDEX, /href=["']\/pages\/admin\/vocab\/lemmas\.html["']/);
  });

  it('marks D1 + Lemmas as new Sprint 12.6 surfaces', () => {
    assert.match(VCB_INDEX, /NEW.*Sprint 12\.6/);
  });
});


/* ── Stats sub-page ───────────────────────────────────────────── */

describe('Sprint 12.6 — vocab stats page', () => {
  it('embeds <aver-admin-chrome active="vocab" subsection="stats">', () => {
    assert.match(
      VCB_STATS,
      /<aver-admin-chrome\s+active=["']vocab["']\s+subsection=["']stats["']/,
    );
  });

  it('renders the four core vocab bank tiles', () => {
    for (const id of [
      'vocab-bank-total', 'vocab-fp-total',
      'vocab-fp-rate', 'vocab-enabled-count',
    ]) {
      assert.match(VCB_STATS, new RegExp(`id=["']${id}["']`),
        `stats page missing #${id}`);
    }
  });

  it('renders the per-user feature flag toggle controls', () => {
    assert.match(VCB_STATS, /id=["']flag-user-id["']/);
    assert.match(VCB_STATS, /id=["']btn-flag-enable["']/);
    assert.match(VCB_STATS, /id=["']btn-flag-disable["']/);
  });

  it('renders flashcard SRS sections (activity / srs / engagement)', () => {
    assert.match(VCB_STATS, /id=["']fcs-period["']/);
    assert.match(VCB_STATS, /id=["']fcs-activity["']/);
    assert.match(VCB_STATS, /id=["']fcs-srs["']/);
    assert.match(VCB_STATS, /id=["']fcs-engagement["']/);
  });

  it('loads admin-vocab-stats.js as type=module', () => {
    assert.match(VCB_STATS, /<script\s+type="module"\s+src="\/js\/admin-vocab-stats\.js"/);
  });
});


/* ── D1 curation sub-page ─────────────────────────────────────── */

describe('Sprint 12.6 — D1 curation page', () => {
  it('embeds <aver-admin-chrome active="vocab" subsection="d1-curation">', () => {
    assert.match(
      VCB_D1,
      /<aver-admin-chrome\s+active=["']vocab["']\s+subsection=["']d1-curation["']/,
    );
  });

  it('renders the filter bar (source, active, user_id)', () => {
    assert.match(VCB_D1, /id=["']d1-source["']/);
    assert.match(VCB_D1, /id=["']d1-active["']/);
    assert.match(VCB_D1, /id=["']d1-user["']/);
    assert.match(VCB_D1, /id=["']btn-search["']/);
    assert.match(VCB_D1, /id=["']btn-reset["']/);
  });

  it('renders the source filter options (haiku/gemini/fallback)', () => {
    assert.match(VCB_D1, /value=["']haiku["']/);
    assert.match(VCB_D1, /value=["']gemini["']/);
    assert.match(VCB_D1, /value=["']fallback_evidence["']/);
  });

  it('renders the 8-column table with tbody + pagination', () => {
    assert.match(VCB_D1, /id=["']d1-tbody["']/);
    assert.match(VCB_D1, /<th>Headword<\/th>[\s\S]*?<th>Context<\/th>[\s\S]*?<th>Target<\/th>/);
    assert.match(VCB_D1, /<th>Source<\/th>[\s\S]*?<th>Attempts<\/th>[\s\S]*?<th>Trạng thái<\/th>/);
    assert.match(VCB_D1, /id=["']btn-more["']/);
  });

  it('loads admin-vocab-d1.js as type=module', () => {
    assert.match(VCB_D1, /<script\s+type="module"\s+src="\/js\/admin-vocab-d1\.js"/);
  });
});


/* ── Lemma overrides sub-page ─────────────────────────────────── */

describe('Sprint 12.6 — lemma overrides page', () => {
  it('embeds <aver-admin-chrome active="vocab" subsection="lemmas">', () => {
    assert.match(
      VCB_LEMMAS,
      /<aver-admin-chrome\s+active=["']vocab["']\s+subsection=["']lemmas["']/,
    );
  });

  it('renders the search toolbar + add-override button + table', () => {
    assert.match(VCB_LEMMAS, /id=["']search["']/);
    assert.match(VCB_LEMMAS, /id=["']btn-search["']/);
    assert.match(VCB_LEMMAS, /id=["']btn-add["']/);
    assert.match(VCB_LEMMAS, /id=["']lem-tbody["']/);
  });

  it('renders the add-override modal with all fields', () => {
    assert.match(VCB_LEMMAS, /id=["']modal-backdrop["']/);
    assert.match(VCB_LEMMAS, /id=["']m-word["']/);
    assert.match(VCB_LEMMAS, /id=["']m-lemma["']/);
    assert.match(VCB_LEMMAS, /id=["']m-pos["']/);
    assert.match(VCB_LEMMAS, /id=["']m-notes["']/);
    assert.match(VCB_LEMMAS, /id=["']btn-submit["']/);
  });

  it('loads admin-vocab-lemmas.js as type=module', () => {
    assert.match(VCB_LEMMAS, /<script\s+type="module"\s+src="\/js\/admin-vocab-lemmas\.js"/);
  });
});


/* ── JS controllers ───────────────────────────────────────────── */

describe('Sprint 12.6 — vocab stats JS controller', () => {
  it('wires GET /admin/vocab/stats + flashcards stats + flag toggle', () => {
    assert.match(JS_STATS, /\/admin\/vocab\/stats/);
    assert.match(JS_STATS, /\/admin\/flashcards\/stats/);
    assert.match(JS_STATS, /\/vocab-flag/);
  });

  it('uses VN locale (vi-VN) for date formatting where relevant', () => {
    // Not used by stats page directly; but the d1/lemmas controllers do.
    assert.match(JS_D1, /toLocaleString\(\s*['"]vi-VN['"]/);
    assert.match(JS_LEMMAS, /toLocaleString\(\s*['"]vi-VN['"]/);
  });
});

describe('Sprint 12.6 — D1 curation JS controller', () => {
  it('declares PAGE_LIMIT pagination state', () => {
    assert.match(JS_D1, /const\s+PAGE_LIMIT\s*=\s*50/);
    assert.match(JS_D1, /let\s+_offset\s*=\s*0/);
  });

  it('wires GET / PATCH / DELETE on /admin/vocab/d1-questions', () => {
    assert.match(JS_D1, /api\.get\(['"]\/admin\/vocab\/d1-questions/);
    assert.match(JS_D1, /api\.patch\(['"]\/admin\/vocab\/d1-questions/);
    assert.match(JS_D1, /api\.delete\(['"]\/admin\/vocab\/d1-questions/);
  });
});

describe('Sprint 12.6 — lemma overrides JS controller', () => {
  it('wires the three CRUD endpoints', () => {
    assert.match(JS_LEMMAS, /api\.get\(['"]\/admin\/vocab\/lemmas\/overrides/);
    assert.match(JS_LEMMAS, /api\.post\(['"]\/admin\/vocab\/lemmas\/overrides/);
    assert.match(JS_LEMMAS, /api\.delete\(['"]\/admin\/vocab\/lemmas\/overrides/);
  });
});


/* ── admin.html monolith — carve banners + dead-JS guards ────── */

describe('Sprint 12.6 — vocab carve survives Sprint 12.8 closure', () => {
  // Sprint 12.8 collapsed admin.html into a pure redirect. The old
  // "migration banner" pins are obsolete — panel-vocab_monitor /
  // panel-flashcards / panel-vocab_exercises markup no longer exists
  // in admin.html. What we pin now is that they didn't sneak back in.
  it('panel-vocab_monitor / panel-flashcards IDs are gone from admin.html', () => {
    assert.doesNotMatch(ADMIN_LEGACY, /id=["']panel-vocab_monitor["']/);
    assert.doesNotMatch(ADMIN_LEGACY, /id=["']panel-flashcards["']/);
  });

  it('admin-flashcard-stats.js script tag stays out of admin.html', () => {
    assert.doesNotMatch(
      ADMIN_LEGACY,
      /<script\s+src=["']js\/admin-flashcard-stats\.js["']/,
    );
  });

  it('admin.html redirects to the unified IA', () => {
    assert.match(ADMIN_LEGACY, /\/pages\/admin\/index\.html/);
  });
});
