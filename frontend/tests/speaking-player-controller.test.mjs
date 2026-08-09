import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SpeakingPlayerController } from '../lib/speaking-player-controller.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const readFrontend = (...parts) => readFileSync(path.join(FRONTEND, ...parts), 'utf8');
const PAGE = readFrontend('app', '(authed-practice)', 'practice', 'session', 'page.tsx');
const BRIDGE = readFrontend(
  'app', '(authed-practice)', 'practice', 'session', 'practice-player-bridge.tsx',
);
const BOOT = readFrontend(
  'app', '(authed-practice)', 'practice', 'session', 'practice-session-boot.tsx',
);
const PRACTICE = readFrontend('public', 'js', 'practice.js');

class FakeClassList {
  constructor() { this.values = new Set(); }
  toggle(name, on) { if (on) this.values.add(name); else this.values.delete(name); }
  contains(name) { return this.values.has(name); }
}

class FakeTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }
  emit(type, event = {}) { this.listeners.get(type)?.(event); }
}

function makeEnvironment() {
  const elements = new Map(['loading', 'error', 'prep'].map((state) => [
    `state-${state}`,
    { classList: new FakeClassList() },
  ]));
  const intervals = new Map();
  const timeouts = new Map();
  let nextHandle = 1;
  const revoked = [];
  const speech = { cancelled: 0, cancel() { this.cancelled += 1; } };
  return {
    elements,
    intervals,
    timeouts,
    revoked,
    speech,
    environment: {
      states: ['loading', 'error', 'prep'],
      document: { getElementById: (id) => elements.get(id) || null },
      setIntervalFn(callback) { const id = nextHandle++; intervals.set(id, callback); return id; },
      clearIntervalFn(id) { intervals.delete(id); },
      setTimeoutFn(callback) { const id = nextHandle++; timeouts.set(id, callback); return id; },
      clearTimeoutFn(id) { timeouts.delete(id); },
      urlApi: {
        createObjectURL(blob) { return `blob:${blob.name}`; },
        revokeObjectURL(url) { revoked.push(url); },
      },
      speechSynthesis: speech,
    },
  };
}

describe('SpeakingPlayerController — state and effect ownership', () => {
  test('atomically activates one known state and rejects unknown state', () => {
    const fixture = makeEnvironment();
    const controller = new SpeakingPlayerController(fixture.environment);
    controller.showState('loading');
    controller.showState('prep');
    assert.equal(fixture.elements.get('state-loading').classList.contains('active'), false);
    assert.equal(fixture.elements.get('state-prep').classList.contains('active'), true);
    assert.equal(controller.getSnapshot().currentState, 'prep');
    assert.throws(() => controller.showState('missing'), /unknown-speaking-player-state/);
  });

  test('publishes state changes for a React renderer without mutating legacy classes', () => {
    const fixture = makeEnvironment();
    const controller = new SpeakingPlayerController({
      ...fixture.environment,
      domStateActivation: false,
    });
    const states = [];
    const unsubscribe = controller.subscribeState(() => {
      states.push(controller.getStateSnapshot());
    });
    controller.showState('loading');
    controller.showState('prep');
    assert.deepEqual(states, ['loading', 'prep']);
    assert.equal(fixture.elements.get('state-loading').classList.contains('active'), false);
    assert.equal(fixture.elements.get('state-prep').classList.contains('active'), false);
    unsubscribe();
    controller.showState('error');
    assert.deepEqual(states, ['loading', 'prep']);
  });

  test('replaces keyed listeners and removes them on destroy', () => {
    const fixture = makeEnvironment();
    const target = new FakeTarget();
    const calls = [];
    const controller = new SpeakingPlayerController(fixture.environment);
    controller.listen('document-click', target, 'click', () => calls.push('old'));
    controller.listen('document-click', target, 'click', () => calls.push('new'));
    target.emit('click');
    assert.deepEqual(calls, ['new']);
    controller.destroy();
    target.emit('click');
    assert.deepEqual(calls, ['new']);
  });

  test('owns countdown state and clears the interval at zero', () => {
    const fixture = makeEnvironment();
    const ticks = [];
    let done = 0;
    const controller = new SpeakingPlayerController(fixture.environment);
    controller.startCountdown('p2-prep', {
      seconds: 2,
      onTick: (value) => ticks.push(value),
      onDone: () => { done += 1; },
    });
    assert.equal(controller.getSnapshot().countdowns['p2-prep'], 2);
    const interval = fixture.intervals.values().next().value;
    interval();
    interval();
    assert.deepEqual(ticks, [2, 1, 0]);
    assert.equal(done, 1);
    assert.equal(fixture.intervals.size, 0);
    assert.deepEqual(controller.getSnapshot().countdowns, {});
  });

  test('replacing and destroying object URLs revokes every owned blob', () => {
    const fixture = makeEnvironment();
    const controller = new SpeakingPlayerController(fixture.environment);
    assert.equal(controller.createObjectUrl('recorded', { name: 'one' }), 'blob:one');
    assert.equal(controller.createObjectUrl('recorded', { name: 'two' }), 'blob:two');
    assert.deepEqual(fixture.revoked, ['blob:one']);
    controller.createObjectUrl('feedback', { name: 'three' });
    controller.destroy();
    assert.deepEqual(new Set(fixture.revoked), new Set(['blob:one', 'blob:two', 'blob:three']));
    assert.equal(fixture.speech.cancelled, 1);
  });

  test('a stale object-URL callback cannot revoke a newer URL with the same key', () => {
    const fixture = makeEnvironment();
    const controller = new SpeakingPlayerController(fixture.environment);
    const oldUrl = controller.createObjectUrl('tts', { name: 'old' });
    const newUrl = controller.createObjectUrl('tts', { name: 'new' });
    assert.equal(controller.revokeObjectUrl('tts', oldUrl), false);
    assert.equal(controller.getSnapshot().objectUrlKeys.includes('tts'), true);
    assert.equal(controller.revokeObjectUrl('tts', newUrl), true);
    assert.deepEqual(fixture.revoked, ['blob:old', 'blob:new']);
  });

  test('destroy cancels pending interval/timeout and suppresses their callbacks', () => {
    const fixture = makeEnvironment();
    const controller = new SpeakingPlayerController(fixture.environment);
    let calls = 0;
    controller.startInterval('poll', () => { calls += 1; }, 1000);
    controller.startTimeout('later', () => { calls += 1; }, 1000);
    const interval = fixture.intervals.values().next().value;
    const timeout = fixture.timeouts.values().next().value;
    controller.destroy();
    interval();
    timeout();
    assert.equal(calls, 0);
    assert.equal(fixture.intervals.size, 0);
    assert.equal(fixture.timeouts.size, 0);
  });

  test('countdown cannot resurrect state or call done when onTick destroys it', () => {
    const fixture = makeEnvironment();
    const controller = new SpeakingPlayerController(fixture.environment);
    let done = 0;
    controller.startCountdown('self-destroying', {
      seconds: 2,
      onTick: () => controller.destroy(),
      onDone: () => { done += 1; },
    });
    assert.equal(done, 0);
    assert.deepEqual(controller.getSnapshot().countdowns, {});
    assert.equal(fixture.intervals.size, 0);
  });

  test('clearing a countdown from its final tick suppresses onDone', () => {
    const fixture = makeEnvironment();
    const controller = new SpeakingPlayerController(fixture.environment);
    let done = 0;
    controller.startCountdown('cancel-at-zero', {
      seconds: 1,
      onTick: (remaining) => {
        if (remaining === 0) controller.clearEffect('cancel-at-zero');
      },
      onDone: () => { done += 1; },
    });
    fixture.intervals.values().next().value();
    assert.equal(done, 0);
    assert.deepEqual(controller.getSnapshot().countdowns, {});
  });
});

