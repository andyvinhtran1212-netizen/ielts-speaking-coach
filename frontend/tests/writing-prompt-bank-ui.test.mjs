/**
 * writing-prompt-bank-ui.test.mjs — R1 PR-2 "Kho đề" tab.
 *
 * Browse-only prompt-library tab on the existing writing-dashboard, consuming
 * GET /api/writing/prompt-bank (PR-1). Source-assertion sentinels.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...rel) => readFileSync(join(__dirname, '..', ...rel), 'utf8');

const HTML = read('pages', 'writing-dashboard.html');
const CSS = read('css', 'writing-dashboard.css');
// the prompt-bank JS lives inline in the dashboard HTML
const JS = HTML;

// Isolate just the prompt-bank module (loadPromptBank … openPromptModal) so
// browse-only assertions aren't tripped by the unrelated assignments-tab
// "btn-start-assignment" flow that lives elsewhere in the same file.
const PB_MODULE = (() => {
  const start = JS.indexOf('async function loadPromptBank');
  const end = JS.indexOf('function formatDeadline');
  assert.ok(start !== -1 && end !== -1 && end > start, 'prompt-bank module not found');
  return JS.slice(start, end);
})();


describe('Kho đề — tab + section markup', () => {
  it('adds a "Kho đề" tab button, hidden by default (revealed only when enabled)', () => {
    assert.match(HTML, /id="tab-prompt-bank"[^>]*\shidden/);
    assert.match(HTML, /Kho đề/);
  });
  it('adds a content-prompt-bank section with a task_type filter + list', () => {
    assert.match(HTML, /id="content-prompt-bank"/);
    assert.match(HTML, /data-pb-filter="all"[\s\S]*?data-pb-filter="task1_academic"[\s\S]*?data-pb-filter="task1_general"[\s\S]*?data-pb-filter="task2"/);
    assert.match(HTML, /id="pb-list"/);
  });
});


describe('Kho đề — consumes PR-1 endpoint, flag-gated visibility', () => {
  it('fetches /api/writing/prompt-bank and reveals the tab only when enabled + non-empty', () => {
    assert.match(JS, /window\.api\.get\('\/api\/writing\/prompt-bank'\)/);
    assert.match(JS, /data\.enabled !== true\) return/);          // flag off → tab hidden
    assert.match(JS, /if \(!_allPrompts\.length\) return/);        // empty → tab hidden
    assert.match(JS, /getElementById\('tab-prompt-bank'\)[\s\S]*?\.hidden = false/);
  });
  it('setTabActive wires the prompt-bank tab + lazy render', () => {
    assert.match(JS, /content-prompt-bank'\)\.classList\.toggle\('hidden', tab !== 'prompt-bank'\)/);
    assert.match(JS, /tab === 'prompt-bank' && !_pbRendered.*renderPromptBank\(\)/);
  });
});


describe('Kho đề — browse + filter + emit', () => {
  it('filters cards by task_type', () => {
    assert.match(JS, /_pbFilter === 'all'[\s\S]*?p\.task_type === _pbFilter/);
    assert.match(JS, /PB_TASK_LABELS = \{[\s\S]*?task1_academic:[\s\S]*?task1_general:[\s\S]*?task2:/);
  });
  it('opening a prompt emits prompt_bank_view (distinct from prompt_view), fire-and-forget', () => {
    assert.match(JS, /event_name:\s*'prompt_bank_view'/);
    assert.match(JS, /prompt_bank_view'[\s\S]*?\.catch\(function \(\) \{\}\)/);
    assert.match(JS, /prompt_id:\s*p\.id/);
  });
  it('is BROWSE-ONLY — no start-essay control in the prompt-bank module', () => {
    // the module renders/opens prompts only; no start-button class or submit CTA
    assert.doesNotMatch(PB_MODULE, /btn-start|data-start|Bắt đầu viết|onclick|startEssay/i);
    // affirmatively: the card CTA is a read-only "Đọc đề" affordance
    assert.match(PB_MODULE, /Đọc đề/);
  });
});


describe('Kho đề — CSS tokens (no raw hex)', () => {
  it('prompt modal styles use --av-* tokens', () => {
    assert.match(CSS, /\.pb-modal-img\s*\{[\s\S]*?var\(--av-radius-md\)/);
    assert.match(CSS, /\.pb-modal-text\s*\{[\s\S]*?var\(--av-text-secondary\)/);
  });
});
