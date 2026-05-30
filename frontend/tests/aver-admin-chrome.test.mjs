/**
 * frontend/tests/aver-admin-chrome.test.mjs
 *
 * Sprint 12.1 — pin <aver-admin-chrome> + the admin IA route map
 * (DEBT-ADMIN-IA-REFACTOR execution 1/8).
 *
 * Sentinel-string match against the static source. Catches:
 *   - Nav roster drift (a sprint that removes/renames a section)
 *   - Phase B placeholders losing their "Sắp ra mắt" tag
 *   - 13 page moves regressing (any moved page reverting to flat path)
 *   - 13 redirects in vercel.json regressing
 *   - admin.html legacy banner being lost
 *   - aver-admin-chrome embedding on the 13 moved pages regressing
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...rel) => readFileSync(join(__dirname, '..', ...rel), 'utf8');

const CHROME_JS    = read('js', 'components', 'aver-admin-chrome.js');
const ADMIN_INDEX  = read('pages', 'admin', 'index.html');
const ADMIN_LEGACY = read('admin.html');
const VERCEL_JSON  = read('vercel.json');


/* ── Component source contract ─────────────────────────────────── */

describe('Sprint 12.1 — aver-admin-chrome component source', () => {
  it('exports AverAdminChrome class + customElements.define', () => {
    assert.match(CHROME_JS, /export class AverAdminChrome extends HTMLElement/);
    assert.match(CHROME_JS, /customElements\.define\(\s*['"]aver-admin-chrome['"]/);
  });

  it('declares observedAttributes including active', () => {
    assert.match(CHROME_JS, /static get observedAttributes\(\)\s*\{\s*return\s*\[\s*['"]active['"]/);
  });

  it('attaches a shadow DOM (mode open)', () => {
    assert.match(CHROME_JS, /attachShadow\(\s*\{\s*mode:\s*['"]open['"]/);
  });

  it('roster contains all 13 valid sections', () => {
    const sections = [
      'overview',
      'speaking', 'writing', 'listening', 'vocab', 'grammar',
      'students', 'users', 'cohorts',
      'access-codes', 'usage',
      'error-logs',
      'system',
    ];
    for (const s of sections) {
      assert.match(
        CHROME_JS,
        new RegExp(`['"]${s}['"]`),
        `VALID_ACTIVE missing section "${s}"`,
      );
    }
  });

  it('has no remaining Phase B sections (cohort cluster shipped, set is empty)', () => {
    // Sprint 19.5 cleanup: the Sprint 17.x cohort cluster graduated the
    // last placeholders (cohorts + usage), so PHASE_B_SECTIONS is now
    // empty. (Was asserting cohorts/usage still Phase B — one of the 3
    // stale cluster-19.x chrome fails.)
    assert.match(CHROME_JS, /PHASE_B_SECTIONS\s*=\s*new Set\(\[\s*\]\)/);
    // No section should still be tagged Phase B.
    for (const s of ['cohorts', 'usage', 'system']) {
      assert.doesNotMatch(
        CHROME_JS,
        new RegExp(`PHASE_B_SECTIONS\\s*=\\s*new Set\\(\\[[^\\]]*['"]${s}['"]`),
      );
    }
  });

  it('reads/writes sidebar collapse state via localStorage', () => {
    assert.match(CHROME_JS, /av-admin-sidebar-collapsed/);
    assert.match(CHROME_JS, /localStorage\.(getItem|setItem|removeItem)/);
  });

  it('renders sidebar with all 5 content sections in order', () => {
    // sidebar Nội dung group items in source order
    const orderRegex = /speaking[\s\S]*?writing[\s\S]*?listening[\s\S]*?vocab[\s\S]*?grammar/;
    assert.match(CHROME_JS, orderRegex);
  });

  it('VN labels — Tổng quan / Học viên / Mã kích hoạt / Báo lỗi', () => {
    for (const label of ['Tổng quan', 'Học viên', 'Mã kích hoạt', 'Báo lỗi', 'Hệ thống']) {
      assert.match(CHROME_JS, new RegExp(label.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&')),
        `expected VN label "${label}"`);
    }
  });

  it('hamburger + backdrop for mobile (<768px)', () => {
    assert.match(CHROME_JS, /id="hamburger"/);
    assert.match(CHROME_JS, /id="backdrop"/);
    assert.match(CHROME_JS, /@media\s*\(\s*max-width:\s*768px/);
  });
});


/* ── New routes exist ──────────────────────────────────────────── */

describe('Sprint 12.1 — 13 moved admin pages exist at new nested paths', () => {
  const moves = [
    ['admin-writing.html',             'admin/writing/index.html'],
    ['admin-writing-new.html',         'admin/writing/new.html'],
    ['admin-writing-grade.html',       'admin/writing/grade.html'],
    ['admin-writing-status.html',      'admin/writing/status.html'],
    ['admin-writing-assignments.html', 'admin/writing/assignments.html'],
    ['admin-writing-prompts.html',     'admin/writing/prompts.html'],
    ['admin-instructor-queue.html',    'admin/writing/instructor-queue.html'],
    ['admin-students.html',            'admin/students/index.html'],
    ['admin-listening-segments.html',  'admin/listening/segments.html'],
    ['admin-listening-gist.html',      'admin/listening/gist.html'],
    ['admin-listening-tf.html',        'admin/listening/tf.html'],
    ['admin-listening-mcq.html',       'admin/listening/mcq.html'],
    ['admin-listening-mini-test.html', 'admin/listening/mini-test.html'],
  ];

  for (const [oldName, newPath] of moves) {
    it(`${oldName} moved to /pages/${newPath}`, () => {
      const newAbs = join(__dirname, '..', 'pages', newPath);
      const oldAbs = join(__dirname, '..', 'pages', oldName);
      assert.ok(existsSync(newAbs),  `expected new page at /pages/${newPath}`);
      assert.ok(!existsSync(oldAbs), `flat path /pages/${oldName} must NOT exist (use redirect)`);
    });
  }
});


/* ── Each moved page embeds aver-admin-chrome ──────────────────── */

describe('Sprint 12.1 — every moved page embeds <aver-admin-chrome>', () => {
  const pages = [
    ['writing/index.html',            'writing'],
    ['writing/new.html',              'writing'],
    ['writing/grade.html',            'writing'],
    ['writing/status.html',           'writing'],
    ['writing/assignments.html',      'writing'],
    ['writing/prompts.html',          'writing'],
    ['writing/instructor-queue.html', 'writing'],
    ['students/index.html',           'students'],
    ['listening/segments.html',       'listening'],
    ['listening/gist.html',           'listening'],
    ['listening/tf.html',             'listening'],
    ['listening/mcq.html',            'listening'],
    ['listening/mini-test.html',      'listening'],
  ];
  for (const [rel, active] of pages) {
    it(`${rel} has <aver-admin-chrome active="${active}">`, () => {
      const html = read('pages', 'admin', rel);
      const re = new RegExp(`<aver-admin-chrome\\s+active=["']${active}["']`);
      assert.match(html, re, `${rel} missing or has wrong active attr`);
      // Module script loaded.
      assert.match(html, /<script\s+type="module"\s+src="\/js\/components\/aver-admin-chrome\.js"/);
    });
  }

  it('the old aw-header chrome is stripped from writing + students pages', () => {
    for (const rel of [
      'writing/index.html', 'writing/new.html', 'writing/grade.html',
      'writing/status.html', 'writing/assignments.html',
      'writing/prompts.html', 'writing/instructor-queue.html',
      'students/index.html',
    ]) {
      const html = read('pages', 'admin', rel);
      assert.doesNotMatch(
        html,
        /<header class="aw-header[\s\S]*?<\/header>/,
        `${rel} still has legacy aw-header chrome`,
      );
    }
  });
});


/* ── Tổng quan landing page ────────────────────────────────────── */

describe('Sprint 12.1+12.4 — Tổng quan landing (pages/admin/index.html)', () => {
  // Sprint 12.4 reshaped this landing from 11 link cards into a real
  // dashboard: 4 stat tiles + 5 skill cards + activity feed. Hard pins
  // on shape moved into admin-overview.test.mjs; the assertions kept
  // here pin only the cluster-stable contract.
  it('embeds <aver-admin-chrome active="overview">', () => {
    assert.match(ADMIN_INDEX, /<aver-admin-chrome\s+active=["']overview["']/);
  });

  it('renders 5 skill cards (ov-card class with data-skill attribute)', () => {
    const cards = ADMIN_INDEX.match(/class="admin-hub-card(?: is-placeholder)?"\s+data-skill="/g) || [];  // design-fix-2 B4
    assert.equal(cards.length, 5,
      `expected 5 skill cards (Speaking/Writing/Listening/Vocab/Grammar); got ${cards.length}`);
  });

  it('marks all 5 skill cards LIVE (no remaining is-soon skill placeholders)', () => {
    // Sprint 12.7 graduated Grammar — the last skill placeholder. All
    // 5 skill cards are now LIVE. Remaining `is-soon` tags belong only
    // to Phase B sections (cohorts/usage/system) shown in the footer.
    const liveTags = ADMIN_INDEX.match(/is-live[^"]*">[^<]*LIVE[^<]*</g) || [];
    assert.ok(liveTags.length >= 5,
      `expected at least 5 LIVE tags (Speaking + Writing + Listening + Vocab + Grammar); got ${liveTags.length}`);
    // Sprint-12.7 ref must be gone from any skill card meta block.
    assert.doesNotMatch(ADMIN_INDEX, /is-placeholder"\s+data-skill="grammar"/);
  });

  it('Phase B sections still surfaced (footer placeholder row)', () => {
    assert.match(ADMIN_INDEX, /Phase B/);
  });
});


/* ── Placeholder pages exist for empty sections ───────────────── */

describe('Sprint 12.1 — section index pages (all graduated from placeholders)', () => {
  // Sprint 12.x graduated access-codes/error-logs/speaking/vocab/grammar/
  // system/users; the Sprint 17.x cohort cluster graduated the LAST two
  // placeholders — `cohorts` + `usage` are now real pages (no "Sắp ra mắt").
  // Sprint 19.5 cleanup: these tests asserted the obsolete placeholder
  // state and were the cluster-19.x "3 stale chrome fails". Now they pin
  // the durable contract: the page exists + mounts the admin chrome.
  const sections = [
    'cohorts', 'usage',
  ];
  for (const s of sections) {
    it(`/pages/admin/${s}/index.html exists with chrome (now LIVE, not a placeholder)`, () => {
      const html = read('pages', 'admin', s, 'index.html');
      assert.match(html, new RegExp(`<aver-admin-chrome\\s+active=["']${s}["']`));
      assert.doesNotMatch(html, /Sắp ra mắt/);  // graduated — no longer a stub
    });
  }

  it('Listening index is the content management browser (Sprint 13.1)', () => {
    // Sprint 13.1 promoted listening/index.html from a card-grid
    // landing into a content list page. The 5 editor deep-links now
    // live in row Actions rendered by JS (admin-listening-content-list.js),
    // not as direct anchors in the HTML. The page legitimately carries
    // "Sắp ra mắt" text for the Sprint 13.2/13.3 create placeholders.
    const html = read('pages', 'admin', 'listening', 'index.html');
    assert.match(html, /<aver-admin-chrome\s+active=["']listening["']/);
    assert.match(html, /subsection=["']content["']/,
      'Sprint 13.1: listening index must set subsection="content"');
    // Real content browser markers — table + filter + create row.
    assert.match(html, /id=["']lst-status["']/, 'missing status filter');
    assert.match(html, /id=["']lst-tbody["']/,  'missing content table tbody');
    // Editor deep-links live in the row-renderer module, not inline.
    const listJs = read('js', 'admin-listening-content-list.js');
    for (const sub of ['segments', 'gist', 'tf', 'mcq']) {
      assert.match(
        listJs,
        new RegExp(`/pages/admin/listening/${sub}\\.html\\?content_id=`),
        `content-list module missing deep-link to ${sub} editor`,
      );
    }
  });

  it('Sprint 12.2 — access-codes index is a real landing (not a stub)', () => {
    const html = read('pages', 'admin', 'access-codes', 'index.html');
    assert.match(html, /<aver-admin-chrome\s+active=["']access-codes["']/);
    assert.doesNotMatch(html, /Sắp ra mắt/);
    // Real landing must have the filter bar + create button.
    assert.match(html, /id="filter-type"/);
    assert.match(html, /id="btn-create"/);
  });

  it('Sprint 12.3 — error-logs index is a real landing (not a stub)', () => {
    const html = read('pages', 'admin', 'error-logs', 'index.html');
    assert.match(html, /<aver-admin-chrome\s+active=["']error-logs["']/);
    assert.doesNotMatch(html, /Sắp ra mắt/);
    // Real landing must carry the stats grid + filter bar + refresh button.
    assert.match(html, /data-stat="undismissed"/);
    assert.match(html, /id="filter-dismissed"/);
    assert.match(html, /id="btn-refresh"/);
  });

  it('Sprint 12.5 — speaking index is a real landing (not a stub)', () => {
    const html = read('pages', 'admin', 'speaking', 'index.html');
    assert.match(html, /<aver-admin-chrome\s+active=["']speaking["']/);
    assert.doesNotMatch(html, /Sắp ra mắt/);
    // Real landing must link to its two child pages (sessions + topics).
    assert.match(html, /\/pages\/admin\/speaking\/sessions\.html/);
    assert.match(html, /\/pages\/admin\/speaking\/topics\.html/);
  });

  it('Sprint 12.6 — vocab index is a real landing (not a stub)', () => {
    const html = read('pages', 'admin', 'vocab', 'index.html');
    assert.match(html, /<aver-admin-chrome\s+active=["']vocab["']/);
    assert.doesNotMatch(html, /Sắp ra mắt/);
    // Real landing must link to its three child pages.
    assert.match(html, /\/pages\/admin\/vocab\/stats\.html/);
    assert.match(html, /\/pages\/admin\/vocab\/d1-curation\.html/);
    assert.match(html, /\/pages\/admin\/vocab\/lemmas\.html/);
  });

  it('Sprint 12.7 — grammar index is a real landing (not a stub)', () => {
    const html = read('pages', 'admin', 'grammar', 'index.html');
    assert.match(html, /<aver-admin-chrome\s+active=["']grammar["']/);
    assert.doesNotMatch(html, /Sắp ra mắt/);
    // Real landing must link to its three child pages.
    assert.match(html, /\/pages\/admin\/grammar\/articles\.html/);
    assert.match(html, /\/pages\/admin\/grammar\/analytics\.html/);
    assert.match(html, /\/pages\/admin\/grammar\/recommend-test\.html/);
    // Hybrid file-based banner must surface the workflow.
    assert.match(html, /backend\/content/);
  });

  it('Sprint 12.8 — system index is a real landing (not a stub)', () => {
    const html = read('pages', 'admin', 'system', 'index.html');
    assert.match(html, /<aver-admin-chrome\s+active=["']system["']/);
    assert.doesNotMatch(html, /Sắp ra mắt/);
    // Real landing must link to its two LIVE sub-pages.
    assert.match(html, /\/pages\/admin\/system\/ai-usage\.html/);
    assert.match(html, /\/pages\/admin\/system\/alerts\.html/);
  });

  it('Sprint 12.8 — users index is a real landing (not a stub)', () => {
    const html = read('pages', 'admin', 'users', 'index.html');
    assert.match(html, /<aver-admin-chrome\s+active=["']users["']/);
    assert.doesNotMatch(html, /Sắp ra mắt/);
    // Real landing must carry role filter + role-change UI hooks.
    assert.match(html, /id=["']usr-role["']/);
    assert.match(html, /id=["']usr-tbody["']/);
  });
});


/* ── vercel.json redirects ─────────────────────────────────────── */

describe('Sprint 12.1 — vercel.json carries 13 admin redirects', () => {
  let json;
  it('parses as valid JSON', () => {
    json = JSON.parse(VERCEL_JSON);
    assert.ok(Array.isArray(json.redirects));
  });

  it('preserves Sprint 5.1 dashboard.html redirect', () => {
    const json = JSON.parse(VERCEL_JSON);
    const found = json.redirects.find((r) => r.source === '/pages/dashboard.html');
    assert.ok(found, 'Sprint 5.1 dashboard redirect lost');
    assert.equal(found.destination, '/pages/speaking.html');
  });

  it('adds 13 admin page redirects', () => {
    const json = JSON.parse(VERCEL_JSON);
    const adminRedirects = json.redirects.filter((r) =>
      r.source.startsWith('/pages/admin-'));
    assert.equal(adminRedirects.length, 13,
      `expected 13 admin redirects; got ${adminRedirects.length}`);
    for (const r of adminRedirects) {
      assert.equal(r.permanent, true, `${r.source} must be permanent (301)`);
      assert.match(r.destination, /^\/pages\/admin\//,
        `${r.source} → must point under /pages/admin/`);
    }
  });

  it('updates two existing /admin/writing rewrites to nested paths', () => {
    const json = JSON.parse(VERCEL_JSON);
    const prompts = json.rewrites.find((r) => r.source === '/admin/writing/prompts');
    const assignments = json.rewrites.find((r) => r.source === '/admin/writing/assignments');
    assert.equal(prompts.destination,     '/pages/admin/writing/prompts.html');
    assert.equal(assignments.destination, '/pages/admin/writing/assignments.html');
  });
});


/* ── Sprint 12.8 — admin.html cluster closure ──────────────────── */

describe('Sprint 12.8 — admin.html is a pure redirect to the new IA', () => {
  // Sprint 12.1 originally added a banner-on-top-of-monolith. Sprint 12.8
  // (cluster closure) flips admin.html into a pure redirect — the banner
  // becomes a redirect card. Both meta refresh and JS location.replace()
  // target the new IA landing.
  it('links to /pages/admin/index.html', () => {
    assert.match(ADMIN_LEGACY, /href=["']\/pages\/admin\/index\.html["']/);
  });

  it('uses meta refresh + JS replace() for bookmark + JS-off fallback', () => {
    assert.match(
      ADMIN_LEGACY,
      /<meta\s+http-equiv=["']refresh["'][^>]*url=\/pages\/admin\/index\.html/,
    );
    assert.match(
      ADMIN_LEGACY,
      /window\.location\.replace\(\s*['"]\/pages\/admin\/index\.html['"]\s*\)/,
    );
  });

  it('legacy monolith header markup is GONE', () => {
    // Pre-12.8 the sticky `<header class="admin-header sticky top-0 z-30">`
    // was the visual anchor of the monolith. After closure, no header
    // markup remains in admin.html.
    assert.doesNotMatch(ADMIN_LEGACY, /<header class="admin-header sticky top-0 z-30/);
  });
});


/* ── Sprint 12.2 audit fold-in F2 — subsection attribute API ──── */

describe('Sprint 12.2 F2 — <aver-admin-chrome> subsection attribute', () => {
  it('observedAttributes includes subsection', () => {
    // The Sprint 12.1 component silently swallowed `subsection`; this
    // sentinel pins that the attribute is now reactive.
    assert.match(
      CHROME_JS,
      /static get observedAttributes\(\)\s*\{\s*return\s*\[[^\]]*['"]subsection['"]/,
      'observedAttributes must list "subsection" for reactive updates',
    );
  });

  it('NAV_GROUPS carries subsections for writing and listening', () => {
    // Sprint 12.5/12.6/12.7 will add nested pages that consume this —
    // pin the data so future "thin out the array" cleanups don't drop it.
    assert.match(CHROME_JS, /section:\s*['"]writing['"][\s\S]*?subsections:\s*\[/);
    assert.match(CHROME_JS, /section:\s*['"]listening['"][\s\S]*?subsections:\s*\[/);
  });

  it('renderSubItem emits data-subsection on each child link', () => {
    assert.match(CHROME_JS, /function\s+renderSubItem\s*\(/);
    assert.match(CHROME_JS, /data-subsection=/);
  });

  it('subsection normalizer rejects values not in the parent section', () => {
    // _normalizeSubsection guards against invalid combos so the wrong
    // child isn't highlighted by accident.
    assert.match(CHROME_JS, /_normalizeSubsection\s*\(/);
  });

  it('writing subsections include grade (canonical Sprint 12.5 target)', () => {
    assert.match(CHROME_JS, /slug:\s*['"]grade['"][^}]*label:\s*['"]Chấm bài viết['"]/);
  });
});


/* ── Sprint 12.2 audit fold-in F3 — mobile scroll-lock ──────── */

describe('Sprint 12.2 F3 — mobile sidebar scroll-lock', () => {
  it('component defines _setBodyScrollLock helper', () => {
    assert.match(CHROME_JS, /_setBodyScrollLock\s*\(\s*locked\s*\)/);
  });

  it('hamburger open toggles body overflow to hidden', () => {
    // Body lock invoked from the hamburger handler so the background
    // can't scroll behind the overlay.
    assert.match(
      CHROME_JS,
      /setAttribute\(['"]data-mobile-open['"],\s*['"]1['"]\)[\s\S]*?_setBodyScrollLock\(true\)/,
    );
  });

  it('hamburger close + backdrop click release the lock', () => {
    // Both close paths must call _setBodyScrollLock(false).
    const matches = CHROME_JS.match(/_setBodyScrollLock\(false\)/g) || [];
    assert.ok(
      matches.length >= 3,
      `Expected ≥3 _setBodyScrollLock(false) call sites (hamburger close + backdrop + disconnect), found ${matches.length}`,
    );
  });

  it('disconnectedCallback always releases the lock', () => {
    // Defensive: a mid-state detach (route change, etc.) must not
    // leave document.body.style.overflow stuck on "hidden".
    assert.match(
      CHROME_JS,
      /disconnectedCallback\(\)\s*\{[\s\S]*?_setBodyScrollLock\(false\)/,
    );
  });
});
