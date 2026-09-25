import assert from 'node:assert/strict';
import test from 'node:test';

import { availableQuestionLanguages, displayOptionLanguage, displayQuestion, groupProgrammeQuestions } from '../lib/listening-programme-learning.mjs';

test('guided mode stays per-question even when questions share a stimulus', () => {
  const questions = [
    { q_num: 1, source_stimulus_ids: ['a'] }, { q_num: 2, source_stimulus_ids: ['a'] },
    { q_num: 3, source_stimulus_ids: ['b'] }, { q_num: 4, source_stimulus_ids: ['a'] },
  ];
  assert.deepEqual(groupProgrammeQuestions(questions).map((group) => group.questions.map((q) => q.q_num)), [[1], [2], [3], [4]]);
});

test('only complete, source-matched editorial translation unlocks the language switch', () => {
  const pilot = { source_item_id: 'manus:A0.2-018.P1', prompt: 'Mai đang rủ cả hai cùng làm hay yêu cầu riêng Ben làm?', options: { A: 'Rủ cả hai cùng làm', B: 'Chỉ yêu cầu Ben làm' } };
  assert.deepEqual(availableQuestionLanguages([pilot]), ['vi', 'en']);
  assert.match(displayQuestion(pilot, 'en').prompt, /Mai inviting both/);
  assert.equal(displayQuestion(pilot, 'en').options.B, 'Asking only Ben to act');
  assert.deepEqual(availableQuestionLanguages([{ ...pilot, prompt: 'Corrected source prompt' }]), []);
  assert.deepEqual(availableQuestionLanguages([{ ...pilot, options: { A: 'Changed', B: 'Chỉ yêu cầu Ben làm' } }]), []);
  assert.deepEqual(availableQuestionLanguages([pilot, { source_item_id: 'other', prompt: 'Other', options: {} }]), []);
});

test('heard-word pilot also fails closed when original choice labels drift', () => {
  const source = {
    source_item_id: 'manus:A0-38.v0.2.0.sounds.q01',
    prompt: 'Nghe từ số1. Chọn từ tiếng Anh đã nghe.',
    options: { a: 'in', b: 'on', c: 'at' },
  };
  assert.deepEqual(availableQuestionLanguages([source]), ['vi', 'en']);
  assert.equal(displayOptionLanguage(source, 'vi'), 'en');
  assert.equal(displayOptionLanguage(source, 'en'), 'en');
  assert.deepEqual(availableQuestionLanguages([{ ...source, options: { a: 'in', b: 'on', c: 'to' } }]), []);
  assert.deepEqual(availableQuestionLanguages([{ ...source, visual_url: '/signed/new-visual.svg' }]), []);
});

test('reviewed package translation switches an English-source question without changing its answer key', () => {
  const source = {
    q_num: 3, source_item_id: 'lesson.practice.q03', prompt: 'Which place is mentioned?',
    response_type: 'single_choice', options: { A: 'Library', B: 'Museum' },
    editorial_translation: {
      status: 'approved', source_item_id: 'lesson.practice.q03',
      source_language: 'en', target_language: 'vi',
      source_prompt: 'Which place is mentioned?', source_options: { A: 'Library', B: 'Museum' },
      prompt: 'Địa điểm nào được nhắc đến?', options: { A: 'Thư viện', B: 'Bảo tàng' },
    },
  };
  assert.deepEqual(availableQuestionLanguages([source]), ['vi', 'en']);
  assert.equal(displayQuestion(source, 'en'), source);
  assert.equal(displayOptionLanguage(source, 'en'), 'en');
  assert.equal(displayOptionLanguage(source, 'vi'), 'vi');
  const translated = displayQuestion(source, 'vi');
  assert.equal(translated.prompt, 'Địa điểm nào được nhắc đến?');
  assert.deepEqual(translated.options, { A: 'Thư viện', B: 'Bảo tàng' });
  assert.equal(translated.q_num, source.q_num);
  assert.equal(translated.source_item_id, source.source_item_id);
  assert.deepEqual(source.options, { A: 'Library', B: 'Museum' });
  assert.deepEqual(availableQuestionLanguages([source, { ...source, editorial_translation: undefined }]), []);
  assert.deepEqual(availableQuestionLanguages([{ ...source, editorial_translation: { ...source.editorial_translation, status: 'draft' } }]), []);
  assert.deepEqual(availableQuestionLanguages([{ ...source, editorial_translation: { ...source.editorial_translation, source_prompt: 'Changed' } }]), []);
  assert.deepEqual(availableQuestionLanguages([{ ...source, editorial_translation: { ...source.editorial_translation, options: { A: 'Thư viện' } } }]), []);
});

