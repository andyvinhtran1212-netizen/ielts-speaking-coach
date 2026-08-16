import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  listeningStandaloneParams,
  normalizeListeningStandaloneBoot,
  normalizeListeningStandaloneResult,
} from '../lib/listening-standalone-exercise-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const CLIENT = read('app', '(authed-listening)', 'listening', '(standalone-exercises)', '_components', 'listening-standalone-workspace.tsx');
const LAYOUT = read('app', '(authed-listening)', 'listening', '(standalone-exercises)', 'layout.tsx');
const BROWSE = read('app', '(authed-listening)', 'listening', 'browse', 'listening-browse-behavior.tsx');
const CSS = read('public', 'css', 'listening-standalone-next.css');
const PARITY = read('..', '.github', 'workflows', 'parity-gate.yml');

const content = { id: 'content-1', title: 'Fixture', audio_signed_url: 'https://audio.test/a.mp3', audio_duration_seconds: 65 };
const envelope = (exercise_type, payload) => ({ exercises: [{ id: `exercise-${exercise_type}`, content_id: 'content-1', exercise_type, payload }] });

describe('Listening standalone native model', () => {
  test('parses only canonical content_id and keeps null absent', () => {
    assert.deepEqual(listeningStandaloneParams('?content_id=%20content-1%20'), { contentId: 'content-1' });
    assert.deepEqual(listeningStandaloneParams('?test_id=legacy'), { contentId: null });
  });

  test('normalizes the three student-safe exercise shapes', () => {
    const gist = normalizeListeningStandaloneBoot('gist', 'content-1', content, envelope('gist', { prompt_text: 'Summarise.' }));
    assert.equal(gist.exercise.prompt, 'Summarise.');
    const tf = normalizeListeningStandaloneBoot('true_false', 'content-1', content, envelope('true_false', { statements: [
      { idx: 1, text: 'Second' }, { idx: 0, text: 'First' },
    ] }));
    assert.deepEqual(tf.exercise.statements.map((row) => row.idx), [0, 1]);
    const mcq = normalizeListeningStandaloneBoot('mcq', 'content-1', content, envelope('mcq', { questions: [
      { idx: 0, stem: 'Question?', options: ['A', 'B', 'C', 'D'] },
    ] }));
    assert.equal(mcq.exercise.questions[0].options.length, 4);
  });

  test('fails closed on answer leaks, cross-content rows and duplicate published blocks', () => {
    assert.throws(() => normalizeListeningStandaloneBoot('mcq', 'content-1', content, envelope('mcq', {
      questions: [{ idx: 0, stem: 'Question?', options: ['A', 'B', 'C', 'D'], answer_idx: 1 }],
    })), /answer-leak/);
    assert.throws(() => normalizeListeningStandaloneBoot('true_false', 'content-1', content, envelope('true_false', {
      statements: [{ idx: 0, text: 'Statement', answer: 'T' }],
    })), /answer-leak/);
    assert.throws(() => normalizeListeningStandaloneBoot('gist', 'content-1', content, envelope('gist', {
      prompt_text: 'Prompt', model_answer: 'Secret',
    })), /answer-leak/);
    assert.throws(() => normalizeListeningStandaloneBoot('true_false', 'content-1', content, envelope('true_false', {
      statements: [{ idx: 1, text: 'Non-contiguous' }],
    })), /items-contract/);
    assert.equal(normalizeListeningStandaloneBoot('gist', 'content-1', content, { exercises: [] }), null);
    const duplicate = envelope('gist', { prompt_text: 'One' });
    duplicate.exercises.push({ ...duplicate.exercises[0], id: 'duplicate' });
    assert.throws(() => normalizeListeningStandaloneBoot('gist', 'content-1', content, duplicate), /uniqueness/);
  });

  test('validates mutation identity and score/detail contracts', () => {
    const gist = normalizeListeningStandaloneResult('gist', 'exercise-gist', 1, {
      attempt_id: 'attempt-1', exercise_id: 'exercise-gist', mode: 'gist', is_first_attempt: true,
      score: 82, is_correct: true, ai_used: false, feedback: 'Good', keyword_matches: ['travel'],
    });
    assert.equal(gist.firstAttempt, true);
    assert.equal(gist.aiUsed, false);
    const tf = normalizeListeningStandaloneResult('true_false', 'exercise-tf', 1, {
      attempt_id: 'attempt-2', exercise_id: 'exercise-tf', mode: 'true_false', is_first_attempt: false,
      score: 1, correct: 1, total: 1, is_correct: true,
      details: [{ idx: 0, actual: 'T', expected: 'T', is_correct: true }],
    });
    assert.equal(tf.details[0].expected, 'T');
    assert.throws(() => normalizeListeningStandaloneResult('mcq', 'exercise-mcq', 1, {
      attempt_id: 'attempt-3', exercise_id: 'wrong', mode: 'mcq', is_first_attempt: true,
      score: 1, correct: 1, total: 1, is_correct: true, details: [{ idx: 0, actual_idx: 0, is_correct: true }],
    }), /identity/);
  });
});

