import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  findPersistedSpeakingResponse,
  speakingAudioFilename,
  SpeakingSubmissionController,
} from '../lib/speaking-submission-controller.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const readFrontend = (...parts) => readFileSync(path.join(FRONTEND, ...parts), 'utf8');
const BRIDGE = readFrontend(
  'app', '(authed-practice)', 'practice', 'session', 'practice-submission-bridge.tsx',
);
const BOOT = readFrontend(
  'app', '(authed-practice)', 'practice', 'session', 'practice-session-boot.tsx',
);
const PRACTICE = readFrontend('js', 'practice.js');

class FakeFormData {
  constructor() { this.entries = []; }
  append(...entry) { this.entries.push(entry); }
}

function controller(overrides = {}) {
  return new SpeakingSubmissionController({
    FormDataCtor: FakeFormData,
    upload: async () => ({ response_id: 'r-1', overall_band: 7 }),
    getSession: async () => ({ responses: [] }),
    ...overrides,
  });
}

describe('SpeakingSubmissionController', () => {
  test('sends the canonical multipart contract and URL-encodes session ids', async () => {
    let call;
    const c = controller({
      upload: async (url, body) => {
        call = { url, body };
        return { response_id: 'r-1' };
      },
    });
    const blob = { bytes: 12 };
    await c.submit({ sessionId: 'session / one', questionId: 'q-1', blob });
    assert.equal(call.url, '/sessions/session%20%2F%20one/responses');
    assert.deepEqual(call.body.entries, [
      ['question_id', 'q-1'],
      ['audio_file', blob, 'response.webm'],
    ]);
  });

  test('uses the recorder MIME for the filename so Safari MP4 is not mislabeled WebM', async () => {
    let uploaded;
    const c = controller({
      upload: async (_url, body) => {
        uploaded = body;
        return { response_id: 'r-1' };
      },
    });
    await c.submit({
      sessionId: 's',
      questionId: 'q',
      blob: { type: 'audio/mp4;codecs=mp4a.40.2' },
    });
    assert.equal(uploaded.entries[1][2], 'response.m4a');
    assert.equal(speakingAudioFilename({ type: 'audio/ogg;codecs=opus' }), 'response.ogg');
    assert.equal(speakingAudioFilename({ type: '' }), 'response.webm');
  });

  test('coalesces concurrent submits for one session/question', async () => {
    let release;
    let calls = 0;
    const c = controller({
      upload: () => {
        calls += 1;
        return new Promise((resolve) => { release = resolve; });
      },
    });
    const first = c.submit({ sessionId: 's', questionId: 'q', blob: {} });
    const second = c.submit({ sessionId: 's', questionId: 'q', blob: {} });
    assert.equal(first, second);
    assert.equal(calls, 1);
    release({ response_id: 'r' });
    await first;
  });

  test('preserves structured short-audio and persistence failures', async () => {
    const short = Object.assign(new Error('short'), {
      status: 422,
      detail: { code: 'audio_too_short', part: 1 },
    });
    await assert.rejects(
      controller({ upload: async () => { throw short; } }).submit({
        sessionId: 's', questionId: 'q', blob: {},
      }),
      (error) => error.code === 'audio_too_short' && error.detail.part === 1,
    );

    const persist = Object.assign(new Error('save'), {
      status: 500,
      detail: { error_code: 'response_persist_failed' },
    });
    await assert.rejects(
      controller({ upload: async () => { throw persist; } }).submit({
        sessionId: 's', questionId: 'q', blob: {},
      }),
      (error) => error.code === 'response_persist_failed',
    );
  });

  test('reconciles network/5xx and malformed success against canonical responses', async () => {
    for (const outcome of [new TypeError('Failed to fetch'), null]) {
      const c = controller({
        upload: async () => {
          if (outcome instanceof Error) throw outcome;
          return outcome;
        },
        getSession: async () => ({
          responses: [{ id: 'saved-r', question_id: 'q', feedback: '{}' }],
        }),
      });
      const result = await c.submit({ sessionId: 's', questionId: 'q', blob: {} });
      assert.equal(result.response_id, 'saved-r');
      assert.equal(result._reconciled, true);
      assert.equal(result._persisted_response.id, 'saved-r');
    }
  });

  test('absence or failed readback remains ambiguous, never becomes false success', async () => {
    const network = new TypeError('Failed to fetch');
    for (const getSession of [
      async () => ({ responses: [] }),
      async () => { throw new Error('read failed'); },
    ]) {
      await assert.rejects(
        controller({
          upload: async () => { throw network; },
          getSession,
        }).submit({ sessionId: 's', questionId: 'q', blob: {} }),
        (error) => error.code === 'ambiguous_commit',
      );
    }
  });

  test('does not mistake a pre-existing retake row for proof of a new commit', async () => {
    const network = new TypeError('Failed to fetch');
    await assert.rejects(
      controller({
        upload: async () => { throw network; },
        getSession: async () => ({
          responses: [{ id: 'old-row', question_id: 'q' }],
        }),
      }).submit({
        sessionId: 's', questionId: 'q', blob: {}, priorResponseId: 'old-row',
      }),
      (error) => error.code === 'ambiguous_commit',
    );
  });

  test('a concrete non-audio 4xx is rejected without an unnecessary readback', async () => {
    let reads = 0;
    const denied = Object.assign(new Error('denied'), { status: 403 });
    await assert.rejects(
      controller({
        upload: async () => { throw denied; },
        getSession: async () => { reads += 1; return { responses: [] }; },
      }).submit({ sessionId: 's', questionId: 'q', blob: {} }),
      (error) => error.code === 'submission_rejected',
    );
    assert.equal(reads, 0);
  });

  test('timeout, conflict and throttling statuses reconcile because commit may be ambiguous', async () => {
    for (const status of [408, 409, 425, 429]) {
      let reads = 0;
      const uncertain = Object.assign(new Error('uncertain'), { status });
      const result = await controller({
        upload: async () => { throw uncertain; },
        getSession: async () => {
          reads += 1;
          return { responses: [{ id: `r-${status}`, question_id: 'q' }] };
        },
      }).submit({ sessionId: 's', questionId: 'q', blob: {} });
      assert.equal(result.response_id, `r-${status}`);
      assert.equal(reads, 1);
    }
  });

  test('destroy blocks new work but deliberately does not abort a committing mutation', async () => {
    let release;
    const c = controller({
      upload: () => new Promise((resolve) => { release = resolve; }),
    });
    const pending = c.submit({ sessionId: 's', questionId: 'q', blob: {} });
    c.destroy();
    release({ response_id: 'r' });
    assert.equal((await pending).response_id, 'r');
    await assert.rejects(
      c.submit({ sessionId: 's', questionId: 'q2', blob: {} }),
      (error) => error.code === 'disposed',
    );
  });
});

