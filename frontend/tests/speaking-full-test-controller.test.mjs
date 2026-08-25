import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SpeakingFullTestController,
} from '../public/js/speaking-full-test-controller.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const readFrontend = (...parts) => readFileSync(path.join(FRONTEND, ...parts), 'utf8');
const BRIDGE = readFrontend(
  'app', '(authed-practice)', 'practice', 'session', 'practice-full-test-bridge.tsx',
);
const BOOT = readFrontend(
  'app', '(authed-practice)', 'practice', 'session', 'practice-session-boot.tsx',
);
const PAGE = readFrontend('pages', 'practice.html');
const PRACTICE = readFrontend('js', 'practice.js');

class MemoryStorage {
  constructor(entries = {}) { this.entries = new Map(Object.entries(entries)); }
  getItem(key) { return this.entries.has(key) ? this.entries.get(key) : null; }
  setItem(key, value) { this.entries.set(key, String(value)); }
  removeItem(key) { this.entries.delete(key); }
}

function makeController(overrides = {}) {
  const storage = overrides.storage || new MemoryStorage();
  const controller = new SpeakingFullTestController({
    storage,
    submit: async ({ questionId }) => ({ response_id: `r-${questionId}` }),
    finalize: async (body) => ({
      accepted: true,
      session_ids: [body.p1_id, body.p2_id, body.p3_id].filter(Boolean),
    }),
    getSession: async (id) => ({ id, status: 'submitted' }),
    ...overrides,
  });
  return { controller, storage };
}

