// Shared clip-end scheduling for <audio-player> segment mode and the
// 80-days programme replay (lib/listening-programme-replay.mjs). Native
// timeupdate arrives every ~250 ms, too coarse for a ±150 ms clip end, so
// callers arm a timer for the remaining media time and recheck currentTime
// when it fires.

/**
 * Media time within this distance of the end counts as the end.
 * <audio-player> keeps the literal 0.01 (pinned by tests/audio-player.test.mjs).
 */
export const SEGMENT_END_EPSILON_S = 0.01;

/**
 * Wall-clock delay until `end` at the current playback rate.
 *
 * @param {number} currentTime
 * @param {number} end
 * @param {number} playbackRate
 */
export function segmentStopDelayMs(currentTime, end, playbackRate) {
  const rate = Math.max(0.1, Number(playbackRate) || 1);
  return Math.max(16, (end - currentTime) / rate * 1000);
}
