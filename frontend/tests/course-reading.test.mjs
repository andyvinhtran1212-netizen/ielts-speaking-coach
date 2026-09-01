import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createReading, inlineMd, readingDraftKey,
} from '../public/js/course-reading.js';

const bank = {
  id: 'bank-03',
  meta: {
    short_reading: {
      title: 'Một ngày ở thư viện', role: 'bài về nhà', focus: 'mạo từ',
      word_count: 5, passage: 'Mai reads a short book.',
      vocabulary: [{ term: 'book', part_of_speech: 'n', meaning: 'sách' }],
      question_groups: [
        { id: 'content', title: 'Đọc hiểu', input_type: 'tfng', questions: [
          { id: 'r-01', number: 1, prompt: 'Mai reads a book.' },
        ] },
        { id: 'structure', title: 'Soi cấu trúc câu', input_type: 'short_text', questions: [
          { id: 'r-02', number: 2, prompt: 'Chọn **a** hay *an*.' },
        ] },
      ],
    },
  },
};

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('renderer keeps passage, vocabulary and both question modes', () => {
  const reading = createReading({ api: {}, storage: storage(), userId: 'u1' });
  assert.equal(reading.load(bank), true);
  const html = reading.render();
  assert.match(html, /Mai reads a short book\./);
  assert.match(html, /book/);
  assert.match(html, /type="radio"/);
  assert.match(html, /type="text"/);
  assert.match(html, /disabled>Nộp phần đọc/);
  assert.match(html, /id="cr-back"/);
  assert.match(html, /cr-question__prompt/);
  assert.match(html, /hoàn thành đủ 2 câu/);
});

test('a question can override its group with multiple-choice input', () => {
  const choiceBank = structuredClone(bank);
  choiceBank.meta.short_reading.question_groups[1].questions = [{
    id: 'r-02', number: 2, prompt: 'Vì sao dùng **reads**?',
    input_type: 'choice', options: ['Chủ ngữ số ít', 'Chủ ngữ số nhiều'],
  }];
  const reading = createReading({ api: {}, storage: storage(), userId: 'u1' });
  reading.load(choiceBank);

  const html = reading.render();
  assert.match(html, /value="Chủ ngữ số ít"/);
  assert.match(html, /<strong>reads<\/strong>/);
  assert.doesNotMatch(html, /cr-input-r-02[^>]+type="text"/);
});

test('solution is requested only after every reading answer exists', async () => {
  let calls = 0;
  const api = { post: async (_path, body) => {
    calls += 1;
    assert.deepEqual(body.answers, { 'r-01': 'T', 'r-02': 'a' });
    assert.equal(typeof body.duration_sec, 'number');
    return { translation: 'Mai đọc sách.', answers: [
      { id: 'r-01', answer: 'T', explanation: 'Đúng.' },
      { id: 'r-02', answer: 'a', explanation: 'Phụ âm.' },
    ] };
  } };
  const reading = createReading({ api, storage: storage(), userId: 'u1' });
  reading.load(bank);
  assert.equal(await reading.reveal(), false);
  assert.equal(calls, 0);
  reading.write('r-01', 'T');
  reading.write('r-02', 'a');
  assert.match(reading.render(), /Đã trả lời đủ 2 câu/);
  assert.equal(await reading.reveal(), true);
  assert.equal(calls, 1);
  assert.match(reading.render(), /Mai đọc sách\./);
  assert.match(reading.render(), /Đáp án đúng · <strong>T<\/strong>/);
});