describe('Listening standalone native route contract', () => {
  test('owns all three clean routes with shared auth, audio and feedback dependencies', () => {
    for (const [route, mode] of [['gist', 'gist'], ['tf', 'true_false'], ['mcq', 'mcq']]) {
      const page = read('app', '(authed-listening)', 'listening', '(standalone-exercises)', route, 'page.tsx');
      assert.match(page, new RegExp(`mode=["']${mode}["']`));
      assert.match(page, /<aver-chrome active="listening"/);
    }
    assert.match(LAYOUT, /listening-standalone-next\.css/);
    assert.match(LAYOUT, /audio-player\.js/);
    assert.match(LAYOUT, /feedback-widgets\.js/);
  });

  test('loads abortably, scopes state by account and never exposes raw backend detail', () => {
    assert.match(CLIENT, /useSearchParams\(\)/);
    assert.match(CLIENT, /key=\{`\$\{accountKey \|\| status\}:\$\{mode\}:\$\{contentId \|\| 'picker'\}`\}/);
    assert.doesNotMatch(CLIENT, /window\.location\.search/);
    assert.match(CLIENT, /Promise\.all/);
    assert.match(CLIENT, /noRedirect:\s*true, signal:\s*controller\.signal/);
    assert.match(CLIENT, /controller\.abort\(\)/);
    assert.match(CLIENT, /Bài có thể đã được ghi; hệ thống sẽ không tự gửi lại/);
    assert.doesNotMatch(CLIENT, /error\.message|String\(error\)|messageOf/);
  });

  test('uses controlled React fields, validates complete answers and sends canonical modes', () => {
    assert.match(CLIENT, /value=\{gistAnswer\}/);
    assert.match(CLIENT, /checked=\{answers\[index\] === value\}/);
    assert.match(CLIENT, /answers\.some\(\(answer\) => answer === null \|\| answer === ''\)/);
    assert.match(CLIENT, /body\.mcq_answers = answers/);
    assert.match(CLIENT, /body\.answers = answers/);
    assert.match(CLIENT, /body\.user_transcript = gistAnswer/);
    assert.match(CLIENT, /event\.metaKey \|\| event\.ctrlKey/);
    assert.match(CLIENT, /postWith<unknown>\('\/api\/listening\/attempts'/);
    assert.doesNotMatch(CLIENT, /innerHTML|dangerouslySetInnerHTML|eval\(/);
  });

  test('browse sends migrated modes to clean routes and retains dictation rollback until its batch', () => {
    assert.match(BROWSE, /\['dictation', 'Chép chính tả', '\/pages\/listening-dictation\.html'\]/);
    assert.match(BROWSE, /\['gist', 'Ý chính', '\/listening\/gist'\]/);
    assert.match(BROWSE, /\['true_false', 'Đúng\/Sai', '\/listening\/tf'\]/);
    assert.match(BROWSE, /\['mcq', 'Trắc nghiệm', '\/listening\/mcq'\]/);
  });

  test('ships responsive token-only page CSS and an unconditional browser gate', () => {
    assert.match(CSS, /@media \(max-width: 640px\)/);
    assert.match(CSS, /prefers-reduced-motion/);
    assert.doesNotMatch(CSS, /#[0-9a-fA-F]{3,8}\b/);
    assert.match(PARITY, /verify-listening-standalone-flow\.mjs/);
  });
});
