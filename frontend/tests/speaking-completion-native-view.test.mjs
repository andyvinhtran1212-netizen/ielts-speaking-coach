import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const JS = readFileSync(join(HERE, '..', 'public', 'js', 'practice.js'), 'utf8');

function renderPhase(phase, { retryCount = 0, error = null } = {}) {
  const start = JS.indexOf('  function _setFullTestCompletionPhase(');
  const end = JS.indexOf('  function retryFullTestSubmissions()', start);
  assert.ok(start !== -1 && end > start, 'completion phase function not found');
  let model = null;
  const update = (section, patch) => {
    assert.equal(section, 'completion');
    model = patch;
    return true;
  };
  const run = new Function('_getNativeFullTest', '_updateNativeView', '$', `
    ${JS.slice(start, end)}
    return _setFullTestCompletionPhase;
  `)(
    () => ({ getSnapshot: () => ({ retryCount }) }),
    update,
    () => { throw new Error('native completion must not mutate DOM'); },
  );
  run(phase, error);
  return model;
}

function retryHarness({ retryCount = 0, retryFailed, finalizeFullTest } = {}) {
  const phaseStart = JS.indexOf('  function _setFullTestCompletionPhase(');
  const retryStart = JS.indexOf('  function retryFullTestSubmissions()', phaseStart);
  const retryEnd = JS.indexOf('  function _renderSubmitFailureNotice()', retryStart);
  assert.ok(phaseStart !== -1 && retryStart > phaseStart && retryEnd > retryStart,
    'completion retry functions not found');

  const snapshot = { retryCount, sessionIds: ['p1', 'p2', 'p3'] };
  const controller = {
    retryCalls: 0,
    finalizeCalls: 0,
    getSnapshot: () => snapshot,
    retryFailed: () => {
      controller.retryCalls += 1;
      return retryFailed ? retryFailed(snapshot) : Promise.resolve();
    },
    finalizeFullTest: () => {
      controller.finalizeCalls += 1;
      return finalizeFullTest ? finalizeFullTest(snapshot) : Promise.resolve();
    },
  };
  let model = {};
  const updates = [];
  const accepted = [];
  const update = (section, patch) => {
    assert.equal(section, 'completion');
    updates.push(patch);
    model = { ...model, ...patch };
    return true;
  };
  const create = new Function(
    '_getNativeFullTest', '_updateNativeView', '$',
    '_onFullTestFinalizeAccepted', 'console', '_ftSubmitFailures', `
      var _fullTestRetryInFlight = false;
      var _playerGeneration = 1;
      var _playerActive = true;
      var _sittingId = 'sitting-1';
      ${JS.slice(phaseStart, retryEnd)}
      return {
        retry: retryFullTestSubmissions,
        stale: function () { _playerGeneration += 1; _playerActive = false; },
      };
    `,
  );
  const api = create(
    () => controller,
    update,
    () => { throw new Error('native completion must not mutate DOM'); },
    (...args) => { accepted.push(args); return Promise.resolve(); },
    { warn() {} },
    [],
  );
  return {
    ...api,
    controller,
    snapshot,
    updates,
    accepted,
    getModel: () => model,
  };
}

