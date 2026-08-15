import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyWritingResult,
  countWritingWords,
  essayTaskToTipTask,
  regradeStatusText,
  selectWritingResultView,
  selectWritingTips,
  writingBandLabel,
} from '../lib/writing-result-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-writing-result)', 'writing', 'result', 'page.tsx');
const LAYOUT = read('app', '(authed-writing-result)', 'layout.tsx');
const BEHAVIOR = read('app', '(authed-writing-result)', 'writing', 'result', 'writing-result-behavior.tsx');
const CONFIG = read('next.config.ts');
const PAIRS = JSON.parse(read('tooling', 'parity-pairs-authed.json'));
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');

describe('/writing/result — native Next ownership', () => {
  test('owns the canonical route atomically and keeps rollback HTML', () => {
    assert.match(PAGE, /WritingResultBehavior/);
    assert.doesNotMatch(CONFIG, /source:\s*['"]\/writing\/result['"]/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'writing-result.html')));
  });

  test('keeps the legacy stylesheet order without the Tailwind reset', () => {
    const order = ['writing-renderers.css', 'writing-result.css', 'writing-highlight.css', 'image-lightbox.css', 'markdown.css'];
    let cursor = -1;
    for (const name of order) {
      const index = LAYOUT.indexOf(name);
      assert.ok(index > cursor, `${name} must keep legacy cascade order`);
      cursor = index;
    }
    assert.match(LAYOUT, /utilityLayer=\{false\}/);
    for (const script of ['writing-renderers.js', 'writing-highlight.js', 'image-lightbox.js', 'markdown.js']) {
      assert.match(LAYOUT, new RegExp(script.replace('.', '\\.')));
    }
  });

  test('waits for auth and shared globals before the canonical read', () => {
    assert.match(BEHAVIOR, /status === 'signed-out'/);
    assert.match(BEHAVIOR, /window\.location\.replace\('\/login'\)/);
    assert.match(BEHAVIOR, /status === 'signed-in' && user\?\.id/);
    assert.match(BEHAVIOR, /accountKey \? `\$\{accountKey\}:\$\{essayId\}` : ''/);
    assert.match(BEHAVIOR, /selectWritingResultView\(resultState, requestKey\)/);
    assert.doesNotMatch(BEHAVIOR, /loadedKeyRef|ranRef/);
    assert.match(BEHAVIOR, /if \(!accountKey \|\| view\.kind === 'loading'\)/);
    assert.match(BEHAVIOR, /whenGlobalReady/);
    assert.match(BEHAVIOR, /WritingRenderers/);
    assert.match(BEHAVIOR, /\/api\/writing\/my-essays\/\$\{encodeURIComponent\(essayId\)\}/);
    assert.match(BEHAVIOR, /params\?\.get\('essay_id'\).*params\?\.get\('id'\)/s);
  });

  test('StrictMode replay remains live and failed globals become an actionable error', () => {
    assert.match(BEHAVIOR, /setResultState\(\{ key: requestKey, value: \{ kind: 'loading' \} \}\)/);
    assert.match(BEHAVIOR, /if \(dead\) return;[\s\S]*if \(!globalsReady\)/);
    assert.match(BEHAVIOR, /Không tải được công cụ hiển thị bài viết\. Vui lòng tải lại trang\./);
    assert.match(BEHAVIOR, /return \(\) => \{ dead = true; \}/);
  });

  test('preserves renderer, highlight, optional-section and hidden-score contracts', () => {
    assert.match(BEHAVIOR, /SECTION_RENDERERS/);
    assert.match(BEHAVIOR, /WritingHighlight\.render/);
    assert.match(BEHAVIOR, /OPTIONAL_SECTIONS\.has\(sectionKey\)/);
    assert.match(BEHAVIOR, /sectionKey === 'counterargument'/);
    assert.match(BEHAVIOR, /sectionKey === 'criteria' && hideScores/);
    assert.match(BEHAVIOR, /không hiển thị điểm band/);
  });

  test('keeps accessible tab keyboard navigation and conditional instructor note', () => {
    assert.match(BEHAVIOR, /ArrowLeft.*ArrowRight.*Home.*End/);
    assert.match(BEHAVIOR, /role="tablist"/);
    assert.match(BEHAVIOR, /aria-selected=\{tab === item\.key\}/);
    assert.match(BEHAVIOR, /hasInstructorNote/);
    assert.match(BEHAVIOR, /renderInstructorNote/);
  });

  test('preserves regrade validation, endpoint and post-submit canonical state', () => {
    assert.match(BEHAVIOR, /if \(regradeSendingRef\.current\) return/);
    assert.match(BEHAVIOR, /regradeSendingRef\.current = true/);
    assert.match(BEHAVIOR, /trimmed\.length < 50/);
    assert.match(BEHAVIOR, /maxLength=\{500\}/);
    assert.match(BEHAVIOR, /window\.api\.post\(`\/api\/writing\/essays\/\$\{encodeURIComponent\(essayId\)\}\/regrade-request`/);
    assert.match(BEHAVIOR, /setRegradeRequest\(\{ status: 'pending' \}\)/);
  });

  test('downloads DOCX with the current bearer session and server filename', () => {
    assert.match(BEHAVIOR, /window\.getSupabase\(\)/);
    assert.match(BEHAVIOR, /Authorization: `Bearer \$\{session\.access_token\}`/);
    assert.match(BEHAVIOR, /Content-Disposition/);
    assert.match(BEHAVIOR, /essay_\$\{essayId\}\.docx/);
  });

  test('registers parity and makes route-specific changes trigger the gate', () => {
    const pair = PAIRS.find((candidate) => candidate.name === 'writing-result');
    assert.deepEqual([pair?.legacy, pair?.next], ['/pages/writing-result.html', '/writing/result']);
    assert.deepEqual(
      pair.allow.map((entry) => `${entry.kind}:${entry.value}`).sort(),
      ['component-missing:header', 'component-missing:main', 'component-missing:nav'],
    );
    assert.ok(pair.allow.every((entry) => entry.reason.length > 40));
    assert.match(WORKFLOW, /frontend\/app\/\(authed-writing-result\)\/\*\*/);
    assert.match(WORKFLOW, /writing-result/);
  });
});

describe('writing-result pure state contract', () => {
  test('separates flagged, pending and delivered feedback states', () => {
    assert.equal(classifyWritingResult({ essay: { is_flagged: true } }).kind, 'flagged');
    assert.equal(classifyWritingResult({ essay: { status: 'graded' } }).kind, 'not-delivered');
    assert.equal(classifyWritingResult({ essay: { status: 'delivered' } }).kind, 'not-delivered');
    assert.equal(classifyWritingResult({ essay: { status: 'delivered' }, feedback: { feedback_json: {} } }).kind, 'ready');
  });

  test('keeps band, word-count, tip and regrade mappings deterministic', () => {
    assert.equal(writingBandLabel({}, { overallBandScore: 6.5 }), 'Band 6.5');
    assert.equal(countWritingWords('  one   two\nthree '), 3);
    assert.equal(essayTaskToTipTask('task1_academic'), 'task_1');
    assert.deepEqual(selectWritingTips([
      { id: 'a', task_type: 'task_2' }, { id: 'b', task_type: 'both' }, { id: 'c', task_type: 'task_1' },
    ], 'task2').map((tip) => tip.id), ['a', 'b']);
    assert.match(regradeStatusText({ status: 'rejected', admin_response: 'Thiếu căn cứ' }), /Thiếu căn cứ/);
  });

  test('hides the previous account synchronously when the request key changes', () => {
    const privateView = { kind: 'ready', essay: { essay_text: 'private A' } };
    const state = { key: 'user-a:essay-1', value: privateView };
    assert.equal(selectWritingResultView(state, 'user-a:essay-1'), privateView);
    assert.deepEqual(selectWritingResultView(state, 'user-b:essay-1'), { kind: 'loading' });
    assert.deepEqual(selectWritingResultView(state, ''), { kind: 'loading' });
  });
});
