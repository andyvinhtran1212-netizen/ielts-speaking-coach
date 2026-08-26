import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createPronunciation } from '../public/js/course-pronunciation.js';

const behaviorSource = readFileSync(new URL(
  '../app/(authed)/course-exercises/course-behavior.tsx', import.meta.url,
), 'utf8');


function browserShell() {
  globalThis.window = {
    indexedDB: null,
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    MediaRecorder: null,
  };
  globalThis.document = { getElementById: () => null };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true, writable: true, value: { mediaDevices: null },
  });
  globalThis.MediaRecorder = null;
}


function memoryDraftStore(initial = []) {
  const values = new Map(initial);
  return {
    values,
    async get(key) { return values.has(key) ? values.get(key) : null; },
    async put(key, value) { values.set(key, value); },
    async delete(keys) { keys.forEach((key) => values.delete(key)); },
  };
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


test('state lookup stays pinned to the assigned course item', async () => {
  browserShell();
  let requested = '';
  const api = { get: async (path) => {
    requested = path;
    return { exercise, latest_attempt: null };
  } };
  const pronunciation = createPronunciation({
    api, userId: 'u1', assignmentItemId: 'item-current',
  });
  await pronunciation.load('bank-05');
  assert.equal(requested,
    '/api/quiz/course/pronunciation?bank_id=bank-05&class_item=item-current');
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


test('uses the actual sentence count on the retry action', async () => {
  browserShell();
  const sixteenSentenceExercise = {
    ...exercise,
    sentences: Array.from({ length: 16 }, (_value, index) => ({
      id: `S${index + 1}`, order: index + 1,
      text: `Sentence number ${index + 1}.`, audio_url: `https://audio/${index + 1}.mp3`,
    })),
  };
  const latest_attempt = {
    status: 'completed', pronunciation_score: 88, results: { sentences: [] },
  };
  const api = { get: async () => ({ exercise: sixteenSentenceExercise, latest_attempt }) };
  const pronunciation = createPronunciation({ api, userId: 'u1' });
  await pronunciation.load('bank-07');
  assert.match(pronunciation.render(), /Luyện lại 16 câu/);
  assert.doesNotMatch(pronunciation.render(), /Luyện lại 12 câu/);
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


test('a local retry wins over an older result and reuses its client id after reload', async () => {
  browserShell();
  const draftStore = memoryDraftStore();
  const oldResult = {
    client_id: 'older-server-attempt', status: 'completed', batch_count: 1,
    pronunciation_score: 80, results: { sentences: [] },
  };
  let submittedClientId = null;
  const api = {
    get: async () => ({ exercise, latest_attempt: oldResult }),
    upload: async (_path, form) => {
      submittedClientId = form.get('client_id');
      return { ...oldResult, client_id: submittedClientId };
    },
  };

  const firstPage = createPronunciation({ api, userId: 'u1', draftStore });
  await firstPage.load('bank-05');
  await firstPage.newAttempt();
  await draftStore.put('u1:bank-05:S1', new Blob(['one'], { type: 'audio/webm' }));
  await draftStore.put('u1:bank-05:S2', new Blob(['two'], { type: 'audio/webm' }));

  const reloadedPage = createPronunciation({ api, userId: 'u1', draftStore });
  await reloadedPage.load('bank-05');
  assert.doesNotMatch(reloadedPage.render(), /Kết quả phát âm/);
  assert.match(reloadedPage.render(), /2<small>\/2 đã thu/);
  assert.equal(await reloadedPage.submit(), true);
  assert.equal(submittedClientId, '11111111-1111-4111-8111-111111111111');
  assert.equal(draftStore.values.has('u1:bank-05:attempt:active'), false);
  assert.equal(draftStore.values.has('u1:bank-05:attempt:client-id'), false);
});


test('a completed result with the same cached client id clears the uploaded draft', async () => {
  browserShell();
  const clientId = '11111111-1111-4111-8111-111111111111';
  const draftStore = memoryDraftStore([
    ['u1:bank-05:attempt:active', true],
    ['u1:bank-05:attempt:client-id', clientId],
    ['u1:bank-05:S1', new Blob(['uploaded'], { type: 'audio/webm' })],
  ]);
  const api = { get: async () => ({ exercise, latest_attempt: {
    client_id: clientId, status: 'completed', pronunciation_score: 88,
    results: { sentences: [] },
  } }) };
  const pronunciation = createPronunciation({ api, userId: 'u1', draftStore });
  await pronunciation.load('bank-05');
  assert.match(pronunciation.render(), /Kết quả phát âm/);
  assert.equal(draftStore.values.has('u1:bank-05:S1'), false);
  assert.equal(draftStore.values.has('u1:bank-05:attempt:active'), false);
});


test('leaving while microphone permission is pending stops the late stream', async () => {
  browserShell();
  let allowMicrophone;
  let recorderConstructions = 0;
  let stoppedTracks = 0;
  const pendingPermission = new Promise((resolve) => { allowMicrophone = resolve; });
  navigator.mediaDevices = { getUserMedia: () => pendingPermission };
  class FakeMediaRecorder {
    static isTypeSupported() { return true; }
    constructor() { recorderConstructions += 1; }
  }
  window.MediaRecorder = FakeMediaRecorder;
  globalThis.MediaRecorder = FakeMediaRecorder;
  const pronunciation = createPronunciation({
    api: { get: async () => ({ exercise, latest_attempt: null }) },
    userId: 'u1', draftStore: memoryDraftStore(),
  });
  await pronunciation.load('bank-05');

  const starting = pronunciation.toggleRecording();
  await Promise.resolve();
  await pronunciation.stopRecording();
  allowMicrophone({ getTracks: () => [{ stop: () => { stoppedTracks += 1; } }] });

  assert.equal(await starting, false);
  assert.equal(stoppedTracks, 1);
  assert.equal(recorderConstructions, 0);
  assert.equal(pronunciation.isRecording, false);
});


test('late pronunciation handlers cannot reopen the screen after close', () => {
  assert.match(behaviorSource,
    /function renderPronunciation\(\) \{\s*if \(!pronunciationVisible\) return;/);
  assert.match(behaviorSource,
    /async function closePronunciation\(\) \{[\s\S]*?pronunciationVisible = false;[\s\S]*?await pronunciation\.stopRecording\(\);/);
});