test('review distinguishes a wrong answer from the canonical answer without client grading', async () => {
  const api = { post: async () => ({
    translation: 'Mai đọc sách.',
    answers: [
      { id: 'r-01', answer: 'T', explanation: 'Đúng theo bài đọc.' },
      { id: 'r-02', answer: 'with a blue roof', explanation: 'Cần cả cụm giới từ.' },
    ],
    result: {
      correct: 1, total: 2, pct: 50,
      submitted_answers: { 'r-01': 'T', 'r-02': 'with' },
      answer_results: [
        { id: 'r-01', submitted_answer: 'T', is_correct: true },
        { id: 'r-02', submitted_answer: 'with', is_correct: false },
      ],
    },
  }) };
  const reading = createReading({ api, storage: storage(), userId: 'u1' });
  reading.load(bank);
  reading.write('r-01', 'T');
  reading.write('r-02', 'with');
  assert.equal(await reading.reveal(), true);

  const html = reading.render();
  assert.match(html, /data-correct="true"/);
  assert.match(html, /✓ Chính xác/);
  assert.match(html, /data-correct="false"/);
  assert.match(html, /✕ Chưa chính xác/);
  assert.match(html, /Bạn trả lời · <strong>with<\/strong>/);
  assert.match(html, /Đáp án đúng · <strong>with a blue roof<\/strong>/);
  assert.match(html, /1\/2 câu đúng · 50%/);
  assert.match(html, /value="T" checked disabled/);
  assert.match(html, /value="with" autocomplete="off" disabled/);
});

test('legacy review without item results stays neutral instead of claiming success', async () => {
  const api = { post: async () => ({
    translation: 'Mai đọc sách.',
    answers: [{ id: 'r-01', answer: 'T', explanation: 'Đúng.' }],
    result: { submitted_answers: { 'r-01': 'T', 'r-02': 'a' } },
  }) };
  const reading = createReading({ api, storage: storage(), userId: 'u1' });
  reading.load(bank);
  await reading.review();

  const html = reading.render();
  assert.match(html, /data-correct="unknown"/);
  assert.match(html, /Đã có lời giải/);
  assert.doesNotMatch(html, /data-correct="true"/);
});

test('duration counts only intervals while the reading section is visible', async () => {
  let clock = 0;
  let duration = null;
  const api = { post: async (_path, body) => {
    duration = body.duration_sec;
    return { translation: '', answers: [] };
  } };
  const reading = createReading({
    api, storage: storage(), userId: 'u1', now: () => clock,
  });
  reading.load(bank);

  // Mười phút làm quiz trước khi mở phần đọc không được tính.
  clock = 600_000;
  reading.setActive(true);
  clock += 30_000;
  reading.setActive(false);
  // Mười phút để tab ẩn cũng không được tính.
  clock += 600_000;
  reading.setActive(true);
  clock += 15_000;
  reading.write('r-01', 'T');
  reading.write('r-02', 'a');
  await reading.reveal();

  assert.equal(duration, 45);
});

test('completed reading can hydrate canonical answers after a full reload', async () => {
  const calls = [];
  let writes = 0;
  const reviewStorage = { getItem: () => null, setItem: () => { writes += 1; } };
  const api = { post: async (path, body) => {
    calls.push({ path, body });
    return {
      translation: 'Mai đọc sách.',
      content: { ...bank.meta.short_reading, passage: 'Original saved passage.' },
      answers: [{ id: 'r-01', answer: 'T', explanation: 'Đúng.' }],
      result: { submitted_answers: { 'r-01': 'T', 'r-02': 'a' } },
    };
  } };
  const reading = createReading({ api, storage: reviewStorage, userId: 'u1' });
  reading.load({ id: 'bank-03', meta: {} });
  assert.equal(await reading.review(), true);
  assert.deepEqual(calls, [{
    path: '/api/quiz/course/reading-solution',
    body: { bank_id: 'bank-03', answers: {}, duration_sec: 0 },
  }]);
  assert.match(reading.render(), /Mai đọc sách\./);
  assert.match(reading.render(), /Original saved passage\./);
  assert.match(reading.render(), /value="T" checked/);
  assert.equal(writes, 0, 'review hydration must not become a draft for a later assignment');
});

test('draft keys are isolated by learner and markdown escapes HTML first', () => {
  assert.notEqual(readingDraftKey('bank-03', 'u1'), readingDraftKey('bank-03', 'u2'));
  assert.notEqual(readingDraftKey('bank-03', 'u1', 'item-1'),
    readingDraftKey('bank-03', 'u1', 'item-2'));
  assert.notEqual(readingDraftKey('bank-03', 'u1', 'item-1', 1),
    readingDraftKey('bank-03', 'u1', 'item-1', 2));
  assert.equal(inlineMd('<img> **safe** *text*'),
    '&lt;img&gt; <strong>safe</strong> <em>text</em>');
});
