// Spike-2 fix — full-test chain persistence source pins (behavioral coverage
// lives in tests/e2e/full_test_chain_persistence.spec.js; these pin the
// invariants a refactor could silently drop).
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = readFileSync(path.join(FRONTEND, 'js', 'practice.js'), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function flushUntil(predicate, attempts = 20) {
  for (let index = 0; index < attempts && !predicate(); index += 1) {
    await Promise.resolve();
  }
  assert.equal(predicate(), true, 'transition did not reach the expected async phase');
}

test('chain persists under the stable sessionStorage key', () => {
  assert.match(SRC, /var FT_CHAIN_KEY = 'ielts_ft_session_ids';/,
    'key is a cross-page/tab contract — renaming breaks in-flight full tests');
  assert.match(SRC, /var nextChain = priorChain\.concat\(\[newId\]\);/,
    'every new part must extend the chain captured before the mutation');
  assert.match(SRC, /nativeFullTest\.replaceChainIfCurrent\(priorChain, nextChain\)/,
    'a delayed create may persist only while its exact prior chain still owns storage');
  assert.match(SRC, /_replaceLegacyFtChainIfCurrent\(priorChain, nextChain\)/,
    'the legacy fallback must retain the same compare-and-swap durability rule');
  assert.match(SRC, /_ftAllSessionIds = nextChain;\s*\n\s*_saveFtChain\(\);/,
    'the live player and persisted chain must commit the same session ids');
  const transition = SRC.slice(
    SRC.indexOf('async function _startNextPartInFullTest(part)'),
    SRC.indexOf('function _finishTestAndShowResults()'),
  );
  const childClaim = transition.indexOf("'/renderer-affinity'");
  const chainCommit = transition.indexOf('var nextChain = priorChain.concat([newId])');
  assert.ok(childClaim !== -1 && childClaim < chainCommit,
    'each new Part must claim the current renderer before entering the durable chain');
});

test('legacy delayed part creation extends only the unchanged stored chain', () => {
  const start = SRC.indexOf('function _replaceLegacyFtChainIfCurrent');
  const end = SRC.indexOf('function _loadFtChain', start);
  const entries = new Map();
  const storage = {
    getItem(key) { return entries.has(key) ? entries.get(key) : null; },
    setItem(key, value) { entries.set(key, String(value)); },
  };
  const replaceIfCurrent = new Function('sessionStorage', `
    var FT_CHAIN_KEY = 'ielts_ft_session_ids';
    ${SRC.slice(start, end)}
    return _replaceLegacyFtChainIfCurrent;
  `)(storage);

  storage.setItem('ielts_ft_session_ids', JSON.stringify(['p1']));
  assert.equal(replaceIfCurrent(['p1'], ['p1', 'p2']), true);
  assert.deepEqual(JSON.parse(storage.getItem('ielts_ft_session_ids')), ['p1', 'p2']);

  storage.setItem('ielts_ft_session_ids', JSON.stringify(['new-p1']));
  assert.equal(replaceIfCurrent(['p1'], ['p1', 'stale-p2']), false);
  assert.deepEqual(JSON.parse(storage.getItem('ielts_ft_session_ids')), ['new-p1']);
});

test('init restores with membership check + truncation', () => {
  assert.match(SRC, /storedChain\.indexOf\(_sessionId\)/,
    'a stale chain from another full test must be rejected');
  assert.match(SRC, /storedChain\.slice\(0, chainPos \+ 1\)/,
    'parts after the current session are being redone — truncate them');
});

test('chain is cleared ONLY after finalize is ACCEPTED (review #748)', () => {
  const finalizeIdx = SRC.indexOf("'/sessions/finalize-full-test'");
  const acceptedFn = SRC.slice(
    SRC.indexOf('function _onFullTestFinalizeAccepted'),
    SRC.indexOf('function _setFullTestCompletionPhase'),
  );
  assert.ok(finalizeIdx !== -1);
  assert.match(
    SRC.slice(finalizeIdx, finalizeIdx + 180),
    /noRedirect: true/,
    'finalize auth expiry must preserve the chain and visible retry state',
  );
  assert.match(acceptedFn, /_clearFtChain\(\)/,
    'the chain clears in the shared accepted-only callback');
  assert.match(
    acceptedFn,
    /if \(acceptedController\) acceptedController\.clear\(\);\s*\n\s*else _clearFtChain\(\);/,
    'an async native finalize must clear only the controller captured by that request',
  );
  // Legacy finalization may call the accepted callback only from its success
  // arm; native finalization validates/reconciles acceptance in its controller.
  const thenBlock = SRC.slice(finalizeIdx, SRC.indexOf('.catch', finalizeIdx));
  assert.ok(thenBlock.includes('_onFullTestFinalizeAccepted('),
    'legacy clear belongs behind the success path');
  const pendingIdx = SRC.indexOf('Promise.allSettled(pendingLegacy)');
  assert.ok(pendingIdx !== -1 && pendingIdx < finalizeIdx,
    'legacy finalize must wait for every eager upload to settle first');
  assert.match(
    SRC.slice(pendingIdx, finalizeIdx),
    /_ftSubmitFailures\.length[\s\S]*?legacy-upload-error/,
    'a rejected eager upload must block finalize and render a truthful error state',
  );
  assert.match(SRC, /nativeFullTest\.finalizeFullTest\(\)[\s\S]{0,240}?_onFullTestFinalizeAccepted/,
    'native clear belongs behind validated finalize acceptance');
  assert.match(
    SRC,
    /_playerActive && generation === _playerGeneration,\s*\n\s*nativeFullTest,/,
    'native acceptance must not look up and clear a controller installed by a later mount',
  );

  const retryBlock = SRC.slice(
    SRC.indexOf('function retryFullTestSubmissions'),
    SRC.indexOf('function _renderSubmitFailureNotice'),
  );
  assert.match(
    retryBlock,
    /_onFullTestFinalizeAccepted\([\s\S]*?_playerActive && generation === _playerGeneration/,
    'retry acceptance must still clear durable state after unmount; only UI is generation-gated',
  );
  assert.doesNotMatch(
    retryBlock,
    /if \(!_playerActive \|\| generation !== _playerGeneration\) return;[\s\S]*?_onFullTestFinalizeAccepted/,
    'a stale route must not suppress accepted-only chain cleanup or mock-sitting debt persistence',
  );
});

test('part swap keeps the URL as routing source of truth', () => {
  assert.match(SRC, /history\.replaceState\(null, '', '\?session_id=' \+ encodeURIComponent\(newId\)\)/,
    'without this a refresh in Part 2/3 reloads Part 1\'s session');
  const push = SRC.indexOf('_ftAllSessionIds.push(newId)');
  const replace = SRC.indexOf("history.replaceState(null, '', '?session_id=' + encodeURIComponent(newId))", push);
  const generate = SRC.indexOf("'/questions/generate'", push);
  assert.ok(push < replace && replace < generate,
    'chain + URL must commit before question generation so reload resumes the new session');
});

test('Legacy and Next claim each chained Part before continuing the Full Test', async () => {
  const helperStart = SRC.indexOf('  function _setLoadingMessage(message) {');
  const helperEnd = SRC.indexOf('  // ── Recording sub-state management', helperStart);
  const transitionStart = SRC.indexOf('  async function _startNextPartInFullTest(part) {');
  const transitionEnd = SRC.indexOf('  function _finishTestAndShowResults()', transitionStart);
  assert.ok(helperStart !== -1 && helperEnd > helperStart);
  assert.ok(transitionStart !== -1 && transitionEnd > transitionStart);

  for (const [part, renderer] of [
    [2, 'legacy'],
    [2, 'next'],
    [3, 'legacy'],
    [3, 'next'],
  ]) {
    const createRequest = deferred();
    const questionRequest = deferred();
    const messages = [];
    const states = [];
    const errors = [];
    const posts = [];
    let prepCalls = 0;
    const environment = {
      _playerGeneration: 1,
      _ftAllSessionIds: [`p${part - 1}`],
      _getNativeFullTest: () => null,
      showState: (state) => states.push(state),
      _ftP2Topic: 'Part 2 topic',
      _sessionData: { topic: 'General', mode: 'test_full' },
      _sessionId: `p${part - 1}`,
      _rendererAffinity: renderer,
      _sittingId: null,
      window: {
        location: { replace() { throw new Error('renderer unexpectedly changed'); } },
        api: {
          post(url, body) {
            posts.push([url, body]);
            if (url === '/sessions') return createRequest.promise;
            if (url === `/sessions/p${part}/renderer-affinity`) {
              return Promise.resolve({ renderer_affinity: renderer });
            }
            if (url.endsWith('/questions/generate')) return questionRequest.promise;
            throw new Error(`unexpected request: ${url}`);
          },
        },
      },
      _playerActive: true,
      _replaceLegacyFtChainIfCurrent: () => false,
      sessionStorage: { setItem() {} },
      FT_CHAIN_KEY: 'ielts_ft_session_ids',
      _ftCurrentPart: part - 1,
      _saveFtChain: () => {},
      _practiceSessionUrlForRenderer: () => '/unused',
      history: { replaceState() {} },
      FULL_TEST_Q_COUNT: { 2: 1, 3: 5 },
      _questions: [],
      _currentIdx: 0,
      _showPrep: () => { prepCalls += 1; },
      showError: (message) => errors.push(message),
      _updateNativeView(section, patch) {
        assert.equal(section, 'frame');
        messages.push(patch.loadingMessage);
        return true;
      },
      $: () => { throw new Error('React-owned loading copy must not touch legacy DOM'); },
    };
    const names = Object.keys(environment);
    const makeTransition = new Function(...names, `
      ${SRC.slice(helperStart, helperEnd)}
      ${SRC.slice(transitionStart, transitionEnd)}
      return _startNextPartInFullTest;
    `);
    const transition = makeTransition(...names.map((name) => environment[name]));

    const pending = transition(part);
    assert.deepEqual(states, ['loading']);
    assert.equal(messages.at(-1), `Đang tạo Part ${part}...`);

    createRequest.resolve({ id: `p${part}`, part, topic: 'General', mode: 'test_full' });
    await flushUntil(() => messages.at(-1) === `Đang tạo câu hỏi Part ${part}...`);
    assert.deepEqual(posts.slice(0, 3), [
      ['/sessions', {
        mode: 'test_full',
        part,
        topic: part === 2 ? 'Part 2 topic' : 'General',
        previous_session_id: `p${part - 1}`,
      }],
      [`/sessions/p${part}/renderer-affinity`, { renderer_affinity: renderer }],
      [`/sessions/p${part}/questions/generate`, {}],
    ]);

    questionRequest.resolve(Array.from(
      { length: environment.FULL_TEST_Q_COUNT[part] },
      (_, index) => ({ id: `${part}-${index + 1}` }),
    ));
    await pending;
    assert.equal(prepCalls, 1);
    assert.deepEqual(errors, []);
  }
});

test('an opposite child affinity persists its predecessor chain before redirect', async () => {
  const transitionStart = SRC.indexOf('  async function _startNextPartInFullTest(part) {');
  const transitionEnd = SRC.indexOf('  function _finishTestAndShowResults()', transitionStart);
  const entries = new Map([['ielts_ft_session_ids', JSON.stringify(['p1'])]]);
  let redirectedTo = null;
  let questionGenerationCalled = false;
  const environment = {
    _playerGeneration: 1,
    _ftAllSessionIds: ['p1'],
    _getNativeFullTest: () => null,
    showState: () => {},
    _setLoadingMessage: () => {},
    _ftP2Topic: 'Part 2 topic',
    _sessionData: { topic: 'General', mode: 'test_full' },
    _sessionId: 'p1',
    _rendererAffinity: 'legacy',
    _sittingId: null,
    window: {
      api: {
        async post(url) {
          if (url === '/sessions') return { id: 'p2', part: 2, mode: 'test_full' };
          if (url === '/sessions/p2/renderer-affinity') {
            return { renderer_affinity: 'next' };
          }
          if (url.endsWith('/questions/generate')) questionGenerationCalled = true;
          throw new Error(`unexpected request: ${url}`);
        },
      },
      location: {
        replace(url) {
          redirectedTo = url;
          assert.deepEqual(
            JSON.parse(entries.get('ielts_ft_session_ids')),
            ['p1', 'p2'],
            'the canonical destination must see the complete predecessor chain',
          );
        },
      },
    },
    _playerActive: true,
    _replaceLegacyFtChainIfCurrent: () => false,
    sessionStorage: {
      getItem(key) { return entries.get(key) || null; },
      setItem(key, value) { entries.set(key, String(value)); },
    },
    FT_CHAIN_KEY: 'ielts_ft_session_ids',
    _practiceSessionUrlForRenderer: (sessionId, renderer) => (
      `${renderer === 'next' ? '/practice/session' : '/pages/practice.html'}?session_id=${sessionId}`
    ),
  };
  const names = Object.keys(environment);
  const makeTransition = new Function(...names, `
    ${SRC.slice(transitionStart, transitionEnd)}
    return _startNextPartInFullTest;
  `);

  await makeTransition(...names.map((name) => environment[name]))(2);

  assert.equal(redirectedTo, '/practice/session?session_id=p2');
  assert.equal(questionGenerationCalled, false);
});

test('all Full Test parts reject a persisted short question set', () => {
  assert.match(SRC, /_testMode === 'test_full' && questions\.length < maxQ/);
  assert.match(SRC, /Không tạo đủ câu hỏi cho Full Test Part/);
});
