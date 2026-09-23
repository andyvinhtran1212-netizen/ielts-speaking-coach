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


test('a versioned sentence set removes V1 drafts once without deleting V2 drafts', async () => {
  browserShell();
  const versionedExercise = {
    ...exercise,
    bank_id: 'bank-06',
    sentences: Array.from({ length: 15 }, (_value, index) => ({
      id: `C1-B06-PRON-V2-${String(index + 1).padStart(2, '0')}`,
      order: index + 1,
      text: `Medium length pronunciation sentence number ${index + 1}.`,
      audio_url: `https://audio/${index + 1}.mp3`,
    })),
  };
  const oldBlob = new Blob(['old-v1'], { type: 'audio/webm' });
  const draftStore = memoryDraftStore([
    ['u1:bank-06:attempt:active', true],
    ['u1:bank-06:attempt:client-id', 'v1-client-id'],
    ['u1:bank-06:attempt:migration:C1-B06-PRON-V2', true],
    ['u1:bank-06:C1-B06-PRON-01', oldBlob],
    ['u1:bank-06:C1-B06-PRON-V1-01', oldBlob],
    ['u1:bank-06:C1-B06-PRON-12', oldBlob],
    ['u1:bank-06:C1-B06-PRON-V1-12', oldBlob],
  ]);
  const api = { get: async () => ({ exercise: versionedExercise, latest_attempt: null }) };

  const firstV2Page = createPronunciation({ api, userId: 'u1', draftStore });
  await firstV2Page.load('bank-06');
  assert.match(firstV2Page.render(), /0<small>\/15 đã thu/);
  assert.equal(draftStore.values.has('u1:bank-06:C1-B06-PRON-01'), false);
  assert.equal(draftStore.values.has('u1:bank-06:C1-B06-PRON-V1-01'), false);
  assert.equal(draftStore.values.has('u1:bank-06:C1-B06-PRON-12'), false);
  assert.equal(draftStore.values.has('u1:bank-06:C1-B06-PRON-V1-12'), false);
  assert.equal(draftStore.values.get('u1:bank-06:attempt:client-id'),
    '11111111-1111-4111-8111-111111111111');
  assert.equal(draftStore.values.get(
    'u1:bank-06:attempt:migration:C1-B06-PRON-V2:explicit-v1-cleanup'), true);

  const v2Key = 'u1:bank-06:C1-B06-PRON-V2-01';
  await draftStore.put(v2Key, new Blob(['new-v2'], { type: 'audio/webm' }));
  const reloadedV2Page = createPronunciation({ api, userId: 'u1', draftStore });
  await reloadedV2Page.load('bank-06');
  assert.match(reloadedV2Page.render(), /1<small>\/15 đã thu/);
  assert.equal(draftStore.values.has(v2Key), true);
});


test('V2 recordings keep their audio but not a processing V1 client id', async () => {
  browserShell();
  const versionedExercise = {
    ...exercise,
    bank_id: 'bank-12',
    sentences: exercise.sentences.map((sentence, index) => ({
      ...sentence, id: `C1-B12-PRON-V2-${String(index + 1).padStart(2, '0')}`,
    })),
  };
  const staleClientId = '22222222-2222-4222-8222-222222222222';
  const freshClientId = '11111111-1111-4111-8111-111111111111';
  const latest_attempt = {
    client_id: staleClientId,
    status: 'processing',
    results: { sentences: exercise.sentences.map((sentence, index) => ({
      ...sentence, id: `C1-B12-PRON-V1-${String(index + 1).padStart(2, '0')}`,
    })) },
  };
  const draftStore = memoryDraftStore([
    ['u1:bank-12:attempt:active', true],
    ['u1:bank-12:attempt:client-id', staleClientId],
    ['u1:bank-12:attempt:migration:C1-B12-PRON-V2:explicit-v1-cleanup', true],
    ...versionedExercise.sentences.map((sentence) => [
      `u1:bank-12:${sentence.id}`, new Blob([sentence.id], { type: 'audio/webm' }),
    ]),
  ]);
  let submittedClientId = null;
  const api = {
    get: async () => ({ exercise: versionedExercise, latest_attempt }),
    upload: async (_path, form) => {
      submittedClientId = form.get('client_id');
      return { status: 'completed', client_id: submittedClientId, results: { sentences: [] } };
    },
  };

  const firstV2Page = createPronunciation({ api, userId: 'u1', draftStore });
  await firstV2Page.load('bank-12');
  assert.match(firstV2Page.render(), /2<small>\/2 đã thu/);
  assert.equal(draftStore.values.get('u1:bank-12:attempt:client-id'), freshClientId);
  versionedExercise.sentences.forEach((sentence) => assert.equal(
    draftStore.values.has(`u1:bank-12:${sentence.id}`), true));
  assert.equal(await firstV2Page.submit(), true);
  assert.equal(submittedClientId, freshClientId);
  assert.notEqual(submittedClientId, staleClientId);
});


