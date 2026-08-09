import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SpeakingFullTestController } from '../public/js/speaking-full-test-controller.mjs';
import { SpeakingSubmissionController } from '../public/js/speaking-submission-controller.mjs';
import { mountLegacySpeakingRuntime } from '../public/js/speaking-legacy-runtime.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PAGE = readFileSync(path.join(FRONTEND, 'public/pages/practice.html'), 'utf8');
const NEXT_FULL_TEST = readFileSync(path.join(
  FRONTEND,
  'app/(authed-practice)/practice/session/practice-full-test-bridge.tsx',
), 'utf8');
const NEXT_SUBMISSION = readFileSync(path.join(
  FRONTEND,
  'app/(authed-practice)/practice/session/practice-submission-bridge.tsx',
), 'utf8');

class MemoryStorage {
  constructor() { this.entries = new Map(); }
  getItem(key) { return this.entries.get(key) ?? null; }
  setItem(key, value) { this.entries.set(key, String(value)); }
  removeItem(key) { this.entries.delete(key); }
}

function fakeWindow() {
  const listeners = new Map();
  const storage = new MemoryStorage();
  return {
    api: {
      upload: async () => ({ response_id: 'r1' }),
      get: async () => ({ responses: [] }),
      post: async (path, body) => ({
        accepted: path === '/sessions/finalize-full-test',
        session_ids: [body.p1_id, body.p2_id, body.p3_id],
      }),
    },
    sessionStorage: storage,
    setTimeout,
    clearTimeout,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    listeners,
  };
}

describe('Legacy Speaking canonical runtime', () => {
  test('mounts the public controllers once and removes only its own globals', () => {
    const win = fakeWindow();
    const runtime = mountLegacySpeakingRuntime(win);
    assert.ok(runtime.submission instanceof SpeakingSubmissionController);
    assert.ok(runtime.fullTest instanceof SpeakingFullTestController);
    assert.equal(win.PracticeSubmission, runtime.submission);
    assert.equal(win.PracticeFullTest, runtime.fullTest);
    assert.equal(mountLegacySpeakingRuntime(win), runtime);
    assert.equal(typeof win.listeners.get('beforeunload'), 'function');

    runtime.destroy();
    assert.equal(win.PracticeSubmission, undefined);
    assert.equal(win.PracticeFullTest, undefined);
    assert.equal(win.PracticeLegacyRuntime, undefined);
    assert.equal(win.listeners.has('beforeunload'), false);
  });

  test('still mounts the Legacy startup runtime when sessionStorage access throws', () => {
    const win = fakeWindow();
    Object.defineProperty(win, 'sessionStorage', {
      configurable: true,
      get() {
        const error = new Error('Access to storage is denied');
        error.name = 'SecurityError';
        throw error;
      },
    });

    const runtime = mountLegacySpeakingRuntime(win);

    assert.equal(win.PracticeLegacyRuntime, runtime);
    assert.equal(typeof win.PracticeSubmission.submit, 'function');
    assert.equal(typeof win.PracticeFullTest.restore, 'function');
    assert.doesNotThrow(() => runtime.fullTest.restore({
      ownerId: 'user-a',
      currentSessionId: 'p1',
      responses: [],
    }));
  });

  test('writes owner-scoped resume truth and guards unload while a blob is pending', async () => {
    const win = fakeWindow();
    let resolveUpload;
    win.api.upload = () => new Promise((resolve) => { resolveUpload = resolve; });
    const runtime = mountLegacySpeakingRuntime(win);
    runtime.fullTest.restore({ ownerId: 'user-a', currentSessionId: 'p1', responses: [] });
    const pending = runtime.fullTest.submitAnswer({
      sessionId: 'p1',
      questionId: 'q1',
      blob: new Blob(['audio'], { type: 'audio/webm' }),
    });
    await Promise.resolve();

    let prevented = false;
    const event = { preventDefault() { prevented = true; }, returnValue: undefined };
    win.listeners.get('beforeunload')(event);
    assert.equal(prevented, true);
    assert.equal(event.returnValue, '');

    resolveUpload({ response_id: 'r1' });
    await pending;
    const state = JSON.parse(win.sessionStorage.getItem('ielts_ft_state_v2'));
    assert.equal(state.owner_id, 'user-a');
    assert.deepEqual(state.confirmed.p1, ['q1']);
  });

  test('both page stacks import the same public controller sources and Legacy fails visibly if absent', () => {
    assert.match(NEXT_SUBMISSION, /public\/js\/speaking-submission-controller\.mjs/);
    assert.match(NEXT_FULL_TEST, /public\/js\/speaking-full-test-controller\.mjs/);
    assert.match(PAGE, /type="module" src="\.\.\/js\/speaking-legacy-runtime\.mjs"/);
    assert.match(PAGE, /practice legacy persistence runtime unavailable/);
    assert.match(PAGE, /PracticeLegacyRuntime/);
  });
});
