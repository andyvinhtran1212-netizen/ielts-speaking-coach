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
  });

  it('uses canonical design tokens (no unexpected hex literals)', () => {
    assert.match(HTML, /var\(--av-brand-teal-700\)/);
    const hex = HTML.match(/#[0-9a-fA-F]{3,6}/g) || [];
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
    assert.match(HTML, /href=["']\/pages\/listening\.html["']/);
  });
});


describe('Sprint 13.5 — tests-list JS contract', () => {

  it('boots Supabase via window.initSupabase (matches canonical ref)', () => {
    assert.match(JS, /nqhrtqspznepmveyurzm\.supabase\.co/);
    assert.match(JS, /sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4/);
    assert.match(JS, /window\.initSupabase\(/);
  });

  it('calls GET /api/listening/tests with a limit query', () => {
    assert.match(JS, /window\.api\.get\(['"`]\/api\/listening\/tests\?limit=/);
  });

  it('links each card to /pages/listening-test.html?id=<uuid>', () => {
    assert.match(
      JS,
      /href=["']\/pages\/listening-test\.html\?id=\$\{encodeURIComponent\(t\.id\)\}["']/,
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
});