describe('Next Speaking player integration', () => {
  test('bridge is mounted before recorder/submission/full-test and boot waits for it', () => {
    const player = PAGE.indexOf('<PracticePlayerBridge />');
    assert.ok(player !== -1);
    assert.ok(player < PAGE.indexOf('<PracticeRecorderBridge />'));
    assert.ok(player < PAGE.indexOf('<PracticeSubmissionBridge />'));
    assert.ok(player < PAGE.indexOf('<PracticeFullTestBridge />'));
    assert.match(BOOT, /PracticePlayer\?\.showState/);
  });

  test('bridge owns lifecycle and asks PracticeApp to release legacy references first', () => {
    assert.match(BRIDGE, /new SpeakingPlayerController/);
    assert.match(BRIDGE, /const mountedController = createPlayerController\(\)/);
    assert.match(BRIDGE, /setController\(mountedController\)/);
    assert.match(BRIDGE, /win\.PracticeApp\?\.destroy\?\.\(\)/);
    assert.match(BRIDGE, /mountedController\.destroy\(\)/);
    assert.match(BRIDGE, /win\.PracticePlayer === mountedController/);
    assert.match(BRIDGE, /controller \|\| INERT_PLAYER_STATE/);
  });

  test('practice delegates state, timers, listeners, speech and blob URLs to native player', () => {
    assert.match(PRACTICE, /PracticePlayer/);
    assert.match(PRACTICE, /nativePlayer\.showState/);
    assert.match(PRACTICE, /nativePlayer\.startCountdown/);
    assert.match(PRACTICE, /nativePlayer\.listen/);
    assert.match(PRACTICE, /nativePlayer\.createObjectUrl/);
    assert.match(PRACTICE, /nativePlayer\.cancelSpeech/);
    assert.match(PRACTICE, /destroy:/);
  });

  test('practice has no timer, listener or object-URL escape hatch outside managed helpers', () => {
    const helperStart = PRACTICE.indexOf('function _startManagedInterval');
    const helperEnd = PRACTICE.indexOf('// ── Top-level state management', helperStart);
    const helperBlock = PRACTICE.slice(helperStart, helperEnd);
    const rawEffects = [
      /\bsetInterval\(/g,
      /\bsetTimeout\(/g,
      /\bclearInterval\(/g,
      /\bclearTimeout\(/g,
      /\.addEventListener\(/g,
      /URL\.createObjectURL\(/g,
      /URL\.revokeObjectURL\(/g,
    ];
    for (const pattern of rawEffects) {
      const all = [...PRACTICE.matchAll(pattern)].length;
      const managedFallbacks = [...helperBlock.matchAll(pattern)].length;
      assert.equal(all, managedFallbacks, `${pattern} escaped the player effect registry`);
    }
  });

  test('legacy async work is generation-gated and cannot restart TTS after unmount', () => {
    assert.match(PRACTICE, /function _playTtsBlob[\s\S]{0,160}!_playerActive/);
    assert.match(
      PRACTICE,
      /function _ttsAI\([\s\S]*?\.catch\(function \(err\) \{\s*if \(!_playerActive \|\| gen !== _ttsGeneration\) return;/,
    );
    assert.match(
      PRACTICE,
      /function _fallback\(fromIdx\) \{\s*if \(usedFallback \|\| !_playerActive \|\| gen !== _ttsGeneration\) return;/,
    );
    assert.match(
      PRACTICE,
      /function _ttsSequence[\s\S]{0,500}sequenceGeneration !== _browserTtsGeneration/,
    );
    assert.match(PRACTICE, /processingRun !== _processingRun/);
    assert.match(PRACTICE, /reviewRun !== _sheetReviewRun/);
  });
});
