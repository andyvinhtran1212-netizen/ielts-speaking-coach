import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizeBulkCreate,
  normalizeBulkTopicResult,
  normalizeGenerateResult,
  normalizeSpeakingQuestionList,
  normalizeSpeakingTopicList,
  speakingTopicsQuery,
  topicMatches,
} from '../lib/admin-speaking-topics-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const PAGE = read('app', '(authed-admin-speaking-topics)', 'admin', 'speaking', 'topics', 'page.tsx');
const COMPONENT = read('app', '(authed-admin-speaking-topics)', 'admin', 'speaking', 'topics', 'admin-speaking-topics.tsx');
const LAYOUT = read('app', '(authed-admin-speaking-topics)', 'layout.tsx');
const CSS = read('public', 'css', 'admin-speaking-topics-next.css');
const LEGACY = read('public', 'pages', 'admin', 'speaking', 'topics.html');
const CHROME = read('public', 'js', 'components', 'aver-admin-chrome.js');
const HUB = read('app', '(authed-admin-speaking)', 'admin', 'speaking', 'page.tsx');
const WORKFLOW = read('..', '.github', 'workflows', 'parity-gate.yml');
const LEDGER = read('..', 'docs', 'ROUTE_LEDGER.md');

describe('admin Speaking Topics model', () => {
  test('keeps metadata outages unknown instead of zero', () => {
    const result = normalizeSpeakingTopicList([{ id: 't1', title: 'Travel', part: 1, question_count: null, question_metadata_lookup_failed: true }]);
    assert.equal(result.malformedCount, 0);
    assert.equal(result.rows[0].questionCount, null);
    assert.equal(result.rows[0].questionMetadataLookupFailed, true);
    assert.equal(result.rows[0].status, 'metadata_unavailable');
  });

  test('drops malformed topics and sorts actual question parts', () => {
    const topics = normalizeSpeakingTopicList([{ id: '', title: 'Bad', part: 1 }, { id: 't1', title: 'Good', part: 2, question_count: 2 }]);
    assert.equal(topics.malformedCount, 1);
    assert.equal(topics.rows.length, 1);
    const questions = normalizeSpeakingQuestionList([
      { id: 'q3', topic_id: 't1', part: 3, order_num: 1, question_text: 'Follow up?' },
      { id: 'q2', topic_id: 't1', part: 2, order_num: 1, question_text: 'Describe a journey.' },
      { id: 'bad', topic_id: 'other', part: 2, question_text: 'Wrong topic' },
    ], 't1');
    assert.deepEqual(questions.rows.map((row) => row.id), ['q2', 'q3']);
    assert.equal(questions.malformedCount, 1);
  });

  test('marks audio ready only when a public URL exists', () => {
    const questions = normalizeSpeakingQuestionList([
      { id: 'path-only', topic_id: 't1', part: 1, question_text: 'Path only?', audio_path: 'questions/path.mp3' },
      { id: 'url-only', topic_id: 't1', part: 1, question_text: 'Legacy URL?', audio_url: 'https://audio.test/legacy.mp3' },
      { id: 'url-path', topic_id: 't1', part: 1, question_text: 'Current?', audio_url: 'https://audio.test/current.mp3', audio_path: 'questions/current.mp3' },
    ], 't1');

    assert.deepEqual(questions.rows.map((row) => [row.id, row.audioReady]), [
      ['path-only', false],
      ['url-only', true],
      ['url-path', true],
    ]);
  });

  test('requires exact acknowledgements for generate and bulk writes', () => {
    const generated = normalizeGenerateResult({ topic_id: 't1', mode: 'missing_only', question_count: 1, questions: [{ id: 'q1', topic_id: 't1', part: 1, order_num: 1, question_text: 'Where?' }] }, 't1', 'missing_only');
    assert.equal(generated.questions.length, 1);
    assert.equal(normalizeGenerateResult({ topic_id: 'other', mode: 'missing_only', question_count: 0, questions: [] }, 't1', 'missing_only'), null);
    assert.deepEqual(normalizeBulkTopicResult({ processed_count: 2, success_ids: ['a'], failed_ids: ['b'], errors: [] }, ['a', 'b']).failedIds, ['b']);
    assert.equal(normalizeBulkTopicResult({ processed_count: 2, success_ids: ['a'], failed_ids: [], errors: [] }, ['a', 'b']), null);
    assert.equal(normalizeBulkTopicResult({ processed_count: 2, success_ids: ['a'], failed_ids: ['a', 'b'], errors: [] }, ['a', 'b']), null);
    assert.equal(normalizeBulkCreate({ created_count: 1, topics: [{ id: 't1', title: 'Travel', part: 1, question_count: 0 }] }).count, 1);
    assert.equal(normalizeBulkCreate({ created_count: 2, topics: [{ id: 't1', title: 'Travel', part: 1 }, { id: 't1', title: 'Work', part: 1 }] }), null);
  });

  test('encodes URL state and filters by part plus search', () => {
    assert.equal(speakingTopicsQuery(2, 'travel & work', 't/1'), 'part=2&q=travel+%26+work&topic=t%2F1');
    assert.equal(topicMatches({ title: 'Travel', category: 'Lifestyle', part: 2 }, 2, 'style'), true);
    assert.equal(topicMatches({ title: 'Travel', category: '', part: 2 }, 1, ''), false);
  });
});

