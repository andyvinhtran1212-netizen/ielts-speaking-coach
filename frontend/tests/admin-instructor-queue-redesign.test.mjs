/**
 * frontend/tests/admin-instructor-queue-redesign.test.mjs — Sprint 6.14c
 * (Phase 4 admin sprint 3 of 4 — Phase A warmup).
 *
 * Pins the migration of /pages/admin/writing/instructor-queue.html (instructor
 * review queue). WC.bootstrap({onReady:(me)=>...}) + real HTML <table>
 * with 4 filter buttons + 5 status pills + age color coding + 30s poll
 * with visibility-aware pause + 2 backend POST endpoints (claim, release).
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

let html;

// Sprint 12.1 — chrome assertions (theme toggle, header email, brand badge,
// back-link) bail when the page uses <aver-admin-chrome>. The chrome
// contract is pinned by frontend/tests/aver-admin-chrome.test.mjs.
const USES_ADMIN_CHROME = readFileSync(path.join(REPO_ROOT, 'frontend/pages/admin/writing/instructor-queue.html'), 'utf8').includes('<aver-admin-chrome');

let css;

before(() => {  html = readFileSync(path.join(REPO_ROOT, 'frontend/pages/admin/writing/instructor-queue.html'), 'utf8');
  css  = readFileSync(path.join(REPO_ROOT, 'frontend/css/admin-writing.css'),               'utf8');
});


describe('admin-instructor-queue.html / foundation + IIFE + WC.bootstrap', () => {
  if (USES_ADMIN_CHROME) return;  // Sprint 12.1 — chrome in shadow DOM
  test('foundation order tokens → components → admin-writing.css', () => {
    const t = html.indexOf('aver-design/tokens.css');
    const c = html.indexOf('aver-design/components.css');
    const p = html.indexOf('css/admin-writing.css');
    assert.ok(t > -1 && c > -1 && p > -1 && t < c && c < p);
  });

  test('Plus Jakarta Sans + JetBrains Mono fonts loaded (Inter dropped)', () => {
    assert.match(html, /Plus\+Jakarta\+Sans/);
    assert.match(html, /JetBrains\+Mono/);
    assert.ok(!/family=Inter\b/.test(html));
  });

  test('no inline <style> block (CSS lives in admin-writing.css)', () => {
    assert.equal((html.match(/<style[\s\S]*?<\/style>/g) || []).length, 0);
  });

  test('canonical anti-flash IIFE present', () => {
    assert.match(html, /localStorage\.getItem\(\s*['"]av-theme['"]\s*\)/);
    assert.match(html, /stored\s*===\s*['"](?:light|dark)['"]\s*\|\|\s*stored\s*===\s*['"](?:light|dark)['"]/);
  });

  test('WC.bootstrap called with onReady(me) callback', () => {
    assert.match(html, /WC\.bootstrap\(\s*\{[\s\S]*?onReady\s*:\s*function\s*\(\s*me\s*\)/);
  });
});


describe('admin-instructor-queue.html / table contract preserved', () => {
  test('7-column thead: Submitted / Age / Student / Lvl / Task / Status / Actions', () => {
    const thead = html.match(/<thead>[\s\S]*?<\/thead>/);
    assert.ok(thead);
    for (const col of ['Submitted', 'Age', 'Student', 'Lvl', 'Task', 'Status', 'Actions']) {
      assert.match(thead[0], new RegExp(`>\\s*${col}\\s*<`), `Missing column: ${col}`);
    }
  });

  test('aw-queue-table class on <table>', () => {
    assert.match(html, /<table[^>]*class=["']aw-queue-table["']/);
  });

  test('queue-rows tbody + queue-count IDs preserved', () => {
    assert.match(html, /id=["']queue-rows["']/);
    assert.match(html, /id=["']queue-count["']/);
  });
});


describe('admin-instructor-queue.html / 4 filter buttons preserved', () => {
  for (const f of ['all_active', 'queued', 'my_claims', 'delivered']) {
    test(`filter button data-filter="${f}" present`, () => {
      assert.match(html, new RegExp(`data-filter=["']${f}["']`), `Missing data-filter="${f}"`);
    });
  }

  test('aw-filter-btn--active toggle handler on click', () => {
    assert.match(html, /classList\.toggle\(\s*['"]aw-filter-btn--active['"]\s*,/);
  });

  test('FILTERS map preserves my_claims scopeToMe + delivered statuses', () => {
    const m = html.match(/var\s+FILTERS\s*=\s*\{[\s\S]*?\};/);
    assert.ok(m);
    assert.match(m[0], /all_active\s*:[\s\S]*?\[\s*['"]queued['"]\s*,\s*['"]claimed['"]\s*\]/);
    assert.match(m[0], /my_claims\s*:[\s\S]*?scopeToMe\s*:\s*true/);
    assert.match(m[0], /delivered\s*:[\s\S]*?\[\s*['"]delivered['"]\s*\]/);
  });
});


describe('admin-instructor-queue.html / 5 instructor-pill data-status statuses', () => {
  test('renderStatusPill emits data-status attribute', () => {
    assert.match(html, /<span class="aw-instructor-pill" data-status="/);
  });

  test('admin-writing.css defines all 5 instructor-pill data-status variants', () => {
    for (const s of ['queued', 'claimed', 'edited', 'delivered', 'released']) {
      assert.match(css, new RegExp(`\\.aw-instructor-pill\\[data-status=["']${s}["']\\]`), `Missing instructor-pill[data-status=${s}] rule`);
    }
  });
});


describe('admin-instructor-queue.html / age color coding preserved', () => {
  test('ageClass returns 3 SLA classes (fresh / warning / overdue)', () => {
    const block = html.match(/function\s+ageClass\(\s*hours\s*\)\s*\{[\s\S]*?\n\s*\}/);
    assert.ok(block);
    for (const v of ['aw-age-cell--fresh', 'aw-age-cell--warning', 'aw-age-cell--overdue']) {
      assert.match(block[0], new RegExp(v), `ageClass missing ${v}`);
    }
  });

  test('admin-writing.css defines all 3 age cell variants', () => {
    for (const v of ['fresh', 'warning', 'overdue']) {
      assert.match(css, new RegExp(`\\.aw-age-cell--${v}\\b`), `Missing aw-age-cell--${v}`);
    }
  });
});


describe('admin-instructor-queue.html / 30s poll + visibility pause preserved', () => {
  test('POLL_INTERVAL_MS = 30000', () => {
    assert.match(html, /POLL_INTERVAL_MS\s*=\s*30000/);
  });

  test('setInterval wraps loadQueue with POLL_INTERVAL_MS', () => {
    assert.match(html, /setInterval\(loadQueue,\s*POLL_INTERVAL_MS\)/);
  });

  test('visibilitychange handler pauses poll when tab hidden', () => {
    assert.match(html, /addEventListener\(\s*['"]visibilitychange['"]/);
    assert.match(html, /document\.hidden/);
    assert.match(html, /clearInterval\(_pollTimer\)/);
  });
});


describe('admin-instructor-queue.html / 4 row action button variants', () => {
  test('claim button: aw-btn-act--claim + data-action="claim"', () => {
    assert.match(html, /aw-btn-act aw-btn-act--claim[\s\S]*?data-action="claim"/);
  });

  test('edit link: aw-btn-act--edit + admin-writing-grade.html', () => {
    if (USES_ADMIN_CHROME) return;  // Sprint 12.1 — chrome in shadow DOM
    assert.match(html, /aw-btn-act aw-btn-act--edit[\s\S]*?\/pages\/admin-writing-grade\.html\?essay_id=/);
  });

  test('release button: aw-btn-act--release + data-action="release"', () => {
    assert.match(html, /aw-btn-act aw-btn-act--release[\s\S]*?data-action="release"/);
  });

  test('view link: aw-btn-act--view', () => {
    assert.match(html, /aw-btn-act aw-btn-act--view/);
  });

  test('admin-writing.css defines all 4 row action button variants', () => {
    if (USES_ADMIN_CHROME) return;  // Sprint 12.1 — chrome in shadow DOM
    for (const v of ['claim', 'edit', 'release', 'view']) {
      assert.match(css, new RegExp(`\\.aw-btn-act--${v}\\b`), `Missing aw-btn-act--${v}`);
    }
  });

  test('locked-by-other tag rendered when status=claimed && !isMine', () => {
    assert.match(html, /class=["']aw-locked-tag["'][^>]*>🔒 Locked by another instructor/);
  });
});


describe('admin-instructor-queue.html / claim + release endpoints preserved', () => {
  test('POST /admin/instructor/reviews/{id}/claim', () => {
    assert.match(html, /window\.api\.post\(\s*['"]\/admin\/instructor\/reviews\/['"]\s*\+\s*encodeURIComponent\(reviewId\)\s*\+\s*['"]\/claim['"]/);
  });

  test('POST /admin/instructor/reviews/{id}/release', () => {
    assert.match(html, /window\.api\.post\(\s*['"]\/admin\/instructor\/reviews\/['"]\s*\+\s*encodeURIComponent\(reviewId\)\s*\+\s*['"]\/release['"]/);
  });

  test('GET /admin/instructor/queue (with status query params)', () => {
    assert.match(html, /window\.api\.get\(\s*['"]\/admin\/instructor\/queue\?['"]\s*\+\s*qs\s*\)/);
  });

  test('409 conflict path detects "already claimed" / "cannot claim" + auto-refresh', () => {
    assert.match(html, /already claimed\|cannot claim/i);
  });
});


describe('admin-instructor-queue.html / body class + theme toggle', () => {
  if (USES_ADMIN_CHROME) return;  // Sprint 12.1 — chrome in shadow DOM
  test('body uses av-page', () => {
    assert.match(html, /<body[^>]*class=["'][^"']*\bav-page\b/);
  });

  test('canonical theme toggle present', () => {
    if (USES_ADMIN_CHROME) return;  // Sprint 12.1 — chrome in shadow DOM
    assert.match(html, /class=["']icon-sun["']/);
    assert.match(html, /class=["']icon-moon["']/);
  });
});


describe('admin-instructor-queue.html / Vietnamese microcopy preserved', () => {
  if (USES_ADMIN_CHROME) return;  // Sprint 12.1 — chrome in shadow DOM
  const phrases = [
    'Instructor Queue',
    'đã chấm xong AI Pass 1, chờ giảng viên review',
    'Auto-refresh mỗi 30s',
    'All Active',
    'Queued',
    'My Claims',
    'Delivered (recent)',
    'Bạn chưa claim bài nào.',
    'Chưa có bài đã deliver gần đây.',
    'Hàng đợi trống. 🎉',
    'Locked by another instructor',
    'Đã release. Bài về queue.',
    'Bài đã được instructor khác claim. Đang refresh',
    'Release claim? Bài sẽ trở về queue cho instructor khác.',
    'Không tải được queue:',
    'Phản hồi server thiếu essay_id.',
    'phút trước',
    'h trước',
  ];
  for (const phrase of phrases) {
    test(`microcopy preserved: "${phrase.slice(0, 40)}…"`, () => {
      assert.ok(html.includes(phrase), `Missing exact phrase: ${phrase}`);
    });
  }
});
