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
  assert.match(reading.render(), /Đáp án · T/);
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
  assert.equal(inlineMd('<img> **safe** *text*'),
    '&lt;img&gt; <strong>safe</strong> <em>text</em>');
});
