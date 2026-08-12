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
  assert.match(html, /disabled>Đối chiếu bài đọc/);
  assert.match(html, /id="cr-back"/);
  assert.match(html, /cr-question__prompt/);
});

test('solution is requested only after every reading answer exists', async () => {
  let calls = 0;
  const api = { post: async (_path, body) => {
    calls += 1;
    assert.deepEqual(body.answers, { 'r-01': 'T', 'r-02': 'a' });
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
  assert.equal(await reading.reveal(), true);
  assert.equal(calls, 1);
  assert.match(reading.render(), /Mai đọc sách\./);
  assert.match(reading.render(), /Đáp án · T/);
});

test('draft keys are isolated by learner and markdown escapes HTML first', () => {
  assert.notEqual(readingDraftKey('bank-03', 'u1'), readingDraftKey('bank-03', 'u2'));
  assert.equal(inlineMd('<img> **safe** *text*'),
    '&lt;img&gt; <strong>safe</strong> <em>text</em>');
});
