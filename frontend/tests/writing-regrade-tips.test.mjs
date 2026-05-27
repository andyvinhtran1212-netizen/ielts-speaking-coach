/**
 * frontend/tests/writing-regrade-tips.test.mjs — Sprint 19.4.
 *
 * Pins the cluster-closure surfaces:
 *   • writing-result.html — re-grade request button/modal + tips reco
 *   • admin/writing/regrade-requests.html — admin queue
 *   • chrome nav entry
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

let result, admin, chromeJs, resultCss;

before(() => {
  result    = readFileSync(path.join(REPO_ROOT, 'frontend/pages/writing-result.html'), 'utf8');
  admin     = readFileSync(path.join(REPO_ROOT, 'frontend/pages/admin/writing/regrade-requests.html'), 'utf8');
  chromeJs  = readFileSync(path.join(REPO_ROOT, 'frontend/js/components/aver-admin-chrome.js'), 'utf8');
  resultCss = readFileSync(path.join(REPO_ROOT, 'frontend/css/writing-result.css'), 'utf8');
});


describe('writing-result.html / re-grade request (D4)', () => {
  test('button + modal + state-check endpoint present', () => {
    assert.match(result, /id="btn-regrade-request"/);
    assert.match(result, /id="regrade-modal"/);
    assert.match(result, /id="regrade-reason"/);
    assert.match(result, /\/regrade-request/);
    assert.match(result, /function\s+loadRegradeState\s*\(/);
    assert.match(result, /function\s+submitRegrade\s*\(/);
  });
  test('50-char minimum enforced client-side', () => {
    assert.match(result, /< 50/);   // submit disabled / reason length guard
  });
  test('modal CSS declared', () => {
    assert.match(resultCss, /\.wr-modal__panel/);
  });
});


describe('writing-result.html / tips recommendation (D6)', () => {
  test('tips-reco section + task_type mapping + markdown libs', () => {
    assert.match(result, /id="tips-reco"/);
    assert.match(result, /function\s+loadTipsReco\s*\(/);
    assert.match(result, /function\s+_essayTaskToTipTask\s*\(/);
    assert.match(result, /\/api\/writing\/tips/);
    assert.match(result, /\/js\/markdown\.js/);
  });
  test('maps essay task_type → tip vocab + includes both', () => {
    assert.match(result, /task1_academic.*task1_general.*task_1|task_1/s);
    assert.match(result, /task_type === want \|\| t\.task_type === 'both'/);
  });
  test('tips-reco CSS declared', () => {
    assert.match(resultCss, /\.tips-reco__card/);
  });
});


describe('admin/writing/regrade-requests.html (D5)', () => {
  test('uses aver-admin chrome subsection=regrade-requests', () => {
    assert.match(admin, /<aver-admin-chrome\s+active="writing"\s+subsection="regrade-requests"\s*>/);
  });
  test('status filter chips + list + accept/reject actions', () => {
    for (const s of ['pending', 'accepted', 'rejected', 'fulfilled']) {
      assert.match(admin, new RegExp(`data-status="${s}"`));
    }
    assert.match(admin, /id="btn-accept"/);
    assert.match(admin, /id="btn-reject"/);
    assert.match(admin, /\/admin\/writing\/regrade-requests/);
  });
  test('accept/reject PATCH + grade.html drill link', () => {
    assert.match(admin, /window\.api\.patch\('\/admin\/writing\/regrade-requests\//);
    assert.match(admin, /grade\.html\?essay_id=/);
  });
  test('empty/loading/error states present', () => {
    for (const id of ['state-loading', 'state-error', 'state-empty']) {
      assert.match(admin, new RegExp(`id="${id}"`));
    }
  });
});


describe('chrome nav', () => {
  test('regrade-requests subsection → regrade-requests.html', () => {
    assert.match(chromeJs, /slug:\s*'regrade-requests'[\s\S]*?regrade-requests\.html/);
  });
});
