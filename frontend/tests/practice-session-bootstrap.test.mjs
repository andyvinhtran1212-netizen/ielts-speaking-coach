import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createPracticeBootstrapOnce,
  isNextPracticeBootstrap,
  loadPracticeBootstrap,
  PracticeBootstrapError,
  readPracticeSessionId,
} from '../lib/practice-session-bootstrap.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const readFrontend = (...parts) => readFileSync(path.join(FRONTEND, ...parts), 'utf8');
const LEGACY_RUNTIME = readFrontend('public', 'js', 'practice.js');
const NEXT_BOOT = readFrontend(
  'app', '(authed-practice)', 'practice', 'session', 'practice-session-boot.tsx',
);

function fakeApi({ session = { id: 's1', mode: 'practice' }, questions = [{ id: 'q1' }], generated } = {}) {
  const calls = [];
  return {
    calls,
    async get(url) {
      calls.push(['get', url]);
      return url.endsWith('/questions') ? questions : session;
    },
    async post(url, body) {
      calls.push(['post', url, body]);
      return generated;
    },
  };
}

describe('native Speaking session bootstrap contract', () => {
  test('shares one in-flight bootstrap across duplicate callers', async () => {
    let calls = 0;
    const once = createPracticeBootstrapOnce(async () => {
      calls += 1;
      await Promise.resolve();
      return { ok: true };
    });
    const first = once();
    const second = once();
    assert.equal(first, second);
    assert.deepEqual(await first, { ok: true });
    assert.equal(calls, 1);
  });

  test('reads one trimmed session id and rejects a missing value', () => {
    assert.equal(readPracticeSessionId('?session_id=%20abc-123%20'), 'abc-123');
    assert.equal(readPracticeSessionId('?other=x'), null);
    assert.equal(readPracticeSessionId('?session_id=%20%20'), null);
  });

  test('loads canonical session and questions without generating', async () => {
    const api = fakeApi();
    const phases = [];
    const result = await loadPracticeBootstrap({
      api,
      sessionId: 'session/unsafe',
      userId: 'user-1',
      onPhase: (message) => phases.push(message),
    });

    assert.deepEqual(api.calls, [
      ['get', '/sessions/session%2Funsafe'],
      ['get', '/sessions/session%2Funsafe/questions'],
    ]);
    assert.equal(result.sessionId, 'session/unsafe');
    assert.equal(result.userId, 'user-1');
    assert.equal(result.source, 'next-native-bootstrap-v1');
    assert.ok(Object.isFrozen(result));
    assert.deepEqual(phases, ['Đang tải session...', 'Đang tải câu hỏi...']);
    assert.equal(isNextPracticeBootstrap(result), true);
  });

  test('generates once only when the canonical question list is empty', async () => {
    const api = fakeApi({ questions: [], generated: [{ id: 'generated-q' }] });
    const phases = [];
    const result = await loadPracticeBootstrap({
      api,
      sessionId: 's1',
      userId: null,
      onPhase: (message) => phases.push(message),
    });

    assert.equal(api.calls.filter(([method]) => method === 'post').length, 1);
    assert.deepEqual(result.questions, [{ id: 'generated-q' }]);
    assert.equal(phases.at(-1), 'Đang tạo câu hỏi với AI...');
  });

  test('fails closed on malformed session and question payloads', async () => {
    await assert.rejects(
      loadPracticeBootstrap({ api: fakeApi({ session: null }), sessionId: 's1' }),
      (error) => error instanceof PracticeBootstrapError && error.code === 'invalid_session',
    );
    await assert.rejects(
      loadPracticeBootstrap({ api: fakeApi({ questions: { id: 'not-an-array' } }), sessionId: 's1' }),
      (error) => error instanceof PracticeBootstrapError && error.code === 'invalid_questions',
    );
  });

  test('fails visibly when generation still returns no questions', async () => {
    await assert.rejects(
      loadPracticeBootstrap({ api: fakeApi({ questions: [], generated: [] }), sessionId: 's1' }),
      (error) => error instanceof PracticeBootstrapError && error.code === 'no_questions',
    );
  });

  test('Next owns auth and data loading while legacy pages retain their bootstrap', () => {
    assert.match(NEXT_BOOT, /const \{ status, user \} = useAuth\(\)/);
    assert.match(NEXT_BOOT, /loadPracticeBootstrap\(/);
    assert.match(NEXT_BOOT, /PracticeApp\.init\(bootstrap\)/);
    assert.match(NEXT_BOOT, /createPracticeBootstrapOnce/);
    assert.match(NEXT_BOOT, /ownerUserId\.current !== user\.id/);
    assert.match(NEXT_BOOT, /window\.location\.reload\(\)/);
    assert.match(LEGACY_RUNTIME, /async function init\(bootstrap\)/);
    assert.match(LEGACY_RUNTIME, /if \(hasNextBootstrap\)/);
    assert.match(LEGACY_RUNTIME, /sb\.auth\.getSession\(\)/);
    assert.match(LEGACY_RUNTIME, /_sessionData = bootstrap\.sessionData/);
    assert.match(LEGACY_RUNTIME, /questions = bootstrap\.questions\.slice\(\)/);
  });
});