describe('SpeakingFullTestController — durable chain and resume ledger', () => {
  test('restores and truncates the legacy chain, then writes owner-scoped v2 state', () => {
    const storage = new MemoryStorage({
      ielts_ft_session_ids: JSON.stringify(['p1', 'p2', 'p3']),
    });
    const { controller } = makeController({ storage });
    const snapshot = controller.restore({
      ownerId: 'user-a',
      currentSessionId: 'p2',
      responses: [{ id: 'r2', question_id: 'q2' }],
    });
    assert.deepEqual(snapshot.sessionIds, ['p1', 'p2']);
    assert.deepEqual(snapshot.confirmed.p2, ['q2']);
    assert.deepEqual(JSON.parse(storage.getItem('ielts_ft_session_ids')), ['p1', 'p2']);
    const v2 = JSON.parse(storage.getItem('ielts_ft_state_v2'));
    assert.equal(v2.owner_id, 'user-a');
    assert.deepEqual(v2.confirmed.p2, ['q2']);
  });

  test('rejects another account state and requires current-session membership', () => {
    const storage = new MemoryStorage({
      ielts_ft_state_v2: JSON.stringify({
        version: 2,
        owner_id: 'user-a',
        session_ids: ['old-p1', 'old-p2'],
        confirmed: { 'old-p2': ['old-q'] },
      }),
      // Deliberately include the new account's current id in the unscoped
      // legacy mirror: owner mismatch must still reject this whole chain.
      ielts_ft_session_ids: JSON.stringify(['old-p1', 'new-p1']),
    });
    const { controller } = makeController({ storage });
    const snapshot = controller.restore({
      ownerId: 'user-b',
      currentSessionId: 'new-p1',
    });
    assert.deepEqual(snapshot.sessionIds, ['new-p1']);
    assert.deepEqual(snapshot.confirmed, {});
  });

  test('does not let an authenticated account adopt ownerless v2 state', () => {
    const storage = new MemoryStorage({
      ielts_ft_state_v2: JSON.stringify({
        version: 2,
        owner_id: null,
        session_ids: ['ownerless-p0', 'p1'],
        confirmed: { p1: ['stale-q'] },
      }),
      ielts_ft_session_ids: JSON.stringify(['ownerless-p0', 'p1']),
    });
    const { controller } = makeController({ storage });
    const snapshot = controller.restore({
      ownerId: 'user-b',
      currentSessionId: 'p1',
      responses: [{ id: 'canonical-r', question_id: 'canonical-q' }],
    });
    assert.deepEqual(snapshot.sessionIds, ['p1']);
    assert.deepEqual(snapshot.confirmed, { p1: ['canonical-q'] });
    assert.equal(JSON.parse(storage.getItem('ielts_ft_state_v2')).owner_id, 'user-b');
  });

  test('does not let an anonymous restore adopt an authenticated account state', () => {
    const storage = new MemoryStorage({
      ielts_ft_state_v2: JSON.stringify({
        version: 2,
        owner_id: 'user-a',
        session_ids: ['user-a-p0', 'p1'],
        confirmed: { p1: ['user-a-q'] },
      }),
      ielts_ft_session_ids: JSON.stringify(['user-a-p0', 'p1']),
    });
    const { controller } = makeController({ storage });
    const snapshot = controller.restore({
      ownerId: null,
      currentSessionId: 'p1',
      responses: [],
    });
    assert.deepEqual(snapshot.sessionIds, ['p1']);
    assert.deepEqual(snapshot.confirmed, {});
  });

  test('migrates a legacy-only chain when no owner-scoped v2 state exists', () => {
    const storage = new MemoryStorage({
      ielts_ft_session_ids: JSON.stringify(['p1', 'p2']),
    });
    const { controller } = makeController({ storage });
    const snapshot = controller.restore({
      ownerId: 'user-a',
      currentSessionId: 'p2',
      responses: [],
    });
    assert.deepEqual(snapshot.sessionIds, ['p1', 'p2']);
    assert.equal(JSON.parse(storage.getItem('ielts_ft_state_v2')).owner_id, 'user-a');
  });

  test('canonical rows confirm only responses that have both row and question ids', () => {
    const storage = new MemoryStorage({
      ielts_ft_state_v2: JSON.stringify({
        version: 2,
        session_ids: ['p1'],
        confirmed: { p1: ['stale-q'] },
      }),
    });
    const { controller } = makeController({ storage });
    controller.restore({ currentSessionId: 'p1', responses: [] });
    controller.confirmCanonical('p1', [
      { id: 'r1', question_id: 'q1' },
      { id: '', question_id: 'q2' },
      { id: 'r3', question_id: '' },
    ]);
    assert.deepEqual(controller.confirmedQuestionIds('p1'), ['q1']);
  });

  test('a delayed disposed controller cannot overwrite a newer Full Test chain', () => {
    const storage = new MemoryStorage();
    const oldController = makeController({ storage }).controller;
    oldController.restore({ ownerId: 'user-1', currentSessionId: 'old-p1' });
    oldController.destroy();

    const newController = makeController({ storage }).controller;
    newController.restore({ ownerId: 'user-1', currentSessionId: 'new-p1' });

    assert.equal(
      oldController.replaceChainIfCurrent(['old-p1'], ['old-p1', 'old-p2']),
      false,
    );
    assert.deepEqual(newController.getSnapshot().sessionIds, ['new-p1']);
    assert.deepEqual(
      JSON.parse(storage.getItem('ielts_ft_state_v2')).session_ids,
      ['new-p1'],
    );
  });

  test('a delayed mutation may extend its unchanged chain after unmount', () => {
    const storage = new MemoryStorage();
    const controller = makeController({ storage }).controller;
    controller.restore({ ownerId: 'user-1', currentSessionId: 'p1' });
    controller.destroy();

    assert.equal(controller.replaceChainIfCurrent(['p1'], ['p1', 'p2']), true);
    assert.deepEqual(
      JSON.parse(storage.getItem('ielts_ft_state_v2')).session_ids,
      ['p1', 'p2'],
    );
  });

  test('empty canonical readback revokes a stale local confirmation', () => {
    const storage = new MemoryStorage({
      ielts_ft_state_v2: JSON.stringify({
        version: 2,
        owner_id: 'user-a',
        session_ids: ['p1'],
        confirmed: { p1: ['q1'] },
      }),
      ielts_ft_session_ids: JSON.stringify(['p1']),
    });
    const { controller } = makeController({ storage });
    const snapshot = controller.restore({
      ownerId: 'user-a',
      currentSessionId: 'p1',
      responses: [],
    });
    assert.deepEqual(snapshot.confirmed, {});
    assert.deepEqual(JSON.parse(storage.getItem('ielts_ft_state_v2')).confirmed, {});
  });

  test('failed canonical readback preserves the local confirmation ledger', () => {
    const storage = new MemoryStorage({
      ielts_ft_state_v2: JSON.stringify({
        version: 2,
        owner_id: 'user-a',
        session_ids: ['p1'],
        confirmed: { p1: ['q1'] },
      }),
      ielts_ft_session_ids: JSON.stringify(['p1']),
    });
    const { controller } = makeController({ storage });
    const snapshot = controller.restore({
      ownerId: 'user-a',
      currentSessionId: 'p1',
      responses: [],
      responseLookupFailed: true,
    });
    assert.deepEqual(snapshot.confirmed, { p1: ['q1'] });
    assert.deepEqual(
      JSON.parse(storage.getItem('ielts_ft_state_v2')).confirmed,
      { p1: ['q1'] },
    );
  });
});