describe('Full Test completion native view-model', () => {
  test('sending state keeps navigation hidden until canonical acceptance', () => {
    const model = renderPhase('sending');
    assert.equal(model.statusTone, 'pending');
    assert.equal(model.retryVisible, false);
    assert.equal(model.infoVisible, false);
    assert.equal(model.ctasVisible, false);
    assert.match(model.description, /máy chủ xác nhận đủ/);
  });

  test('accepted state exposes navigation only after the server confirms', () => {
    const model = renderPhase('accepted');
    assert.equal(model.statusTone, 'success');
    assert.equal(model.ctasVisible, true);
    assert.equal(model.infoVisible, true);
    assert.equal(model.retryVisible, false);
    assert.match(model.statusText, /Đã xác nhận toàn bộ bản ghi/);
  });

  test('failed recordings remain retryable with truthful retained-blob copy', () => {
    const model = renderPhase('error', { retryCount: 2 });
    assert.equal(model.statusTone, 'error');
    assert.equal(model.retryVisible, true);
    assert.equal(model.ctasVisible, false);
    assert.equal(model.infoVisible, false);
    assert.equal(model.retryLabel, 'Gửi lại và chốt bài');
    assert.match(model.description, /vẫn còn trên thiết bị/);
    assert.match(model.statusText, /2 bản ghi/);
  });

  test('finalize-only failure does not pretend an answer blob is missing', () => {
    const model = renderPhase('error', {
      retryCount: 0,
      error: new Error('Máy chủ chưa trả xác nhận'),
    });
    assert.equal(model.title, 'Chưa chốt được Full Test');
    assert.equal(model.retryLabel, 'Thử chốt bài lại');
    assert.equal(model.statusText, 'Máy chủ chưa trả xác nhận');
  });
});

describe('Full Test completion retry behavior', () => {
  test('double-click starts one retry chain and keeps a visible disabled busy action', async () => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const harness = retryHarness({ retryFailed: () => pending });

    const first = harness.retry();
    const second = harness.retry();
    assert.equal(second, undefined);
    assert.equal(harness.controller.retryCalls, 1);
    assert.deepEqual(harness.getModel(), {
      title: 'Đang gửi nốt Full Test…',
      description: 'Hãy giữ trang này mở cho tới khi máy chủ xác nhận đủ tất cả bản ghi.',
      statusTone: 'pending',
      statusText: 'Đang kiểm tra và gửi nốt các câu trả lời…',
      retryVisible: true,
      retryDisabled: true,
      retryLabel: 'Đang gửi lại…',
      infoVisible: false,
      ctasVisible: false,
    });

    release();
    await first;
    assert.equal(harness.controller.finalizeCalls, 1);
    assert.equal(harness.accepted.length, 1);
  });

  test('upload failure restores a retryable retained-blob state', async () => {
    const harness = retryHarness({
      retryCount: 2,
      retryFailed: () => Promise.reject(new Error('mạng đứt')),
    });
    await harness.retry();
    assert.equal(harness.controller.finalizeCalls, 0);
    assert.equal(harness.getModel().retryVisible, true);
    assert.equal(harness.getModel().retryDisabled, false);
    assert.match(harness.getModel().statusText, /2 bản ghi/);
    await harness.retry();
    assert.equal(harness.controller.retryCalls, 2, 'failure must release the in-flight guard');
  });

  test('finalize-only failure never claims a retained recording is missing', async () => {
    const harness = retryHarness({
      retryCount: 2,
      retryFailed: (snapshot) => { snapshot.retryCount = 0; return Promise.resolve(); },
      finalizeFullTest: () => Promise.reject(new Error('chưa xác nhận chốt bài')),
    });
    await harness.retry();
    assert.equal(harness.getModel().title, 'Chưa chốt được Full Test');
    assert.equal(harness.getModel().retryLabel, 'Thử chốt bài lại');
    assert.equal(harness.getModel().statusText, 'chưa xác nhận chốt bài');
  });

  test('stale success clears only its captured controller without reviving old UI', async () => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const harness = retryHarness({ retryFailed: () => pending });
    const request = harness.retry();
    const updateCount = harness.updates.length;
    harness.stale();
    release();
    await request;

    assert.equal(harness.updates.length, updateCount, 'stale success must not patch the old view');
    assert.equal(harness.accepted.length, 1, 'accepted cleanup must still run after unmount');
    assert.equal(harness.accepted[0][4], false, 'accepted cleanup must suppress stale UI rendering');
    assert.equal(harness.accepted[0][5], harness.controller,
      'cleanup must target the controller captured by the request');
  });
});