describe('/admin/speaking/topics native ownership and UX contract', () => {
  test('owns canonical route behind the backend admin gate and keeps rollback HTML', () => {
    assert.match(PAGE, /function AdminSpeakingTopicsPage/);
    assert.match(PAGE, /<AdminAccessGate>/);
    assert.match(PAGE, /<aver-admin-chrome active="speaking" subsection="topics">/);
    assert.ok(existsSync(join(ROOT, 'public', 'pages', 'admin', 'speaking', 'topics.html')));
    assert.match(CHROME, /slug: 'topics', label: 'Topics & questions', href: '\/admin\/speaking\/topics'/);
    assert.match(HUB, /href: '\/admin\/speaking\/topics'/);
    assert.match(LEDGER, /`\/admin\/speaking\/topics`[^\n]+native React ownership/);
  });

  test('uses safe AI semantics and full question fields', () => {
    assert.match(COMPONENT, /mode: 'missing_only'/);
    assert.match(COMPONENT, /mode: 'replace_all'/);
    assert.match(COMPONENT, /if \(!editing \|\| editing\.text !== text\) body\.question_text = text/);
    assert.match(COMPONENT, /part: questionForm\.part/);
    assert.match(COMPONENT, /const questionType = questionForm\.questionType\.trim\(\)/);
    assert.match(COMPONENT, /question_type: questionType/);
    assert.match(COMPONENT, /order_num: orderNum/);
    assert.match(COMPONENT, /questionForm\.part === 2 \? questionForm\.bullets/);
    assert.match(COMPONENT, /questionForm\.part === 2 \? questionForm\.reflection\.trim\(\) : ''/);
    assert.match(COMPONENT, /cue_card_bullets: bullets\.length \? bullets : null/);
    assert.match(COMPONENT, /cue_card_reflection: reflection \|\| null/);
    assert.match(COMPONENT, /Audio cũ đã được gỡ/);
  });

  test('reconciles every mutation from canonical GET and locks duplicate submits', () => {
    assert.match(COMPONENT, /mutationLock\.current/);
    assert.match(COMPONENT, /const canonical = await readTopics\(\)/);
    assert.match(COMPONENT, /const canonicalQuestions = await readQuestions/);
    assert.match(COMPONENT, /saved\.category !== body\.category/);
    assert.match(COMPONENT, /saved\.cueCardBullets\.some/);
    assert.match(COMPONENT, /saved\.audioReady !== editing\.audioReady/);
    assert.match(COMPONENT, /setListError\(null\)/);
    assert.match(COMPONENT, /toggleExpectation/);
    assert.match(COMPONENT, /generatedExpectation/);
    assert.match(COMPONENT, /bulkGeneratedIds/);
    assert.match(COMPONENT, /partialFailure[\s\S]+kind: 'error'/);
    assert.match(COMPONENT, /questions\?\.account === profile\.id/);
    assert.match(COMPONENT, /saved\.title !== created\.title/);
    assert.match(COMPONENT, /Đã đồng bộ trạng thái canonical/);
    assert.doesNotMatch(COMPONENT, /\bconfirm\s*\(/);
    assert.match(COMPONENT, /<Dialog open=\{confirming !== null\}/);
  });

  test('surfaces degraded reads and uses governed responsive styles', () => {
    assert.match(COMPONENT, /Không đọc được metadata câu hỏi/);
    assert.match(COMPONENT, /Không giả dữ liệu lỗi thành danh sách trống/);
    assert.match(LAYOUT, /<AuthedShell/);
    for (const style of ['admin-components.css', 'admin-buttons.css', 'admin-status.css', 'admin-speaking-topics-next.css']) assert.ok(LAYOUT.includes(style));
    assert.match(CSS, /\.ast-table,.ast-table tbody,.ast-table tr,.ast-table td\{display:block\}/);
    assert.match(CSS, /@media\(max-width:480px\)/);
    assert.match(CSS, /:focus-visible/);
    assert.match(CSS, /@media\(prefers-reduced-motion:reduce\)/);
    assert.match(WORKFLOW, /authed-admin-speaking-topics/);
    assert.match(WORKFLOW, /verify-admin-speaking-topics-flow\.mjs/);
    assert.doesNotMatch(LEGACY, /href="\/admin\.html"/);
  });
});
