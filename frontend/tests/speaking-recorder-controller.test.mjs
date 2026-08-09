import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  pickSpeakingRecorderMime,
  SpeakingRecorderController,
  SpeakingRecorderError,
} from '../lib/speaking-recorder-controller.mjs';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const readFrontend = (...parts) => readFileSync(path.join(FRONTEND, ...parts), 'utf8');
const PRACTICE = readFrontend('public', 'js', 'practice.js');
const BRIDGE = readFrontend(
  'app', '(authed-practice)', 'practice', 'session', 'practice-recorder-bridge.tsx',
);
const BOOT = readFrontend(
  'app', '(authed-practice)', 'practice', 'session', 'practice-session-boot.tsx',
);

class FakeTrack {
  constructor() { this.stopCount = 0; }
  stop() { this.stopCount += 1; }
}

class FakeStream {
  constructor() {
    this.active = true;
    this.track = new FakeTrack();
  }
  getTracks() { return [this.track]; }
}

class FakeMediaRecorder {
  static instances = [];
  static isTypeSupported(type) { return type === 'audio/webm'; }

  constructor(stream, options = {}) {
    this.stream = stream;
    this.mimeType = options.mimeType || '';
    this.state = 'inactive';
    this.ondataavailable = null;
    this.onstop = null;
    this.timeslice = null;
    FakeMediaRecorder.instances.push(this);
  }

  start(timeslice) {
    this.timeslice = timeslice;
    this.state = 'recording';
  }

  stop() {
    if (this.state === 'inactive') throw new Error('already inactive');
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['audio'], { type: this.mimeType || 'audio/webm' }) });
    this.onstop?.();
  }
}

class FakeAudioContext {
  constructor() {
    this.state = 'running';
    this.closeCount = 0;
    this.source = { connect() {}, disconnect() {} };
    this.analyser = { fftSize: 0, frequencyBinCount: 4, getByteTimeDomainData() {} };
  }
  createMediaStreamSource() { return this.source; }
  createAnalyser() { return this.analyser; }
  async resume() { this.state = 'running'; }
  close() { this.closeCount += 1; this.state = 'closed'; }
}

function harness({ getUserMedia } = {}) {
  FakeMediaRecorder.instances = [];
  const stream = new FakeStream();
  const timers = new Map();
  let timerId = 0;
  let gumCalls = 0;
  const controller = new SpeakingRecorderController({
    mediaDevices: {
      async getUserMedia(constraints) {
        gumCalls += 1;
        return getUserMedia ? getUserMedia(constraints, stream) : stream;
      },
    },
    MediaRecorderCtor: FakeMediaRecorder,
    AudioContextCtor: FakeAudioContext,
    BlobCtor: Blob,
    setIntervalFn(fn) { timerId += 1; timers.set(timerId, fn); return timerId; },
    clearIntervalFn(id) { timers.delete(id); },
  });
  return {
    controller,
    stream,
    timers,
    gumCalls: () => gumCalls,
    tick() { for (const fn of [...timers.values()]) fn(); },
  };
}