test('findPersistedSpeakingResponse requires the exact question and a row id', () => {
  const session = { responses: [
    { id: '', question_id: 'q' },
    { id: 'other', question_id: 'q2' },
    { id: 'wanted', question_id: 'q' },
  ] };
  assert.equal(findPersistedSpeakingResponse(session, 'q').id, 'wanted');
  assert.equal(findPersistedSpeakingResponse(session, 'missing'), null);
});

test('findPersistedSpeakingResponse accepts a sealed-safe response receipt', () => {
  const session = {
    responses: [],
    response_receipts: [{ id: 'sealed-row', question_id: 'q' }],
  };
  assert.equal(findPersistedSpeakingResponse(session, 'q').id, 'sealed-row');
});

describe('Next Speaking submission integration', () => {
  test('bridge owns transport lifecycle and removes only its own global', () => {
    assert.match(BRIDGE, /new SpeakingSubmissionController/);
    assert.match(BRIDGE, /win\.api\.upload/);
    assert.match(BRIDGE, /win\.api\.get/);
    assert.match(BRIDGE, /win\.PracticeSubmission = submission/);
    assert.match(BRIDGE, /submission\.destroy\(\)/);
    assert.match(BRIDGE, /win\.PracticeSubmission === submission/);
    assert.match(BRIDGE, /delete win\.PracticeSubmission/);
  });

  test('boot requires native submission before starting the legacy orchestrator', () => {
    assert.match(BOOT, /PracticeSubmission\?\.submit/);
    assert.match(BOOT, /native submission/);
  });

  test('practice, test_full and sheet all use the shared transport', () => {
    assert.match(PRACTICE, /function _submitResponseTransport/);
    assert.match(PRACTICE, /data = await _submitResponseTransport\(_sessionId, questionId, blob, \{/);
    assert.match(PRACTICE, /: _submitResponseTransport\(sessionId, questionId, blob, submitOpts\)/);
    assert.match(PRACTICE, /nativeFullTest\.submitAnswer\(\{/);
    assert.match(PRACTICE, /submitOpts\.priorResponseId = _knownResponseId\(questionId\)/);
    assert.match(PRACTICE, /nativeSubmission\.submit\(\{/);
    assert.match(PRACTICE, /priorResponseId: s\.resp && \(s\.resp\.id \|\| s\.resp\.response_id\)/);
  });

  test('unconfirmed native mutations keep the recording and never enter feedback', () => {
    const start = PRACTICE.indexOf('async function _uploadAndGrade');
    const end = PRACTICE.indexOf('function _gradeMissingPersist', start);
    const body = PRACTICE.slice(start, end);
    assert.match(body, /err && err\.code === 'ambiguous_commit'/);
    assert.match(body, /_handlePersistFailure\(\{ message: retryMessage \}\)/);
    assert.match(body, /Bản ghi vẫn còn trên máy này/);
  });

  test('positive reconciliation rehydrates canonical feedback before rendering', () => {
    assert.match(PRACTICE, /data\._reconciled && data\._persisted_response/);
    assert.match(PRACTICE, /_respToFeedbackData\(data\._persisted_response\)/);
    assert.match(PRACTICE, /r\.grading_status === 'failed' \|\| fb\._failed/);
  });

  test('Part 2 keeps the take playable and explicitly offers retry or rerecord', () => {
    const page = readFrontend('pages', 'practice.html');
    assert.match(page, /id="p2a-submit-retry"/);
    assert.match(page, /PracticeApp\.retryP2Submission\(\)/);
    assert.match(page, /PracticeApp\.discardP2SubmissionRetry\(\)/);
    const start = PRACTICE.indexOf('function _handlePersistFailure');
    const end = PRACTICE.indexOf('function _showPartialNote', start);
    const body = PRACTICE.slice(start, end);
    assert.match(body, /_showP2SubmissionRetry\(msg\)/);
    assert.doesNotMatch(body, /part === 2[\s\S]{0,180}?_resetRecorder\(\)/);
    assert.match(
      PRACTICE,
      /_p2RetryPlaybackUrl = _createManagedObjectUrl\('p2-retry-playback', _recordedBlob\)/,
    );
  });
});
