/**
 * frontend/tests/listening-tests-list.test.mjs
 *
 * Sprint 13.5 — pin the student tests-list page + JS contract.
 *
 * Sentinel-string match against the static page + controller source.
 * Catches:
 *   - chrome `active="listening"` regressing
 *   - the GET endpoint being changed (`/api/listening/tests`)
 *   - the per-card CTA href pattern (must point at listening-test.html)
 *   - the canonical Supabase project ref being swapped
 *   - error-state + empty-state markers going missing
 *   - design tokens being replaced with raw hex
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(__dirname, '..', 'pages', 'listening-tests.html');
const JS_PATH   = join(__dirname, '..', 'js', 'listening-tests-list.js');
const HTML = readFileSync(HTML_PATH, 'utf8');
// CSS của trang đã TÁCH khỏi khối <style> nội tuyến sang `css/listening-tests.css`
// (2026-08-05) để route Next `/listening/tests` và bản legacy dùng CHUNG một
// nguồn thay vì mỗi bên một bản. Chốt token dưới đây phải đọc từ chỗ CSS đang ở,
// nếu không nó chỉ chứng minh "HTML không còn CSS" — đúng nhưng vô nghĩa.
const PAGE_CSS = readFileSync(
  join(__dirname, '..', 'public', 'css', 'listening-tests.css'), 'utf8');
const JS   = readFileSync(JS_PATH, 'utf8');


describe('Sprint 13.5 — tests-list page contract', () => {

  it('mounts <aver-chrome active="listening">', () => {
    assert.match(
      HTML,
      /<aver-chrome\s+active=["']listening["']\s*>\s*<\/aver-chrome>/,
    );
  });

  it('declares the loading + empty + error + grid states', () => {
    assert.match(HTML, /id="state-loading"/);
    assert.match(HTML, /id="state-empty"/);
    assert.match(HTML, /id="state-error"/);
    assert.match(HTML, /id="lt-grid"/);
    assert.match(HTML, /id="lt-library"/);
    assert.match(HTML, /id="lt-summary"/);
  });

  it('uses canonical design tokens (no unexpected hex literals)', () => {
    assert.match(PAGE_CSS, /var\(--av-primary\)/);
    const hex = (HTML + PAGE_CSS).match(/#[0-9a-fA-F]{3,6}/g) || [];
    const allowed = new Set(['#FEF2F2', '#991B1B', '#FECACA']);
    for (const h of hex) {
      assert.ok(allowed.has(h),
        `unexpected hex literal ${h} in listening-tests.html`);
    }
  });

  it('loads the student tests-list controller module', () => {
    assert.match(HTML, /\/js\/listening-tests-list\.js/);
  });

  it('back-link points at /pages/listening.html', () => {
    assert.match(HTML, /href=["']\/listening["']/);
  });
});


describe('Sprint 13.5 — tests-list JS contract', () => {

  it('boots Supabase via window.initSupabase (matches canonical ref)', () => {
    assert.match(JS, /huwsmtubwulikhlmcirx\.supabase\.co/);
    assert.match(JS, /sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao/);
    assert.match(JS, /window\.initSupabase\(/);
  });

  it('pages through GET /api/listening/tests instead of one fixed page', () => {
    // Was: one `?test_type=full&limit=50` call. The landing badge reports the
    // whole published count, so a single page would promise 60 and render 50
    // once the library passes the page size. Now a loop with limit+offset.
    assert.match(JS, /from '\.\/listening-list-paging\.js'/);
    assert.match(JS, /fetchAllTests\('full'/);
  });

  it('links each card to /pages/listening-test.html?id=<uuid>&from=full', () => {
    // &from=full stamps the ORIGIN: the player is shared with the mini-test
    // library, and its back button used to send mini takers to this full-test
    // shelf. See back-nav-origin.test.mjs for the behaviour that consumes it.
    assert.match(
      JS,
      /href=["']\/pages\/listening-test\.html\?id=\$\{encodeURIComponent\(t\.id\)\}&from=full["']/,
    );
  });

  it('flips CTA label between "Bắt đầu test" and "Làm lại"', () => {
    assert.match(JS, /Bắt đầu test/);
    assert.match(JS, /Làm lại/);
  });

  it('escapes user-controlled text before insertion', () => {
    // The renderCard fn must invoke esc() for title / test_id / themes.
    assert.match(JS, /function esc\(/);
    assert.match(JS, /esc\(t\.title/);
    assert.match(JS, /esc\(t\.test_id/);
  });

  it('adds status filters and renders the truthful full-test structure', () => {
    assert.match(HTML, /data-filter="new"/);
    assert.match(HTML, /data-filter="done"/);
    assert.match(JS, /ACTIVE_FILTER/);
    assert.match(JS, /4 sections/);
    assert.match(JS, /40 câu/);
    assert.match(JS, /~30 phút/);
  });

  it('bases completion on submitted attempts, not total attempts', () => {
    assert.match(JS, /function hasSubmittedAttempt\(t\)/);
    assert.match(JS, /t\.user_submitted_attempt_count/);
    assert.doesNotMatch(JS, /const attempted = \(t\.user_attempt_count/);
  });

  it('keeps the test action primary and uses a labelled dictation action', () => {
    assert.match(JS, /class="lt-card-cta" href="\/pages\/listening-test\.html/);
    assert.match(JS, />Chép chính tả<\/a>/);
    assert.doesNotMatch(JS, /✍️ Chép chính tả/);
  });
});
