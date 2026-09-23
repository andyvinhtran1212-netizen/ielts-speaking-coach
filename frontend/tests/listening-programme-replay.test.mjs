import assert from 'node:assert/strict';
import test from 'node:test';

import { createProgrammeReplayController } from '../lib/listening-programme-replay.mjs';

function fakeAudio() {
  const listeners = new Set();
  return {
    currentTime: 0,
    pauses: 0,
    plays: 0,
    play() { this.plays += 1; return Promise.resolve(); },
    pause() { this.pauses += 1; },
    addEventListener(type, listener) { if (type === 'timeupdate') listeners.add(listener); },
    removeEventListener(type, listener) { if (type === 'timeupdate') listeners.delete(listener); },
    tick() { for (const listener of [...listeners]) listener(); },
    listenerCount() { return listeners.size; },
  };
}

test('switching to a later clip removes the earlier stop boundary', () => {
  const audio = fakeAudio();
  const controller = createProgrammeReplayController(() => audio);

  controller.replay({ start: 2, end: 8 });
  assert.equal(audio.listenerCount(), 1);
  controller.replay({ start: 20, end: 30 });
  assert.equal(audio.currentTime, 20);
  assert.equal(audio.listenerCount(), 1, 'the stale clip listener must be removed');

  audio.tick();
  assert.equal(audio.pauses, 0, 'the old end=8 listener must not stop the later clip');
  audio.currentTime = 30;
  audio.tick();
  assert.equal(audio.pauses, 1);
  assert.equal(audio.listenerCount(), 0);
});

test('audio rejection is returned as a retryable failure without a stale clip listener', async () => {
  const audio = fakeAudio();
  audio.play = () => Promise.reject(new Error('autoplay blocked'));
  const controller = createProgrammeReplayController(() => audio);
  assert.equal(await controller.replay({ start: 2, end: 8 }), false);
  assert.equal(audio.listenerCount(), 0);
});
