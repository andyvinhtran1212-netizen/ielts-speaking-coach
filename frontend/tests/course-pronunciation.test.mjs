import assert from 'node:assert/strict';
import test from 'node:test';

import { createPronunciation } from '../public/js/course-pronunciation.js';


function browserShell() {
  globalThis.window = {
    indexedDB: null,
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    MediaRecorder: null,
  };
  globalThis.document = { getElementById: () => null };
}

const exercise = {
  id: 'set-1', bank_id: 'bank-05', title: 'Phát âm & Shadowing — Câu so sánh',
  playback_rates: [0.85, 1], sentences: [
    { id: 'S1', order: 1, text: 'The air is cleaner.', audio_url: 'https://audio/1.mp3' },
    { id: 'S2', order: 2, text: 'The metro is more reliable.', audio_url: 'https://audio/2.mp3' },
  ],
};


test('renders the cached sample, two speeds and a complete sentence queue', async () => {
  browserShell();
  const api = { get: async () => ({ exercise, latest_attempt: null }) };
  const pronunciation = createPronunciation({ api, userId: 'u1' });
  assert.equal(await pronunciation.load('bank-05'), true);
  const html = pronunciation.render();
  assert.match(html, /https:\/\/audio\/1\.mp3/);
  assert.match(html, /0\.85×/);
  assert.match(html, /1×/);
  assert.match(html, /0<small>\/2 đã thu/);
  assert.match(html, /Còn 2 câu/);
  assert.match(html, /disabled>Nộp để chấm phát âm/);
});


test('moves by sentence without reading the DOM as state', async () => {
  browserShell();
  const api = { get: async () => ({ exercise, latest_attempt: null }) };
  const pronunciation = createPronunciation({ api, userId: 'u1' });
  await pronunciation.load('bank-05');
  pronunciation.move(1);
  assert.match(pronunciation.render(), /The metro is more reliable\./);
  pronunciation.move(100);
  assert.match(pronunciation.render(), /Câu 2\/2/);
  pronunciation.move(-100);
  assert.match(pronunciation.render(), /Câu 1\/2/);
});


test('renders canonical persisted result and per-word focus', async () => {
  browserShell();
  const latest_attempt = {
    status: 'completed', batch_count: 1, pronunciation_score: 77.4,
    accuracy_score: 75.1, fluency_score: 79.2, completeness_score: 100,
    results: { sentences: [{
      id: 'S1', order: 1, text: 'The air is cleaner.', accuracy_score: 64,
      weak_words: [{ word: 'cleaner', accuracy_score: 58 }],
    }] },
  };
  const api = { get: async () => ({ exercise, latest_attempt }) };
  const pronunciation = createPronunciation({ api, userId: 'u1' });
  await pronunciation.load('bank-05');
  const html = pronunciation.render();
  assert.match(html, /Kết quả phát âm/);
  assert.match(html, /77<small>\/100/);
  assert.match(html, /cleaner <b>58<\/b>/);
  assert.doesNotMatch(html, /Azure|OpenAI/);
  assert.doesNotMatch(html, /provider_payloads/);
});


test('surfaces a persisted failed attempt while keeping the practice flow', async () => {
  browserShell();
  const api = { get: async () => ({ exercise, latest_attempt: {
    status: 'failed', error_message: 'Azure tạm thời chưa phản hồi.',
  } }) };
  const pronunciation = createPronunciation({ api, userId: 'u1' });
  await pronunciation.load('bank-05');
  const html = pronunciation.render();
  assert.match(html, /Azure tạm thời chưa phản hồi\./);
  assert.match(html, /Bắt đầu thu/);
});