describe('SpeakingFullTestController — submission and retry ownership', () => {
  test('coalesces concurrent submits and persists a confirmed question', async () => {
    let release;
    let calls = 0;
    const { controller, storage } = makeController({
      submit: () => {
        calls += 1;
        return new Promise((resolve) => { release = resolve; });
      },
    });
    controller.restore({ ownerId: 'u', currentSessionId: 'p1' });
    const blob = {};
    const first = controller.submitAnswer({ sessionId: 'p1', questionId: 'q1', blob });
    const second = controller.submitAnswer({ sessionId: 'p1', questionId: 'q1', blob });
    assert.equal(first, second);
    assert.equal(controller.hasUnsavedAudio(), true, 'pending upload is still the only local copy');
    assert.equal(calls, 0, 'submission starts in a microtask');
    await Promise.resolve();
    assert.equal(calls, 1);
    release({ response_id: 'r1' });
    await first;
    assert.equal(controller.hasUnsavedAudio(), false);
    assert.deepEqual(controller.confirmedQuestionIds('p1'), ['q1']);
    assert.deepEqual(JSON.parse(storage.getItem('ielts_ft_state_v2')).confirmed.p1, ['q1']);
  });

  test('serializes a newer take instead of aliasing the pending blob', async () => {
    const calls = [];
    const { controller } = makeController({
      submit: (item) => new Promise((resolve) => { calls.push({ item, resolve }); }),
    });
    controller.restore({ ownerId: 'u', currentSessionId: 'p1' });
    const firstBlob = { take: 'A' };
    const secondBlob = { take: 'B' };
    const first = controller.submitAnswer({ sessionId: 'p1', questionId: 'q1', blob: firstBlob });
    const second = controller.submitAnswer({ sessionId: 'p1', questionId: 'q1', blob: secondBlob });
    assert.notEqual(first, second);
    await Promise.resolve();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].item.blob, firstBlob);
    calls[0].resolve({ response_id: 'r-a' });
    await first;
    await Promise.resolve();
    assert.equal(calls.length, 2);
    assert.equal(calls[1].item.blob, secondBlob);
    calls[1].resolve({ response_id: 'r-b' });
    await second;
  });

  test('retains the exact failed blob and retry sends it without rerecording', async () => {
    const blob = { unique: 'only-copy' };
    const calls = [];
    const { controller } = makeController({
      submit: async (item) => {
        calls.push(item);
        if (calls.length === 1) throw Object.assign(new Error('offline'), { code: 'ambiguous_commit' });
        return { response_id: 'r1' };
      },
    });
    controller.restore({ currentSessionId: 'p1' });
    await assert.rejects(
      controller.submitAnswer({ sessionId: 'p1', questionId: 'q1', blob }),
    );
    assert.equal(controller.hasUnsavedAudio(), true);
    assert.equal(controller.getSnapshot().retryCount, 1);
    await controller.retryFailed();
    assert.equal(calls[1].blob, blob);
    assert.equal(controller.hasUnsavedAudio(), false);
    assert.deepEqual(controller.confirmedQuestionIds('p1'), ['q1']);
  });

  test('destroy blocks new submissions but does not cancel one that may commit', async () => {
    let release;
    const { controller } = makeController({
      submit: () => new Promise((resolve) => { release = resolve; }),
    });
    controller.restore({ currentSessionId: 'p1' });
    const pending = controller.submitAnswer({ sessionId: 'p1', questionId: 'q1', blob: {} });
    await Promise.resolve();
    controller.destroy();
    release({ response_id: 'r1' });
    await pending;
    await assert.rejects(
      controller.submitAnswer({ sessionId: 'p1', questionId: 'q2', blob: {} }),
      (error) => error.code === 'disposed',
    );
  });

  test('a submission settling after remount cannot overwrite the newer chain', async () => {
    const storage = new MemoryStorage();
    let release;
    const oldController = makeController({
      storage,
      submit: () => new Promise((resolve) => { release = resolve; }),
    }).controller;
    oldController.restore({ ownerId: 'u', currentSessionId: 'old-p1' });
    const pending = oldController.submitAnswer({
      sessionId: 'old-p1',
      questionId: 'old-q1',
      blob: {},
    });
    await Promise.resolve();
    oldController.destroy();

    const newController = makeController({ storage }).controller;
    newController.restore({ ownerId: 'u', currentSessionId: 'new-p1' });
    release({ response_id: 'old-r1' });
    await pending;

    const persisted = JSON.parse(storage.getItem('ielts_ft_state_v2'));
    assert.deepEqual(persisted.session_ids, ['new-p1']);
    assert.deepEqual(persisted.confirmed, {});
    assert.deepEqual(newController.getSnapshot().sessionIds, ['new-p1']);
  });

  test('turns a stalled upload into a retryable local recording instead of hanging forever', async () => {
    const blob = { unique: 'stalled-copy' };
    const { controller } = makeController({
      submissionSettleMs: 5,
      submit: () => new Promise(() => {}),
    });
    controller.restore({ currentSessionId: 'p1' });
    await assert.rejects(
      controller.submitAnswer({ sessionId: 'p1', questionId: 'q1', blob }),
      (error) => error.code === 'submission_timeout',
    );
    assert.equal(controller.getSnapshot().retryCount, 1);
    assert.equal(controller.hasUnsavedAudio(), true);
  });
});

