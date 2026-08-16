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
const PARITY_PAIRS = JSON.parse(readFrontend('tooling', 'parity-pairs-authed.json'));
const NEXT_BOOT = readFrontend(
  'app', '(authed-practice)', 'practice', 'session', 'practice-session-boot.tsx',
);

function fakeApi({
  session = { id: 's1', mode: 'practice' },
  questions = [{ id: 'q1' }],
  generated,
  failAt,
  error,
} = {}) {
  const calls = [];
  async function runGet(url, opts) {
    calls.push(['get', url, opts]);
    const stage = url.endsWith('/questions') ? 'questions' : 'session';
    if (failAt === stage) throw error;
    return stage === 'questions' ? questions : session;
  }
  async function runPost(url, body, opts) {
    calls.push(['post', url, body, opts]);
    if (failAt === 'generation') throw error;
    return generated;
  }
  return {
    calls,
    get: (url) => runGet(url),
    post: (url, body) => runPost(url, body),
    getWith: (url, _headers, opts) => runGet(url, opts),
    postWith: (url, body, _headers, opts) => runPost(url, body, opts),
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

    assert.deepEqual(api.calls.map(([method, url]) => [method, url]), [
      ['get', '/sessions/session%2Funsafe'],
      ['get', '/sessions/session%2Funsafe/questions'],
    ]);
    assert.ok(api.calls.every((call) => call.at(-1)?.noRedirect === true));
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
    assert.ok(api.calls.every((call) => call.at(-1)?.noRedirect === true));
    assert.deepEqual(result.questions, [{ id: 'generated-q' }]);
    assert.equal(phases.at(-1), 'Đang tạo câu hỏi với AI...');
  });

  test('fails closed on malformed session and question payloads', async () => {
    await assert.rejects(
      loadPracticeBootstrap({ api: fakeApi({ session: [] }), sessionId: 's1' }),
      (error) => error instanceof PracticeBootstrapError && error.code === 'invalid_session',
    );
    await assert.rejects(
      loadPracticeBootstrap({ api: fakeApi({ questions: { id: 'not-an-array' } }), sessionId: 's1' }),
      (error) => error instanceof PracticeBootstrapError && error.code === 'invalid_questions',
    );
  });

  test('uses explicit 401 status and preserves auth correlation at every request stage', async () => {
    for (const [stage, expectedPosts] of [
      ['session', 0],
      ['questions', 0],
      ['generation', 1],
    ]) {
      const unauthorized = new Error('expired token');
      unauthorized.status = 401;
      unauthorized.request_id = 'request-' + stage;
      unauthorized.ref = 'ref-' + stage;
      const api = fakeApi({ questions: [], failAt: stage, error: unauthorized });
      await assert.rejects(
        loadPracticeBootstrap({ api, sessionId: 's1' }),
        (caught) => caught instanceof PracticeBootstrapError
          && caught.code === 'auth_required'
          && caught.status === 401
          && caught.request_id === unauthorized.request_id
          && caught.ref === unauthorized.ref
          && caught.cause === unauthorized,
      );
      assert.equal(api.calls.filter(([method]) => method === 'post').length, expectedPosts);
    }
  });

  test('does not misclassify empty 2xx payloads as authentication failures', async () => {
    await assert.rejects(
      loadPracticeBootstrap({ api: fakeApi({ session: null }), sessionId: 's1' }),
      (error) => error.code === 'invalid_session',
    );

    const questionsApi = fakeApi({ questions: null, generated: [{ id: 'generated-q' }] });
    const result = await loadPracticeBootstrap({ api: questionsApi, sessionId: 's1' });
    assert.deepEqual(result.questions, [{ id: 'generated-q' }]);
    assert.equal(questionsApi.calls.filter(([method]) => method === 'post').length, 1);

    await assert.rejects(
      loadPracticeBootstrap({
        api: fakeApi({ questions: [], generated: null }),
        sessionId: 's1',
      }),
      (error) => error.code === 'no_questions',
    );
  });

  test('preserves actionable 4xx detail but hides 5xx internals', async () => {
    const forbidden = new Error('Session không thuộc tài khoản hiện tại.');
    forbidden.status = 403;
    await assert.rejects(
      loadPracticeBootstrap({ api: fakeApi({ failAt: 'session', error: forbidden }), sessionId: 's1' }),
      (error) => error.code === 'session_load_failed'
        && error.status === 403
        && error.message === forbidden.message
        && error.cause === forbidden,
    );

    const internal = new Error('postgres connection string leaked here');
    internal.status = 500;
    internal.request_id = 'request-internal';
    internal.ref = 'ref-internal';
    await assert.rejects(
      loadPracticeBootstrap({ api: fakeApi({ failAt: 'session', error: internal }), sessionId: 's1' }),
      (error) => error.code === 'session_load_failed'
        && error.status === 500
        && !error.message.includes('postgres')
        && error.request_id === internal.request_id
        && error.ref === internal.ref
        && error.cause === internal,
    );
  });

  test('executes equivalent producer and player bootstrap validators', () => {
    const start = LEGACY_RUNTIME.indexOf('function _isNextPracticeBootstrap(bootstrap)');
    const end = LEGACY_RUNTIME.indexOf('\n  async function init(bootstrap)', start);
    assert.ok(start !== -1 && end > start, 'player validator source not found');
    const declaration = LEGACY_RUNTIME.slice(start, end).trim();
    const playerValidator = Function(`${declaration}; return _isNextPracticeBootstrap;`)();

    const valid = Object.freeze({
      source: 'next-native-bootstrap-v1',
      sessionId: 's1',
      userId: 'u1',
      sessionData: { id: 's1' },
      questions: [{ id: 'q1' }],
    });
    const variants = [
      valid,
      null,
      { ...valid, source: 'wrong' },
      { ...valid, sessionId: '' },
      { ...valid, sessionData: null },
      { ...valid, sessionData: undefined },
      { source: valid.source, sessionId: valid.sessionId, questions: valid.questions },
      { ...valid, sessionData: 0 },
      { ...valid, sessionData: [] },
      { ...valid, questions: [] },
      { ...valid, questions: {} },
    ];
    for (const value of variants) {
      assert.equal(playerValidator(value), isNextPracticeBootstrap(value));
    }
  });

  test('fails visibly when generation still returns no questions', async () => {
    await assert.rejects(
      loadPracticeBootstrap({ api: fakeApi({ questions: [], generated: [] }), sessionId: 's1' }),
      (error) => error instanceof PracticeBootstrapError && error.code === 'no_questions',
    );
  });

  test('fails closed when Full Test response receipts could not be read', async () => {
    const api = fakeApi({
      session: { id: 's1', mode: 'test_full', response_lookup_failed: true },
    });
    await assert.rejects(
      loadPracticeBootstrap({ api, sessionId: 's1' }),
      (error) => error instanceof PracticeBootstrapError
        && error.code === 'response_lookup_failed',
    );
    assert.deepEqual(api.calls, [['get', '/sessions/s1', { noRedirect: true }]]);
  });

  test('Next owns auth and data loading while legacy pages retain their bootstrap', () => {
    assert.match(NEXT_BOOT, /const \{ status, user \} = useAuth\(\)/);
    assert.match(NEXT_BOOT, /loadPracticeBootstrap\(/);
    assert.match(NEXT_BOOT, /PracticeApp\.init\(bootstrap\)/);
    assert.match(NEXT_BOOT, /createPracticeBootstrapOnce/);
    assert.match(NEXT_BOOT, /ownerUserId\.current !== user\.id/);
    assert.match(NEXT_BOOT, /window\.location\.reload\(\)/);
    assert.match(NEXT_BOOT, /error\.code === 'auth_required'/);
    assert.match(NEXT_BOOT, /window\.location\.replace\('\/login'\)/);
    assert.match(NEXT_BOOT, /request_id: \(error as any\)\?\.request_id/);
    assert.match(NEXT_BOOT, /type: 'practice_native_bootstrap_failed',[\s\S]*?\n\s+code,/);
    assert.match(LEGACY_RUNTIME, /async function init\(bootstrap\)/);
    assert.match(LEGACY_RUNTIME, /throw handoffError/);
    assert.match(LEGACY_RUNTIME, /if \(hasNextBootstrap\)/);
    assert.match(LEGACY_RUNTIME, /sb\.auth\.getSession\(\)/);
    assert.match(LEGACY_RUNTIME, /_sessionData = bootstrap\.sessionData/);
    assert.match(LEGACY_RUNTIME, /questions = bootstrap\.questions\.slice\(\)/);
  });

  test('valid player init preloads Grammar metadata; only missing-session parity skips it', () => {
    const initStart = LEGACY_RUNTIME.indexOf('async function init(bootstrap)');
    const initEnd = LEGACY_RUNTIME.indexOf('// ── PDF Export', initStart);
    const body = LEGACY_RUNTIME.slice(initStart, initEnd);
    const grammarAt = body.indexOf('_fetchGrArticleIndex()');
    const handoffAt = body.indexOf('var hasNextBootstrap = _isNextPracticeBootstrap(bootstrap)');
    assert.ok(grammarAt !== -1 && handoffAt !== -1 && grammarAt < handoffAt,
      'every valid PracticeApp.init call must schedule Grammar metadata before handoff');

    const pair = PARITY_PAIRS.find((candidate) => candidate.name === 'speaking-practice-dark');
    assert.deepEqual(pair.allow, [{
      kind: 'api-missing',
      value: 'GET /api/grammar/categories',
      reason: 'Cặp này cố ý không có session_id. Next fail trước PracticeApp.init nên không tải metadata Grammar vô ích; với bootstrap hợp lệ, init vẫn gọi _fetchGrArticleIndex trước khi dựng feedback.',
    }]);
    assert.match(pair.note, /THIẾU session_id/);
  });
});
