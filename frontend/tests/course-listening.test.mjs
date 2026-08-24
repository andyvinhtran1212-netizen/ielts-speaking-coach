import assert from 'node:assert/strict';
import test from 'node:test';

import { createListening, listeningDraftKey } from '../public/js/course-listening.js';

const bank = { id: 'bank-05', meta: { short_listening: {
  title: 'Thành phố và nông thôn', focus: 'so sánh',
  sections: [
    { id: 'sound', label: 'A', title: 'Nhận diện âm', mode: 'question_audio', questions: [
      { id: 'l-A1', number: 1, audio_url: 'https://signed/A1.mp3', options: ['city', 'pity'] },
    ] },
    { id: 'content', label: 'D', title: 'Nghe hiểu', mode: 'section_audio',
      audio_url: 'https://signed/D.mp3', questions: [
        { id: 'l-D1', number: 1, prompt: 'The city is bigger.', options: ['T', 'F', 'NG'] },
      ] },
  ],
} } };

function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value) };
}

test('renders question and section audio without exposing a solution', () => {
  const listening = createListening({ api: {}, storage: storage(), userId: 'u1' });
  assert.equal(listening.load(bank), true);
  const html = listening.render();
  assert.match(html, /https:\/\/signed\/A1\.mp3/);
  assert.match(html, /https:\/\/signed\/D\.mp3/);
  assert.match(html, /<strong>2<small>câu nghe/);
  assert.match(html, /disabled>Nộp phần nghe/);
  assert.doesNotMatch(html, /Nghe được:/);
});

test('requests answer and transcript only after every response exists', async () => {
  let calls = 0;
  const api = { post: async (path, body) => {
    calls += 1;
    assert.equal(path, '/api/quiz/course/listening-solution');
    assert.deepEqual(body.answers, { 'l-A1': 'A', 'l-D1': 'T' });
    assert.equal(typeof body.duration_sec, 'number');
    return { answers: [{ id: 'l-A1', answer: 'A', transcript: 'city' },
      { id: 'l-D1', answer: 'T' }], talk_transcript: 'The city is bigger.',
      talk_translation: 'Thành phố lớn hơn.' };
  } };
  const listening = createListening({ api, storage: storage(), userId: 'u1' });
  listening.load(bank);
  assert.equal(await listening.reveal(), false);
  listening.write('l-A1', 'A'); listening.write('l-D1', 'T');
  assert.equal(await listening.reveal(), true);
  assert.equal(calls, 1);
  assert.match(listening.render(), /Nghe được: “city”/);
  assert.match(listening.render(), /Thành phố lớn hơn\./);
});

test('refreshes signed audio when the learner opens the listening flow', async () => {
  const calls = [];
  const api = { post: async (path, body) => {
    calls.push({ path, body });
    return { ...bank.meta.short_listening, sections: [{
      ...bank.meta.short_listening.sections[0], questions: [{
        ...bank.meta.short_listening.sections[0].questions[0],
        audio_url: 'https://signed/fresh-A1.mp3',
      }],
    }] };
  } };
  const listening = createListening({ api, storage: storage(), userId: 'u1' });
  listening.load(bank);
  assert.equal(await listening.refreshAudio(), true);
  assert.deepEqual(calls, [{
    path: '/api/quiz/course/listening-audio', body: { bank_id: 'bank-05' },
  }]);
  assert.match(listening.render(), /fresh-A1\.mp3/);
  assert.doesNotMatch(listening.render(), /Nghe được:/);
});

test('completed listening can hydrate canonical answers and transcript after reload', async () => {
  const api = { post: async (path, body) => {
    assert.equal(path, '/api/quiz/course/listening-solution');
    assert.deepEqual(body, { bank_id: 'bank-05', answers: {}, duration_sec: 0 });
    return {
      answers: [{ id: 'l-A1', answer: 'A', transcript: 'city' },
        { id: 'l-D1', answer: 'T' }],
      talk_transcript: 'The city is bigger.', talk_translation: 'Thành phố lớn hơn.',
      result: { submitted_answers: { 'l-A1': 'A', 'l-D1': 'T' } },
    };
  } };
  const listening = createListening({ api, storage: storage(), userId: 'u1' });
  listening.load(bank);
  assert.equal(await listening.review(), true);
  assert.match(listening.render(), /Nghe được: “city”/);
  assert.match(listening.render(), /value="A" checked/);
  assert.match(listening.render(), /Thành phố lớn hơn\./);
});

test('review audio is authorized against the exact submitted assignment item', async () => {
  const calls = [];
  const api = { post: async (path, body) => {
    calls.push({ path, body });
    return bank.meta.short_listening;
  } };
  const listening = createListening({
    api, storage: storage(), userId: 'u1', assignmentItemId: 'item-old',
  });
  listening.load(bank);
  assert.equal(await listening.refreshAudio(), true);
  assert.deepEqual(calls, [{
    path: '/api/quiz/course/listening-audio',
    body: { bank_id: 'bank-05', class_item: 'item-old' },
  }]);
});

test('draft keys are isolated by learner', () => {
  assert.notEqual(listeningDraftKey('bank-05', 'u1'), listeningDraftKey('bank-05', 'u2'));
});
