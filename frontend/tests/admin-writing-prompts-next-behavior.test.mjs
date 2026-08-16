import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizePromptAnalysis,
  normalizePromptDeactivate,
  normalizePromptReanalysis,
  normalizePromptUpload,
  normalizePromptWrite,
  normalizeWritingPrompt,
  normalizeWritingPromptList,
  promptAnalysisState,
  promptMatches,
  promptsPageHref,
  promptsQuery,
} from '../lib/admin-writing-prompts-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-writing-prompts)', 'admin', 'writing', 'prompts', 'page.tsx');
const COMPONENT = read('app', '(authed-admin-writing-prompts)', 'admin', 'writing', 'prompts', 'admin-writing-prompts.tsx');
const LAYOUT = read('app', '(authed-admin-writing-prompts)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-writing-prompts-next.css');
const CONFIG = read('next.config.ts');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const HUB = read('app', '(authed-admin-writing)', 'admin', 'writing', 'page.tsx');
const LEDGER = read('..', 'docs', 'ROUTE_LEDGER.md');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');

const raw = {
  id: 'p1', task_type: 'task1_academic', title: '<img onerror=x>',
  prompt_text: 'The chart below shows a valid prompt with enough detail.',
  difficulty: 'intermediate', tags: ['energy'], is_active: true, exam_only: false,
  prompt_image_url: 'https://cdn/chart.png', prompt_image_public_id: 'prompts/chart.png',
  prompt_image_analysis: {
    chart_type: 'bar', overview: 'Overall trend', key_features: ['Feature A'],
    notable_data: [{ label: '2020', value: '45', unit: '%' }],
    axes_or_categories: 'Years and percentage', grading_note: 'Check comparisons',
  },
  prompt_image_analysis_status: 'ready', prompt_image_analysis_reviewed: true,
  prompt_image_analysis_model: 'vision', prompt_image_analysis_public_id: 'prompts/chart.png',
  prompt_image_analysis_error: null, prompt_image_analysis_at: '2026-08-13T00:00:00Z',
  created_at: '2026-08-12T00:00:00Z', updated_at: '2026-08-13T00:00:00Z',
};

describe('Admin Writing Prompts native model', () => {
  test('normalizes the full Task 1 answer key without dropping axes', () => {
    const row = normalizeWritingPrompt(raw);
    assert.equal(row.analysis.axesOrCategories, 'Years and percentage');
    assert.equal(row.analysisReviewed, true);
    assert.equal(promptAnalysisState(row).key, 'reviewed');
    assert.equal(normalizePromptAnalysis({ ...raw.prompt_image_analysis, overview: '' }), null);
  });

  test('rejects malformed canonical identity and image contracts', () => {
    assert.equal(normalizeWritingPrompt({ ...raw, id: '' }), null);
    assert.equal(normalizeWritingPrompt({ ...raw, task_type: 'task3' }), null);
    assert.equal(normalizeWritingPrompt({ ...raw, tags: 'energy' }), null);
    assert.equal(normalizeWritingPrompt({ ...raw, prompt_image_public_id: null }), null);
    assert.equal(normalizeWritingPrompt({ ...raw, task_type: 'task2' }), null);
    assert.equal(normalizeWritingPromptList({ prompts: [raw, raw] }), null);
  });

  test('degrades inconsistent optional analysis instead of trusting it', () => {
    const stale = normalizeWritingPrompt({ ...raw, prompt_image_analysis_public_id: 'prompts/old.png' });
    assert.equal(stale.analysisReviewed, false);
    assert.equal(stale.malformedOptional, 1);
    const malformed = normalizeWritingPrompt({ ...raw, prompt_image_analysis: { nope: true } });
    assert.equal(malformed.analysis, null);
    assert.equal(malformed.analysisReviewed, false);
    assert.equal(malformed.malformedOptional, 2);
  });

  test('pins exact mutation acknowledgements', () => {
    assert.equal(normalizePromptWrite(raw, 'p1').id, 'p1');
    assert.equal(normalizePromptWrite(raw, 'other'), null);
    assert.deepEqual(normalizePromptDeactivate({ message: 'Prompt deactivated', prompt_id: 'p1' }, 'p1'), { promptId: 'p1' });
    assert.equal(normalizePromptDeactivate({ message: 'ok', prompt_id: 'p1' }, 'p1'), null);
    assert.deepEqual(normalizePromptUpload({ url: 'https://cdn/new.png', public_id: 'prompts/new.png' }), { url: 'https://cdn/new.png', publicId: 'prompts/new.png' });
    assert.equal(normalizePromptUpload({ url: 'https://cdn/new.png' }), null);
    assert.deepEqual(normalizePromptReanalysis({ status: 'pending', prompt_id: 'p1' }, 'p1'), { promptId: 'p1', status: 'pending' });
  });

  test('serializes server filters separately from local visibility/search', () => {
    assert.equal(promptsQuery({ taskType: 'task2', difficulty: 'advanced', lifecycle: 'archived' }), 'task_type=task2&difficulty=advanced&is_active=false&limit=500');
    assert.equal(promptsPageHref({ taskType: 'task2', difficulty: '', lifecycle: 'archived', visibility: 'exam', q: ' climate ' }), '/admin/writing/prompts?task_type=task2&status=archived&visibility=exam&q=climate');
    const row = normalizeWritingPrompt(raw);
    assert.equal(promptMatches(row, { visibility: 'student', q: 'energy' }), true);
    assert.equal(promptMatches({ ...row, examOnly: true }, { visibility: 'student', q: '' }), false);
  });
});