describe('SpeakingFullTestController — finalize barrier and reconciliation', () => {
  test('never finalizes while a failed recording remains retryable', async () => {
    let finalizeCalls = 0;
    const { controller, storage } = makeController({
      submit: async () => { throw new Error('offline'); },
      finalize: async () => { finalizeCalls += 1; return {}; },
    });
    controller.restore({ currentSessionId: 'p1' });
    controller.replaceChain(['p1', 'p2', 'p3']);
    const upload = controller.submitAnswer({ sessionId: 'p3', questionId: 'q', blob: {} });
    await assert.rejects(upload);
    await assert.rejects(
      controller.finalizeFullTest(),
      (error) => error.code === 'answers_pending' && error.failures.length === 1,
    );
    assert.equal(finalizeCalls, 0);
    assert.ok(storage.getItem('ielts_ft_state_v2'), 'chain must survive a failed finalize');
  });

  test('waits for in-flight audio, posts the complete chain, and clears only after acceptance', async () => {
    let release;
    let finalizeBody = null;
    const { controller, storage } = makeController({
      submit: () => new Promise((resolve) => { release = resolve; }),
      finalize: async (body) => {
        finalizeBody = body;
        return { accepted: true, session_ids: ['p1', 'p2', 'p3'] };
      },
    });
    controller.restore({ ownerId: 'u', currentSessionId: 'p1' });
    controller.replaceChain(['p1', 'p2', 'p3']);
    controller.submitAnswer({ sessionId: 'p3', questionId: 'q', blob: {} }).catch(() => {});
    await Promise.resolve();
    const finalizing = controller.finalizeFullTest();
    await Promise.resolve();
    assert.equal(finalizeBody, null);
    release({ response_id: 'r' });
    const result = await finalizing;
    assert.equal(result.accepted, true);
    assert.deepEqual(finalizeBody, { p1_id: 'p1', p2_id: 'p2', p3_id: 'p3' });
    assert.equal(storage.getItem('ielts_ft_state_v2'), null);
    assert.equal(storage.getItem('ielts_ft_session_ids'), null);
  });

  test('does not admit another upload after the finalize barrier starts', async () => {
    let release;
    let finalizeCalls = 0;
    const { controller } = makeController({
      submit: () => new Promise((resolve) => { release = resolve; }),
      finalize: async () => {
        finalizeCalls += 1;
        return { accepted: true, session_ids: ['p1', 'p2', 'p3'] };
      },
    });
    controller.restore({ ownerId: 'u', currentSessionId: 'p1' });
    controller.replaceChain(['p1', 'p2', 'p3']);
    controller.submitAnswer({ sessionId: 'p3', questionId: 'q1', blob: {} }).catch(() => {});
    await Promise.resolve();
    const finalizing = controller.finalizeFullTest();
    await assert.rejects(
      controller.submitAnswer({ sessionId: 'p3', questionId: 'q2', blob: {} }),
      (error) => error.code === 'finalizing',
    );
    assert.equal(finalizeCalls, 0);
    release({ response_id: 'r1' });
    await finalizing;
    assert.equal(finalizeCalls, 1);
  });

  test('reconciles an ambiguous finalize only when every canonical session is submitted or terminal', async () => {
    const { controller, storage } = makeController({
      finalize: async () => { throw new TypeError('Failed to fetch'); },
      getSession: async (id) => ({ id, status: id === 'p3' ? 'completed' : 'submitted' }),
    });
    controller.restore({ currentSessionId: 'p1' });
    controller.replaceChain(['p1', 'p2', 'p3']);
    const result = await controller.finalizeFullTest();
    assert.equal(result._reconciled, true);
    assert.equal(storage.getItem('ielts_ft_state_v2'), null);
  });

  test('keeps the chain when canonical readback still says in_progress', async () => {
    const { controller, storage } = makeController({
      finalize: async () => null,
      getSession: async (id) => ({ id, status: id === 'p2' ? 'in_progress' : 'submitted' }),
    });
    controller.restore({ currentSessionId: 'p1' });
    controller.replaceChain(['p1', 'p2', 'p3']);
    await assert.rejects(
      controller.finalizeFullTest(),
      (error) => error.code === 'ambiguous_finalize',
    );
    assert.ok(storage.getItem('ielts_ft_state_v2'));
  });

  test('does not reconcile a definitive 4xx rejection against stale submitted rows', async () => {
    let reads = 0;
    const rejected = Object.assign(new Error('question set incomplete'), { status: 409 });
    const { controller, storage } = makeController({
      finalize: async () => { throw rejected; },
      getSession: async () => { reads += 1; return { status: 'submitted' }; },
    });
    controller.restore({ currentSessionId: 'p1' });
    controller.replaceChain(['p1', 'p2', 'p3']);
    await assert.rejects(
      controller.finalizeFullTest(),
      (error) => error.code === 'finalize_rejected',
    );
    assert.equal(reads, 0);
    assert.ok(storage.getItem('ielts_ft_state_v2'));
  });

  test('refuses to finalize a chain that is missing any Speaking part', async () => {
    let calls = 0;
    const { controller } = makeController({
      finalize: async () => { calls += 1; return {}; },
    });
    controller.restore({ currentSessionId: 'p1' });
    controller.replaceChain(['p1', 'p2']);
    await assert.rejects(
      controller.finalizeFullTest(),
      (error) => error.code === 'incomplete_chain',
    );
    assert.equal(calls, 0);
  });

  test('reconciles a timed-out finalize and keeps the chain when canonical state is not accepted', async () => {
    const { controller, storage } = makeController({
      finalizeSettleMs: 5,
      finalize: () => new Promise(() => {}),
      getSession: async (id) => ({ id, status: 'in_progress' }),
    });
    controller.restore({ currentSessionId: 'p1' });
    controller.replaceChain(['p1', 'p2', 'p3']);
    await assert.rejects(
      controller.finalizeFullTest(),
      (error) => error.code === 'ambiguous_finalize',
    );
    assert.ok(storage.getItem('ielts_ft_state_v2'));
  });
});

