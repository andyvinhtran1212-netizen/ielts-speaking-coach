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

  it('marks the 3 Phase B sections (cohorts, usage, system)', () => {
    assert.match(CHROME_JS, /PHASE_B_SECTIONS\s*=\s*new Set\(\[[\s\S]*?['"]cohorts['"][\s\S]*?['"]usage['"][\s\S]*?['"]system['"]/);
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

describe('Sprint 12.1 — Tổng quan landing (pages/admin/index.html)', () => {
  it('embeds <aver-admin-chrome active="overview">', () => {
    assert.match(ADMIN_INDEX, /<aver-admin-chrome\s+active=["']overview["']/);
  });

  it('renders 11 cards across 3 groups (Nội dung 5 + Người dùng 3 + Truy cập 3)', () => {
    // Match exactly "ov-card" or "ov-card is-placeholder" — NOT "ov-card-title-row".
    const cards = ADMIN_INDEX.match(/class="ov-card(?: is-placeholder)?"/g) || [];
    assert.equal(cards.length, 11,
      `expected 11 overview cards; got ${cards.length}`);
  });

  it('links Speaking + Vocab + Grammar as placeholders with sprint hints', () => {
    assert.match(ADMIN_INDEX, /Sprint 12\.5/);
    assert.match(ADMIN_INDEX, /Sprint 12\.6/);
    assert.match(ADMIN_INDEX, /Sprint 12\.7/);
  });

  it('marks Writing + Listening + Students as LIVE', () => {
    const liveTags = ADMIN_INDEX.match(/is-live[^"]*">[^<]*LIVE[^<]*</g) || [];
    assert.ok(liveTags.length >= 3,
      `expected at least 3 LIVE tags (Writing, Listening, Students); got ${liveTags.length}`);
  });

  it('marks Phase B sections with "Phase B" tag', () => {
    assert.match(ADMIN_INDEX, /Phase B/);
  });
});


/* ── Placeholder pages exist for empty sections ───────────────── */

describe('Sprint 12.1 — placeholder index pages for empty sections', () => {
  const sections = [
    'speaking', 'vocab', 'grammar', 'users',
    'cohorts', 'access-codes', 'usage', 'error-logs', 'system',
  ];
  for (const s of sections) {
    it(`/pages/admin/${s}/index.html exists with chrome + "Sắp ra mắt"`, () => {
      const html = read('pages', 'admin', s, 'index.html');
      assert.match(html, new RegExp(`<aver-admin-chrome\\s+active=["']${s}["']`));
      assert.match(html, /Sắp ra mắt/);
    });
  }

  it('Listening index is a real landing (not just a "Sắp ra mắt" stub)', () => {
    const html = read('pages', 'admin', 'listening', 'index.html');
    assert.match(html, /<aver-admin-chrome\s+active=["']listening["']/);
    // Should have all 5 sub-page links.
    for (const sub of ['segments', 'gist', 'tf', 'mcq', 'mini-test']) {
      assert.match(html, new RegExp(`/pages/admin/listening/${sub}\\.html`),
        `Listening landing missing link to ${sub}`);
    }
    // Must NOT be a Sắp-ra-mắt placeholder.
    assert.doesNotMatch(html, /Sắp ra mắt/);
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


/* ── Legacy admin.html banner ──────────────────────────────────── */

describe('Sprint 12.1 — legacy admin.html banner pointing to new IA', () => {
  it('shows banner with link to /pages/admin/index.html', () => {
    assert.match(ADMIN_LEGACY, /id="admin-ia-banner"/);
    assert.match(ADMIN_LEGACY, /href="\/pages\/admin\/index\.html"/);
  });

  it('banner copy mentions DEBT-ADMIN-IA-REFACTOR migration', () => {
    assert.match(ADMIN_LEGACY, /Phiên bản mới/);
  });

  it('legacy monolith body otherwise intact (header still there)', () => {
    // The Speaking/codes/vocab tabs still functional — banner is additive only.
    assert.match(ADMIN_LEGACY, /<header class="admin-header sticky top-0 z-30/);
  });
});
