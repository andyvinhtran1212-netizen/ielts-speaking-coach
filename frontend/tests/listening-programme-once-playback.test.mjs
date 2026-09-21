import assert from 'node:assert/strict';
import test from 'node:test';

import {
  confirmProgrammeOncePlayback,
  startProgrammeOncePlayback,
} from '../lib/listening-programme-once-playback.mjs';

test('a rejected browser play does not consume the canonical once claim', async () => {
  const calls = [];
  const audio = {
    play: async () => { calls.push('play'); throw new Error('autoplay rejected'); },
    pause: () => calls.push('pause'),
  };
  const result = await startProgrammeOncePlayback(audio, async () => {
    calls.push('ack');
    return true;
  });
  assert.deepEqual(calls, ['play']);
  assert.equal(result.state, 'ready');
});

test('playback is acknowledged only after the browser starts audio', async () => {
  const calls = [];
  const audio = {
    play: async () => { calls.push('play'); },
    pause: () => calls.push('pause'),
  };
  const result = await startProgrammeOncePlayback(audio, async () => {
    calls.push('ack');
    return true;
  });
  assert.deepEqual(calls, ['play', 'ack']);
  assert.equal(result.state, 'playing');
});

test('a lost acknowledgement is retried without replaying audio', async () => {
  const calls = [];
  const audio = {
    play: async () => { calls.push('play'); },
    pause: () => calls.push('pause'),
  };
  const first = await startProgrammeOncePlayback(audio, async () => {
    calls.push('ack-failed');
    throw new Error('network');
  });
  assert.equal(first.state, 'unconfirmed');
  const retry = await confirmProgrammeOncePlayback(audio, async () => {
    calls.push('ack-retry');
    return true;
  });
  assert.deepEqual(calls, ['play', 'ack-failed', 'pause', 'ack-retry']);
  assert.equal(retry.state, 'paused');
});
