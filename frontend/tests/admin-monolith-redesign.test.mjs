/**
 * frontend/tests/admin-monolith-redesign.test.mjs — Sprint 12.8 closure.
 *
 * History: this file used to pin the 3,151-line `frontend/admin.html`
 * monolith (Sprint 6.14d-α). The DEBT-ADMIN-IA-REFACTOR cluster (Sprints
 * 12.2 → 12.7) carved every surface — topics, codes, sessions, vocab
 * monitor, flashcards, ai_usage, alerts, vocab_exercises — out into
 * `/pages/admin/<section>/`. Sprint 12.8 flips `admin.html` itself to a
 * pure redirect.
 *
 * Post-closure assertions:
 *   - admin.html is < 120 LOC (was ~3,151)
 *   - meta refresh + JS replace() both point at /pages/admin/index.html
 *   - anti-flash IIFE preserved so the redirect doesn't flash the wrong
 *     theme (DESIGN_SYSTEM § 13)
 *   - NO monolith markup remains (no tab-btn-*, panel-*, switchTab,
 *     loadTopics, loadCodes, ve_load, loadAiUsage, loadAlerts, etc.)
 *   - No CDN scripts (Tailwind/Supabase) — the redirect doesn't need them
 *   - Cross-page-navigation: back-link to pages/home.html still present
 *     so users mid-redirect can fall back
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const html = readFileSync(path.join(REPO_ROOT, 'frontend/admin.html'), 'utf8');


describe('Sprint 12.8 — admin.html cluster closure (pure redirect)', () => {
  test('file is dramatically smaller than the pre-12.8 monolith', () => {
    const lines = html.split('\n').length;
    assert.ok(
      lines < 120,
      `admin.html should be < 120 LOC post-closure (was 3,151); got ${lines}`,
    );
  });

  test('meta refresh points at /pages/admin/index.html', () => {
    assert.match(
      html,
      /<meta\s+http-equiv=["']refresh["'][^>]*url=\/pages\/admin\/index\.html/,
    );
  });

  test('JS redirect uses location.replace (no history entry)', () => {
    assert.match(
      html,
      /window\.location\.replace\(\s*['"]\/pages\/admin\/index\.html['"]\s*\)/,
    );
  });

  test('canonical link tag points at the new IA landing', () => {
    assert.match(
      html,
      /<link\s+rel=["']canonical["']\s+href=["']\/pages\/admin\/index\.html["']/,
    );
  });

  test('anti-flash IIFE preserved on the redirect itself', () => {
    assert.match(html, /localStorage\.getItem\(\s*['"]av-theme['"]\s*\)/);
    assert.match(html, /document\.documentElement\.setAttribute\(\s*['"]data-theme['"]/);
  });

  test('error-reporter.js still loaded so redirect logs reach the backend', () => {
    assert.match(html, /<script\s+src=["']\/js\/error-reporter\.js["']/);
  });

  test('back-link to pages/home.html preserved (mid-redirect fallback)', () => {
    assert.match(html, /href=["']pages\/home\.html["']/);
  });

  test('visible CTA links to the new admin landing', () => {
    assert.match(html, /href=["']\/pages\/admin\/index\.html["']/);
  });
});


describe('Sprint 12.8 — monolith markup fully removed', () => {
  test('zero tab-btn-* IDs remain', () => {
    const tabBtns = html.match(/id=["']tab-btn-[a-z_]+["']/g) || [];
    assert.equal(
      tabBtns.length,
      0,
      `Expected zero tab-btn-* IDs in redirect; found: ${tabBtns.join(', ')}`,
    );
  });

  test('zero panel-* IDs remain', () => {
    // panel-topics, panel-codes, panel-sessions, panel-vocab_monitor,
    // panel-flashcards, panel-ai_usage, panel-alerts, panel-vocab_exercises
    // — all carved out, no banners left.
    const panels = html.match(/id=["']panel-[a-z_]+["']/g) || [];
    assert.equal(
      panels.length,
      0,
      `Expected zero panel-* IDs in redirect; found: ${panels.join(', ')}`,
    );
  });

  test('zero monolith global handlers remain', () => {
    // The old monolith exposed window.switchTab / window.loadTopics /
    // window.ve_load / etc. None of those should be in the redirect.
    const dead = [
      'window.switchTab',
      'window.switchLibTab',
      'window.loadTopics',
      'window.loadCodes',
      'window.loadUsers',
      'window.loadStats',
      'window.loadAiUsage',
      'window.loadSessions',
      'window.loadAlerts',
      'window.loadVocabMonitor',
      'window.ve_load',
      'window.setVocabFlag',
    ];
    for (const fn of dead) {
      assert.ok(
        !html.includes(fn),
        `Expected NO "${fn}" in post-closure admin.html (found in redirect)`,
      );
    }
  });

  test('no inline <style> block survives (was 433 lines extracted Sprint 6.14d-α; further trimmed in 12.8)', () => {
    // The redirect ships a tiny inline <style> (~30 lines) for the
    // closure card itself. The pre-12.8 admin.css extraction is gone
    // because we don't load admin.css anymore.
    const styleBlocks = (html.match(/<style[^>]*>/g) || []).length;
    assert.ok(
      styleBlocks <= 1,
      `Expected ≤ 1 inline <style> block in redirect; got ${styleBlocks}`,
    );
  });

  test('no admin.css / admin-writing.css imports — closure doesn\'t need them', () => {
    assert.doesNotMatch(html, /<link[^>]*href=["'][^"']*admin\.css["']/);
    assert.doesNotMatch(html, /<link[^>]*href=["'][^"']*admin-writing\.css["']/);
  });

  test('no CDN scripts (Tailwind / Supabase) — redirect doesn\'t need them', () => {
    assert.doesNotMatch(html, /cdn\.tailwindcss\.com/);
    assert.doesNotMatch(html, /unpkg\.com\/@supabase/);
  });

  test('no api.js — redirect makes no API calls', () => {
    assert.doesNotMatch(html, /<script[^>]*src=["']\/?js\/api\.js["']/);
  });

  test('total ID count is tiny (post-closure baseline ~0-5)', () => {
    const ids = (html.match(/id=["'][^"']+["']/g) || []).length;
    assert.ok(
      ids <= 5,
      `Expected ≤ 5 IDs in pure redirect; got ${ids}`,
    );
  });
});