describe('SpeakingRecorderController', () => {
  test('picks the first supported MIME and records with 250ms chunks', async () => {
    assert.equal(pickSpeakingRecorderMime(FakeMediaRecorder), 'audio/webm');
    const h = harness();
    const ticks = [];
    assert.equal(await h.controller.start({ maxSeconds: 5, onTick: (n) => ticks.push(n) }), true);
    assert.equal(FakeMediaRecorder.instances[0].mimeType, 'audio/webm');
    assert.equal(FakeMediaRecorder.instances[0].timeslice, 250);
    assert.deepEqual(ticks, [0]);
    assert.equal(h.controller.getAnalyser().fftSize, 256);
  });

  test('hard cap stops once and returns the blob with final elapsed time', async () => {
    const h = harness();
    const ticks = [];
    const recorded = [];
    await h.controller.start({
      maxSeconds: 2,
      onTick: (n) => ticks.push(n),
      onRecorded: (blob, elapsed) => recorded.push({ blob, elapsed }),
    });
    h.tick();
    h.tick();
    assert.deepEqual(ticks, [0, 1, 2]);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].elapsed, 2);
    assert.equal(recorded[0].blob.type, 'audio/webm');
    assert.equal(h.timers.size, 0);
  });

  test('reuses the live stream across recordings', async () => {
    const h = harness();
    await h.controller.start();
    h.controller.stop();
    await h.controller.start();
    assert.equal(h.gumCalls(), 1);
  });

  test('coalesces concurrent starts while microphone permission is pending', async () => {
    let resolveMedia;
    const media = new Promise((resolve) => { resolveMedia = resolve; });
    const h = harness({ getUserMedia: () => media });
    const first = h.controller.start();
    assert.equal(await h.controller.start(), false);
    resolveMedia(h.stream);
    assert.equal(await first, true);
    assert.equal(h.gumCalls(), 1);
  });

  test('destroy stops a stream that resolves after unmount', async () => {
    let resolveMedia;
    const media = new Promise((resolve) => { resolveMedia = resolve; });
    const h = harness({ getUserMedia: () => media });
    const pending = h.controller.start();
    h.controller.destroy();
    resolveMedia(h.stream);
    await assert.rejects(
      pending,
      (error) => error instanceof SpeakingRecorderError && error.code === 'disposed',
    );
    assert.equal(h.stream.track.stopCount, 1);
  });

  test('reset suppresses stale onRecorded and destroy is idempotent', async () => {
    const h = harness();
    let recorded = 0;
    await h.controller.start({ onRecorded: () => { recorded += 1; } });
    const audioContext = h.controller.audioContext;
    h.controller.reset();
    assert.equal(recorded, 0);
    h.controller.destroy();
    h.controller.destroy();
    assert.equal(h.stream.track.stopCount, 1);
    assert.equal(audioContext.closeCount, 1);
  });

  test('tears down media when a start callback throws after recorder.start', async () => {
    const h = harness();
    await assert.rejects(
      h.controller.start({ onTick: () => { throw new Error('render failed'); } }),
      /render failed/,
    );
    assert.equal(h.controller.isRecording(), false);
    assert.equal(h.stream.track.stopCount, 1);
    assert.equal(h.timers.size, 0);
  });

  test('hard cap still stops when a later tick callback throws', async () => {
    const h = harness();
    await h.controller.start({
      maxSeconds: 1,
      onTick: (elapsed) => { if (elapsed > 0) throw new Error('paint failed'); },
    });
    assert.throws(() => h.tick(), /paint failed/);
    assert.equal(h.controller.isRecording(), false);
    assert.equal(h.timers.size, 0);
  });

  test('maps permission denial to actionable Vietnamese copy', async () => {
    const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    const h = harness({ getUserMedia: async () => { throw denied; } });
    await assert.rejects(
      h.controller.start(),
      (error) => error.code === 'permission_denied' && /thanh địa chỉ/.test(error.message),
    );
  });
});

describe('Next Speaking recorder integration', () => {
  test('bridge owns controller lifecycle and removes only its own global', () => {
    assert.match(BRIDGE, /new SpeakingRecorderController\(\)/);
    assert.match(BRIDGE, /win\.PracticeRecorder = recorder/);
    assert.match(BRIDGE, /recorder\.destroy\(\)/);
    assert.match(BRIDGE, /win\.PracticeRecorder === recorder/);
    assert.match(BRIDGE, /delete win\.PracticeRecorder/);
  });

  test('boot requires the native recorder before the player starts', () => {
    assert.match(BOOT, /PracticeRecorder\?\.start/);
    assert.match(BOOT, /PracticeApp \+ native player \+ native recorder \+ native submission \+ native full-test state \+ API/);
  });

  test('practice routes funnel, Part 2, reset and terminal cleanup through the controller', () => {
    assert.match(PRACTICE, /function _getNativeRecorder\(\)/);
    assert.match(PRACTICE, /return _startNativeRecording\(nativeRecorder\)/);
    assert.match(PRACTICE, /onRecorded: _handleP2RecordedBlob/);
    assert.match(PRACTICE, /nativeRecorder\.reset\(\)/);
    assert.match(PRACTICE, /function _releaseRecorderResources\(\)/);
    assert.match(PRACTICE, /nativeRecorder\.destroy\(\)/);
    assert.match(PRACTICE, /new MediaRecorder\(_stream/);
  });

  test('all terminal result redirects are root-absolute on the nested Next route', () => {
    const resultTargets = [...PRACTICE.matchAll(/window\.location\.href\s*=\s*([^;]+);/g)]
      .map((match) => match[1])
      .filter((source) => source.includes('result.html'));
    assert.ok(resultTargets.length >= 3);
    for (const source of resultTargets) {
      assert.match(source, /['"]\/pages\/(?:full-test-)?result\.html/);
      assert.doesNotMatch(source, /api\.url|^\s*['"]result\.html/);
    }
  });
});