describe('/admin/writing/prompts native ownership and safety contract', () => {
  test('owns the clean route and preserves direct legacy rollback', () => {
    assert.match(PAGE, /function AdminWritingPromptsPage/);
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.doesNotMatch(CONFIG, /source:\s*['"]\/admin\/writing\/prompts['"]/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'writing', 'prompts.html')));
    assert.match(CHROME, /slug:\s*'prompts'[^\n]+href:\s*'\/admin\/writing\/prompts'/);
    assert.match(HUB, /Thư viện prompt[^\n]+NATIVE/);
    assert.match(LEDGER, /`\/admin\/writing\/prompts`[^\n]+authed-admin-writing-prompts[^\n]+native React ownership/);
  });

  test('guards stale responses, locks mutations and reads canonical state back', () => {
    assert.match(COMPONENT, /requestId !== sequence\.current/);
    assert.match(COMPONENT, /profileRef\.current !== account/);
    assert.match(COMPONENT, /mutationLock\.current/);
    assert.match(COMPONENT, /const canonical = await readAll\(\)/);
    assert.match(COMPONENT, /Đọc lại không khớp/);
    assert.match(COMPONENT, /Snapshot đang stale/);
    assert.doesNotMatch(COMPONENT, /window\.confirm|window\.alert|\bconfirm\(/);
  });

  test('preserves image and answer-key truth across writes', () => {
    assert.match(COMPONENT, /expected_image_public_id: analysisEditor\.imagePublicId/);
    assert.match(COMPONENT, /axes_or_categories:/);
    assert.match(COMPONENT, /discard-image/);
    assert.match(COMPONENT, /network failure after the write starts is ambiguous/);
    assert.match(COMPONENT, /pendingCreate\.current/);
    assert.match(COMPONENT, /Thử đối chiếu lại/);
    assert.match(COMPONENT, /image\/png,image\/jpeg,image\/webp/);
    assert.match(COMPONENT, /document\.hidden/);
    assert.doesNotMatch(COMPONENT, /setInterval\(/);
  });

  test('loads governed responsive styles and CI browser verifier', () => {
    for (const style of ['admin-components.css', 'admin-buttons.css', 'admin-status.css', 'admin-writing-prompts-next.css']) assert.ok(LAYOUT.includes(style));
    assert.match(CSS, /@media\(max-width:768px\)/);
    assert.match(CSS, /@media\(max-width:520px\)/);
    assert.match(CSS, /:focus-visible/);
    assert.match(CSS, /@media\(prefers-reduced-motion:reduce\)/);
    assert.match(WORKFLOW, /authed-admin-writing-prompts/);
    assert.match(WORKFLOW, /verify-admin-writing-prompts-flow\.mjs/);
  });
});
