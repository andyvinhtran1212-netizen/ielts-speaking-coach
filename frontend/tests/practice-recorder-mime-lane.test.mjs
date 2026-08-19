// Safari 26's MediaRecorder claims webm/opus support but writes WebM with
// broken packet timestamps (Gate E real-device journey 2026-08-19: 90s take
// → 2.6s container / ~21s of frames / backend measured 45s). Real WebKit must
// record on the audio/mp4 lane. This suite pins BOTH the helper's behavior
// (executed with real UA strings) and the wire: every recorder site in
// practice.js must go through _mimeCandidates(), with no inline webm-first
// candidate list left behind.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import {
  SpeakingRecorderController,
  pickSpeakingRecorderMime,
} from '../lib/speaking-recorder-controller.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(path.join(root, 'public/js/practice.js'), 'utf8');

const fnMatch = SRC.match(/function _mimeCandidates\(\) \{[\s\S]*?\n  \}/);
assert.ok(fnMatch, 'practice.js must define _mimeCandidates()');

function candidatesFor(userAgent) {
  const ctx = { navigator: { userAgent } };
  vm.createContext(ctx);
  return vm.runInContext(`(${fnMatch[0].replace('function _mimeCandidates()', 'function ()')})()`, ctx);
}

const SAFARI_26_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15';
const SAFARI_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1';
const CHROME_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/139.0.0.0 Mobile/15E148 Safari/604.1';
const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
const EDGE_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0';

describe('recorder MIME lane per engine', () => {
  test('real WebKit records on the audio/mp4 lane first', () => {
    for (const ua of [SAFARI_26_MAC, SAFARI_IOS, CHROME_IOS]) {
      assert.equal(candidatesFor(ua)[0], 'audio/mp4', ua);
    }
  });

  test('Chromium-family keeps webm/opus first with mp4 as final fallback', () => {
    for (const ua of [CHROME_MAC, EDGE_WIN]) {
      const c = candidatesFor(ua);
      assert.equal(c[0], 'audio/webm;codecs=opus', ua);
      assert.equal(c[c.length - 1], 'audio/mp4', ua);
    }
  });

  test('every candidate list still offers all four containers', () => {
    for (const ua of [SAFARI_26_MAC, CHROME_MAC]) {
      assert.deepEqual([...candidatesFor(ua)].sort(), [
        'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/webm;codecs=opus',
      ]);
    }
  });
});

describe('the wire: both recorder sites use the shared helper', () => {
  test('exactly two recorder call sites and no inline webm-first list', () => {
    const calls = SRC.match(/var candidates = _mimeCandidates\(\);/g) || [];
    assert.equal(calls.length, 2, 'both recorder setups must call _mimeCandidates()');
    const inline = SRC.match(/candidates = \['audio\/webm/g) || [];
    assert.equal(inline.length, 0, 'no recorder may keep a webm-first literal');
  });

  test('upload path maps audio/mp4 to a Whisper-safe filename', () => {
    assert.match(SRC, /'audio\/mp4': 'm4a'/);
  });
});

// The Next /practice/session route records through PracticeRecorderBridge →
// SpeakingRecorderController, NOT through practice.js's inline recorder
// (review #1261 P1: the first fix round covered only the legacy sites).
// Pin the native path with the SHIPPED module, end to end through start().
describe('the wire: native SpeakingRecorderController lane', () => {
  class OmniRecorder {
    static instances = [];
    static isTypeSupported() { return true; }
    constructor(stream, options = {}) {
      this.stream = stream;
      this.mimeType = options.mimeType || '';
      this.state = 'inactive';
      this.ondataavailable = null;
      this.onstop = null;
      OmniRecorder.instances.push(this);
    }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; if (this.onstop) this.onstop(); }
  }

  test('pickSpeakingRecorderMime is engine-aware', () => {
    assert.equal(pickSpeakingRecorderMime(OmniRecorder, SAFARI_26_MAC), 'audio/mp4');
    assert.equal(pickSpeakingRecorderMime(OmniRecorder, SAFARI_IOS), 'audio/mp4');
    assert.equal(pickSpeakingRecorderMime(OmniRecorder, CHROME_IOS), 'audio/mp4');
    assert.equal(pickSpeakingRecorderMime(OmniRecorder, CHROME_MAC), 'audio/webm;codecs=opus');
    assert.equal(pickSpeakingRecorderMime(OmniRecorder, EDGE_WIN), 'audio/webm;codecs=opus');
  });

  test('a controller started under a Safari UA constructs MediaRecorder with audio/mp4', async () => {
    for (const [ua, expected] of [
      [SAFARI_26_MAC, 'audio/mp4'],
      [CHROME_MAC, 'audio/webm;codecs=opus'],
    ]) {
      OmniRecorder.instances.length = 0;
      const track = { stop() {} };
      const controller = new SpeakingRecorderController({
        userAgent: ua,
        mediaDevices: { getUserMedia: async () => ({ active: true, getTracks: () => [track] }) },
        MediaRecorderCtor: OmniRecorder,
        AudioContextCtor: function () { throw new Error('no audio ctx in node'); },
        BlobCtor: globalThis.Blob,
        setIntervalFn: () => 1,
        clearIntervalFn: () => {},
      });
      await controller.start({});
      assert.equal(OmniRecorder.instances.length, 1, ua);
      assert.equal(OmniRecorder.instances[0].mimeType, expected, ua);
      controller.reset();
    }
  });

  test('the bridge leaves the environment default so the real browser UA decides', () => {
    const bridge = readFileSync(
      path.join(root, 'app/(authed-practice)/practice/session/practice-recorder-bridge.tsx'), 'utf8');
    assert.match(bridge, /new SpeakingRecorderController\(\)/);
  });
});
