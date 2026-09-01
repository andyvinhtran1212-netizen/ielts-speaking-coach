import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizeStandaloneDictationBoot,
  normalizeStandaloneDictationResult,
  standaloneDictationParams,
  summarizeStandaloneDictation,
} from '../lib/listening-standalone-dictation-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const CLIENT = read('app', '(authed-listening)', 'listening', '(standalone-exercises)', 'dictation', 'listening-standalone-dictation.tsx');
const BROWSE = read('app', '(authed-listening)', 'listening', 'browse', 'listening-browse-behavior.tsx');
const CSS = read('public', 'css', 'listening-standalone-next.css');
const GATE = read('..', '.github', 'workflows', 'parity-gate.yml');

const boot = () => ({
  content: {
    id: 'content-1', title: 'Booking', audio_signed_url: 'https://audio.test/clip.mp3',
    audio_duration_seconds: 30, accent_tag: 'british', cefr_level: 'B1',
    ielts_section: 1, topic_tags: ['travel'],
  },
  exercises: [{
    id: 'exercise-1', content_id: 'content-1', exercise_type: 'dictation',
    segments: [
      { idx: 1, start_sec: 5, end_sec: 8 },
      { idx: 0, start_sec: 1, end_sec: 4 },
    ],
  }],
});

const result = (overrides = {}) => ({
  attempt_id: 'attempt-1', exercise_id: 'exercise-1', segment_idx: 0,
  mode: 'dictation', is_first_attempt: true, score: 2 / 3,
  correct_words: 2, total_words: 3, is_correct: false,
  diff: [
    { op: 'match', expected: 'Good', actual: 'Good' },
    { op: 'wrong', expected: 'morning,', actual: 'evening' },
    { op: 'match', expected: 'Andy.', actual: 'Andy.' },
  ],
  ...overrides,
});

describe('Standalone Dictation model', () => {
  test('uses only canonical content_id and normalizes safe ordered clip metadata', () => {
    assert.deepEqual(standaloneDictationParams('?content_id=%20content-1%20'), { contentId: 'content-1' });
    assert.deepEqual(standaloneDictationParams('?test_id=legacy'), { contentId: null });
    const normalized = normalizeStandaloneDictationBoot('content-1', boot());
    assert.deepEqual(normalized.exercise.segments.map((segment) => segment.idx), [0, 1]);
    assert.equal(normalized.content.accent, 'british');
  });

  test('fails closed on transcript leaks, unsafe audio and dishonest segments', () => {
    const leakedContent = boot(); leakedContent.content.transcript = 'secret';
    assert.throws(() => normalizeStandaloneDictationBoot('content-1', leakedContent), /answer-leak/);
    const leakedSegment = boot(); leakedSegment.exercises[0].segments[0].transcript = 'secret';
    assert.throws(() => normalizeStandaloneDictationBoot('content-1', leakedSegment), /answer-leak/);
    const unsafe = boot(); unsafe.content.audio_signed_url = 'javascript:alert(1)';
    assert.throws(() => normalizeStandaloneDictationBoot('content-1', unsafe), /audio-contract/);
    const gap = boot(); gap.exercises[0].segments[1].idx = 3;
    assert.throws(() => normalizeStandaloneDictationBoot('content-1', gap), /segment-contract/);
  });

  test('validates exact mutation identity and reconstructs reference only after grading', () => {
    const normalized = normalizeStandaloneDictationResult('exercise-1', 0, result());
    assert.equal(normalized.reference, 'Good morning, Andy.');
    assert.equal(normalized.firstAttempt, true);
    assert.throws(() => normalizeStandaloneDictationResult('exercise-1', 1, result()), /result-contract/);
    assert.throws(() => normalizeStandaloneDictationResult('exercise-1', 0, result({ score: 1 })), /result-contract/);
    assert.throws(() => normalizeStandaloneDictationResult('exercise-1', 0, result({
      diff: [{ op: 'extra', expected: 'leak', actual: 'word' }],
    })), /diff-contract/);
  });

  test('summarizes only a complete current run and keeps first-attempt truth visible', () => {
    const first = normalizeStandaloneDictationResult('exercise-1', 0, result());
    const second = normalizeStandaloneDictationResult('exercise-1', 1, result({
      attempt_id: 'attempt-2', segment_idx: 1, score: 1, correct_words: 1,
      total_words: 1, is_correct: true, is_first_attempt: false,
      diff: [{ op: 'match', expected: 'Done.', actual: 'Done.' }],
    }));
    const summary = summarizeStandaloneDictation([first, second]);
    assert.equal(summary.totalSegments, 2);
    assert.equal(summary.firstAttemptSegments, 1);
    assert.throws(() => summarizeStandaloneDictation([first, null]), /summary-contract/);
  });
});

describe('Standalone Dictation native route contract', () => {
  test('owns the clean route with shared auth and soft-navigation identity', () => {
    const page = read('app', '(authed-listening)', 'listening', '(standalone-exercises)', 'dictation', 'page.tsx');
    assert.match(page, /ListeningStandaloneDictation/);
    assert.match(page, /<aver-chrome active="listening"/);
    assert.match(CLIENT, /useSearchParams\(\)/);
    assert.match(CLIENT, /accountKey.*contentId/s);
    assert.match(CLIENT, /controller\.abort\(\)/);
  });

  test('uses the safe boot, exact segment writes and no automatic mutation replay', () => {
    assert.match(CLIENT, /\/api\/listening\/dictation\/\$\{encodeURIComponent\(contentId\)\}\/boot/);
    assert.match(CLIENT, /segment_idx:\s*segment\.idx/);
    assert.match(CLIENT, /exercise_id:\s*bundle\.exercise\.id/);
    assert.match(CLIENT, /Bài có thể đã được ghi; hệ thống sẽ không tự gửi lại/);
    assert.doesNotMatch(CLIENT, /error\.message|String\(error\)|innerHTML|dangerouslySetInnerHTML/);
  });

  test('restores segment loop, first-attempt copy, completion and keyboard flow', () => {
    assert.match(CLIENT, /segment-start/);
    assert.match(CLIENT, /segment-end/);
    assert.match(CLIENT, /auto-loop="true"/);
    assert.match(CLIENT, /lần đầu đã ghi điểm chính thức/);
    assert.match(CLIENT, /summarizeStandaloneDictation/);
    assert.match(CLIENT, /event\.metaKey \|\| event\.ctrlKey/);
  });

  test('cuts Browse to the native route and registers an unconditional browser gate', () => {
    assert.match(BROWSE, /\['dictation', 'Chép chính tả', '\/listening\/dictation'\]/);
    assert.match(GATE, /verify-listening-standalone-dictation-flow\.mjs/);
    assert.match(CSS, /\.lse-dictation-progress/);
  });
});
