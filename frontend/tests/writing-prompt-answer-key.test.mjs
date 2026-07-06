/**
 * writing-prompt-answer-key.test.mjs — Task 1 verified answer-key review panel.
 *
 * Pins the admin review UI in prompts.html + the endpoints it calls:
 *   • panel elements + status badge
 *   • edit-mode-only visibility (needs a prompt id for PATCH/reanalyze)
 *   • Save&Approve → PATCH /{id}/analysis {analysis, reviewed:true}
 *   • Re-analyze → POST /{id}/reanalyze
 *   • notable_data "label | value | unit" round-trip
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

let html;
before(() => {
  html = readFileSync(path.join(REPO_ROOT, 'frontend/pages/admin/writing/prompts.html'), 'utf8');
});

describe('prompts.html — answer-key panel elements', () => {
  test('panel + fields + status badge present', () => {
    assert.match(html, /id="form-analysis-section"/);
    assert.match(html, /id="analysis-status-badge"/);
    for (const id of ['af-chart-type', 'af-overview', 'af-key-features', 'af-notable', 'af-grading-note']) {
      assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
    }
    assert.match(html, /id="btn-save-analysis"/);
    assert.match(html, /id="btn-reanalyze"/);
  });

  test('panel is edit-mode + task1_academic only', () => {
    assert.match(html, /_editingId && taskType === 'task1_academic'[\s\S]*?show\('form-analysis-section'\)/);
  });
});

describe('prompts.html — answer-key endpoints', () => {
  test('Save&Approve PATCHes /{id}/analysis with reviewed:true', () => {
    assert.match(html, /\/analysis',\s*\{\s*analysis:\s*collectAnalysis\(\),\s*reviewed:\s*true\s*\}/);
  });
  test('Re-analyze POSTs /{id}/reanalyze', () => {
    assert.match(html, /\/reanalyze',\s*\{\}\)/);
  });
  test('buttons wired', () => {
    assert.match(html, /getElementById\('btn-save-analysis'\)\.addEventListener\('click', saveAnalysis\)/);
    assert.match(html, /getElementById\('btn-reanalyze'\)\.addEventListener\('click', reanalyzePrompt\)/);
  });
});

describe('prompts.html — facts render + collect', () => {
  test('status badge maps reviewed / ready / pending / failed', () => {
    assert.match(html, /Đã duyệt/);
    assert.match(html, /chờ duyệt/);
    assert.match(html, /Đang phân tích/);
    assert.match(html, /Lỗi phân tích/);
  });
  test('notable_data uses "label | value | unit" round-trip', () => {
    // render: join with ' | '
    assert.match(html, /\[d\.label \|\| '', d\.value \|\| '', d\.unit \|\| ''\]\.join\(' \| '\)/);
    // collect: split on '|'
    assert.match(html, /row\.split\('\|'\)/);
  });
});
