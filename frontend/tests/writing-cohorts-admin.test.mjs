/**
 * frontend/tests/writing-cohorts-admin.test.mjs — Sprint 19.2.
 *
 * Pins the cohort admin views: /pages/admin/writing/cohorts.html
 * (master-detail list + student × assignment status matrix), its CSS,
 * and the chrome nav entry.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

let html, css, chrome_js;

before(() => {
  html      = readFileSync(path.join(REPO_ROOT, 'frontend/pages/admin/writing/cohorts.html'), 'utf8');
  css       = readFileSync(path.join(REPO_ROOT, 'frontend/css/admin-writing-cohorts.css'), 'utf8');
  chrome_js = readFileSync(path.join(REPO_ROOT, 'frontend/js/components/aver-admin-chrome.js'), 'utf8');
});


describe('cohorts.html / foundation + chrome', () => {
  test('uses <aver-admin-chrome active="writing" subsection="cohorts">', () => {
    assert.match(html, /<aver-admin-chrome\s+active="writing"\s+subsection="cohorts"\s*>/);
  });
  test('canonical anti-flash IIFE + no inline <style>', () => {
    assert.match(html, /localStorage\.getItem\(\s*['"]av-theme['"]\s*\)/);
    assert.equal((html.match(/<style[\s\S]*?<\/style>/g) || []).length, 0);
  });
  test('links the cohort stylesheet + api.js via absolute path', () => {
    assert.match(html, /css\/admin-writing-cohorts\.css/);
    assert.match(html, /<script\s+src="\/js\/api\.js">/);
  });
});


describe('cohorts.html / data contract', () => {
  test('hits the cohort endpoints (list + detail)', () => {
    assert.match(html, /window\.api\.get\('\/admin\/writing\/cohorts'\)/);
    assert.match(html, /\/admin\/writing\/cohorts\/'\s*\+\s*encodeURIComponent/);
  });
  test('master-detail + matrix render path present', () => {
    assert.match(html, /function\s+renderCohorts\s*\(/);
    assert.match(html, /function\s+selectCohort\s*\(/);
    assert.match(html, /function\s+renderDetail\s*\(/);
    assert.match(html, /id="matrix-head"/);
    assert.match(html, /id="matrix-body"/);
  });
  test('admin sees full backend states (Pattern #11 — not the 4-state student collapse)', () => {
    for (const k of ['not_submitted', 'grading', 'reviewed', 'delivered', 'failed', 'flagged']) {
      assert.match(html, new RegExp(k + ':'), `CELL.${k} must exist`);
    }
  });
  test('matrix cell drills into the existing grade.html', () => {
    assert.match(html, /grade\.html\?essay_id=/);
  });
  test('cohort filter chips (all/active/idle)', () => {
    for (const f of ['all', 'active', 'idle']) {
      assert.match(html, new RegExp(`data-cohort-filter="${f}"`));
    }
  });
});


describe('cohorts.html / states + CSS + nav', () => {
  test('empty / loading / error states explicit', () => {
    for (const id of ['cohorts-loading', 'cohorts-error', 'cohorts-empty',
                      'detail-placeholder', 'detail-matrix-empty']) {
      assert.match(html, new RegExp(`id="${id}"`), `#${id} must exist`);
    }
  });
  test('matrix + cell-status CSS classes declared, all on --av-* tokens', () => {
    for (const cls of ['.cohorts-matrix', '.matrix-cell--success', '.matrix-cell--overdue',
                       '.cohort-row', '.cohorts-layout', '.stat-pill']) {
      assert.ok(css.includes(cls), `${cls} must be declared`);
    }
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(stripped), 'no hex literals');
    assert.ok(!/var\(--av-space-(5|7|9|10|11|13|14|15)\)/.test(css), 'no skipped 4px steps');
  });
  test('chrome nav carries a cohorts subsection → cohorts.html', () => {
    assert.match(chrome_js, /slug:\s*'cohorts'[\s\S]*?\/pages\/admin\/writing\/cohorts\.html/);
  });
});