test('unchanged heard-word labels need an explicit review flag', () => {
  const source = {
    source_item_id: 'heard-word', prompt: 'Choose the word you hear.', options: { A: 'in', B: 'on' },
    editorial_translation: {
      status: 'approved', source_item_id: 'heard-word', source_language: 'en', target_language: 'vi',
      source_prompt: 'Choose the word you hear.', source_options: { A: 'in', B: 'on' },
      prompt: 'Chọn từ bạn nghe được.', unchanged_options_reviewed: true,
    },
  };
  assert.deepEqual(availableQuestionLanguages([source]), ['vi', 'en']);
  assert.equal(displayOptionLanguage(source, 'vi'), 'en');
  assert.deepEqual(displayQuestion(source, 'vi').options, source.options);
  assert.deepEqual(availableQuestionLanguages([{ ...source, editorial_translation: { ...source.editorial_translation, unchanged_options_reviewed: false } }]), []);
});

test('approved Vietnamese-source review item retains English heard-word pronunciation', () => {
  const source = {
    source_item_id: 'manus:A0-38.v0.2.0.review.q01',
    prompt: 'Nghe từ đầu tiên. Chọn từ đã nghe.',
    options: { a: 'in', b: 'on', c: 'at' },
    editorial_translation: {
      status: 'approved', source_item_id: 'manus:A0-38.v0.2.0.review.q01',
      source_language: 'vi', target_language: 'en',
      source_prompt: 'Nghe từ đầu tiên. Chọn từ đã nghe.',
      source_options: { a: 'in', b: 'on', c: 'at' },
      prompt: 'Listen to the first word. Choose the word you hear.',
      unchanged_options_reviewed: true,
    },
  };
  assert.deepEqual(availableQuestionLanguages([source]), ['vi', 'en']);
  assert.equal(displayOptionLanguage(source, 'vi'), 'en');
  assert.equal(displayOptionLanguage(source, 'en'), 'en');
});

test('map form remains original-language until localized visual and accessible text are provided', () => {
  const source = {
    source_item_id: 'map-1', prompt: 'Where is the library?', options: { A: 'North', B: 'South' },
    visual_url: '/signed/english.svg', visual_accessibility: 'Map with English labels',
    editorial_translation: {
      status: 'approved', source_item_id: 'map-1', source_language: 'en', target_language: 'vi',
      source_prompt: 'Where is the library?', source_options: { A: 'North', B: 'South' },
      prompt: 'Thư viện ở đâu?', options: { A: 'Phía bắc', B: 'Phía nam' },
    },
  };
  assert.deepEqual(availableQuestionLanguages([source]), []);
  const localized = { ...source, editorial_translation: {
    ...source.editorial_translation, visual_url: '/signed/vietnamese.svg',
    visual_accessibility: 'Sơ đồ có nhãn tiếng Việt',
  } };
  assert.deepEqual(availableQuestionLanguages([localized]), ['vi', 'en']);
  assert.equal(displayQuestion(localized, 'vi').visual_url, '/signed/vietnamese.svg');
  assert.equal(displayQuestion(localized, 'vi').visual_accessibility, 'Sơ đồ có nhãn tiếng Việt');
});