test('reload during a V2 upload preserves its client id while V1 is still latest', async () => {
  browserShell();
  const versionedExercise = {
    ...exercise,
    bank_id: 'bank-12',
    sentences: exercise.sentences.map((sentence, index) => ({
      ...sentence, id: `C1-B12-PRON-V2-${String(index + 1).padStart(2, '0')}`,
    })),
  };
  const v1ClientId = '22222222-2222-4222-8222-222222222222';
  const uploadingV2ClientId = '33333333-3333-4333-8333-333333333333';
  const draftStore = memoryDraftStore([
    ['u1:bank-12:attempt:active', true],
    ['u1:bank-12:attempt:client-id', uploadingV2ClientId],
    ['u1:bank-12:attempt:migration:C1-B12-PRON-V2:explicit-v1-cleanup', true],
    ...versionedExercise.sentences.map((sentence) => [
      `u1:bank-12:${sentence.id}`, new Blob([sentence.id], { type: 'audio/webm' }),
    ]),
  ]);
  let submittedClientId = null;
  const api = {
    get: async () => ({ exercise: versionedExercise, latest_attempt: {
      client_id: v1ClientId,
      status: 'processing',
      results: { sentences: exercise.sentences.map((sentence, index) => ({
        ...sentence, id: `C1-B12-PRON-V1-${String(index + 1).padStart(2, '0')}`,
      })) },
    } }),
    upload: async (_path, form) => {
      submittedClientId = form.get('client_id');
      return { status: 'completed', client_id: submittedClientId, results: { sentences: [] } };
    },
  };

  const reloadedPage = createPronunciation({ api, userId: 'u1', draftStore });
  await reloadedPage.load('bank-12');
  assert.equal(draftStore.values.get('u1:bank-12:attempt:client-id'), uploadingV2ClientId);
  assert.equal(await reloadedPage.submit(), true);
  assert.equal(submittedClientId, uploadingV2ClientId);
});


test('a V2 migration preserves client id when reconciling a completed V2 draft', async () => {
  browserShell();
  const clientId = 'completed-v2-client';
  const versionedExercise = {
    ...exercise,
    sentences: exercise.sentences.map((sentence, index) => ({
      ...sentence, id: `C1-B05-PRON-V2-${String(index + 1).padStart(2, '0')}`,
    })),
  };
  const firstId = versionedExercise.sentences[0].id;
  const draftStore = memoryDraftStore([
    ['u1:bank-05:attempt:active', true],
    ['u1:bank-05:attempt:client-id', clientId],
    [`u1:bank-05:${firstId}`, new Blob(['uploaded-v2'], { type: 'audio/webm' })],
  ]);
  const api = { get: async () => ({ exercise: versionedExercise, latest_attempt: {
    client_id: clientId, status: 'completed', pronunciation_score: 88,
    results: { sentences: versionedExercise.sentences },
  } }) };

  const pronunciation = createPronunciation({ api, userId: 'u1', draftStore });
  await pronunciation.load('bank-05');
  assert.match(pronunciation.render(), /Kết quả phát âm/);
  assert.equal(draftStore.values.has(`u1:bank-05:${firstId}`), false);
  assert.equal(draftStore.values.has('u1:bank-05:attempt:active'), false);
  assert.equal(draftStore.values.has('u1:bank-05:attempt:client-id'), false);
});


test('completed V2 reconciliation wins when V1 and V2 recordings coexist', async () => {
  browserShell();
  const clientId = 'completed-mixed-client';
  const versionedExercise = {
    ...exercise,
    sentences: exercise.sentences.map((sentence, index) => ({
      ...sentence, id: `C1-B05-PRON-V2-${String(index + 1).padStart(2, '0')}`,
    })),
  };
  const currentKeys = versionedExercise.sentences.map((sentence) =>
    `u1:bank-05:${sentence.id}`);
  const draftStore = memoryDraftStore([
    ['u1:bank-05:attempt:active', true],
    ['u1:bank-05:attempt:client-id', clientId],
    ['u1:bank-05:C1-B05-PRON-01', new Blob(['stale-v1'], { type: 'audio/webm' })],
    ...currentKeys.map((key, index) => [
      key, new Blob([`uploaded-v2-${index}`], { type: 'audio/webm' }),
    ]),
  ]);
  const api = { get: async () => ({ exercise: versionedExercise, latest_attempt: {
    client_id: clientId, status: 'completed', pronunciation_score: 91,
    results: { sentences: versionedExercise.sentences },
  } }) };

  const pronunciation = createPronunciation({ api, userId: 'u1', draftStore });
  await pronunciation.load('bank-05');
  assert.match(pronunciation.render(), /Kết quả phát âm/);
  assert.equal(draftStore.values.has('u1:bank-05:C1-B05-PRON-01'), false);
  currentKeys.forEach((key) => assert.equal(draftStore.values.has(key), false));
  assert.equal(draftStore.values.has('u1:bank-05:attempt:active'), false);
  assert.equal(draftStore.values.has('u1:bank-05:attempt:client-id'), false);
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