describe('Next Speaking Full Test integration', () => {
  test('bridge owns lifecycle, API contracts and unload protection for the only local audio copy', () => {
    assert.match(BRIDGE, /const \{ status, user \} = useAuth\(\)/);
    assert.match(BRIDGE, /new SpeakingFullTestController/);
    assert.match(BRIDGE, /PracticeSubmission\?\.submit/);
    assert.match(BRIDGE, /\/sessions\/finalize-full-test/);
    assert.match(BRIDGE, /api\.postWith\([\s\S]*?noRedirect: true/);
    assert.match(BRIDGE, /api\.getWith\([\s\S]*?noRedirect: true/);
    assert.match(BRIDGE, /encodeURIComponent\(sessionId\)/);
    assert.match(BRIDGE, /controller\.hasUnsavedAudio\(\)/);
    assert.match(BRIDGE, /beforeunload/);
    assert.match(BRIDGE, /controller\.destroy\(\)/);
  });

  test('boot waits for native Full Test state before starting PracticeApp', () => {
    assert.match(BOOT, /PracticeFullTest\?\.restore/);
    assert.match(BOOT, /native full-test state/);
  });

  test('player delegates chain, eager submission, retry, resume and finalize to native state', () => {
    assert.match(PRACTICE, /nativeFullTest\.replaceChain\(_ftAllSessionIds\)/);
    assert.match(PRACTICE, /nativeFullTest\.submitAnswer\(\{/);
    assert.match(PRACTICE, /nativeFullTest\.finalizeFullTest\(\)/);
    assert.match(PRACTICE, /nativeFullTest\.retryFailed\(\)/);
    assert.match(PRACTICE, /nativeFullTest\.confirmedQuestionIds\(_sessionId\)/);
    assert.match(PRACTICE, /_sessionData\.response_receipts/);
    assert.match(PRACTICE, /responseLookupFailed:[\s\S]*?response_lookup_failed === true/);
    assert.match(PRACTICE, /_assertFullTestResponseLookup\(_sessionData\)/);
    assert.match(PRACTICE, /_createBody\.previous_session_id = _sessionId/);
    assert.match(PRACTICE, /retryFullTestSubmissions: retryFullTestSubmissions/);
  });

  test('completion copy is truthful and navigation stays hidden until server acceptance', () => {
    for (const id of [
      'completion-title',
      'completion-desc',
      'completion-submit-status',
      'completion-retry-btn',
      'completion-info',
      'completion-ctas',
    ]) {
      assert.match(PAGE, new RegExp(`id="${id}"`));
    }
    assert.match(PRACTICE, /ctas\.style\.display = 'none'/);
    assert.match(PRACTICE, /ctas\.style\.display = ''/);
    assert.match(PRACTICE, /Bản ghi vẫn còn trên thiết bị này/);
    assert.match(
      PRACTICE,
      /Promise\.allSettled\(pendingLegacy\)[\s\S]*?api\.postWith\([\s\S]*?'\/sessions\/finalize-full-test'[\s\S]*?\.catch\(function \(err\) \{[\s\S]*?_setFullTestCompletionPhase\('error', err\)/,
    );
    assert.match(PRACTICE, /_setFullTestCompletionPhase\('legacy-upload-error'\)/);
    assert.match(PRACTICE, /if \(info\) info\.style\.display = 'none'/);
  });
});
