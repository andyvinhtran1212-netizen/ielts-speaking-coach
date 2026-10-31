import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createProgrammeReplayController } from '@/lib/listening-programme-replay.mjs';

// PC-J208 — the 80-days programme replay must stop within ±150 ms of the clip
// end (target ≤ 50 ms). The clock models a browser media element: time
// advances with the (fake) wall clock, native timeupdate is coarse (250 ms),
// play/pause/seek events are later tasks, a seek holds playback until
// `seeked`, buffering can stall the clock, and reaching `duration` ends
// playback; play() on ended media restarts at 0.
const TIMEUPDATE_MS = 250;
const SEEK_MS = 40;
const TOLERANCE_S = 0.15;
const TARGET_S = 0.05;

class MediaClock extends EventTarget {
  paused = true;
  ended = false;
  duration = 40;
  private position = 0;
  private anchor = 0;
  private holdUntil = 0;
  private rate = 1;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  private listenerCounts = new Map<string, number>();
  /** Every media time at which playback stopped (pause or end). */
  stops: number[] = [];

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    this.listenerCounts.set(type, (this.listenerCounts.get(type) || 0) + 1);
    super.addEventListener(type, listener, options);
  }
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
    this.listenerCounts.set(type, (this.listenerCounts.get(type) || 0) - 1);
    super.removeEventListener(type, listener, options);
  }
  listeners() { return [...this.listenerCounts.values()].reduce((sum, count) => sum + count, 0); }

  private later(type: string, ms = 0) { setTimeout(() => this.dispatchEvent(new Event(type)), ms); }
  private raw() {
    if (this.paused) return this.position;
    return this.position + Math.max(0, Date.now() - Math.max(this.anchor, this.holdUntil)) / 1000 * this.rate;
  }
  get currentTime() { return Math.min(this.duration, this.raw()); }
  set currentTime(value: number) {
    this.position = Math.max(0, Math.min(this.duration, value));
    this.anchor = Date.now();
    this.holdUntil = this.anchor + SEEK_MS;
    this.ended = false;
    this.armEnd();
    // Browsers fire seeking/seeked as later tasks, never inside the setter.
    this.later('seeking');
    setTimeout(() => {
      this.dispatchEvent(new Event('seeked'));
      if (!this.paused) this.dispatchEvent(new Event('playing'));
    }, SEEK_MS);
  }
  get playbackRate() { return this.rate; }
  set playbackRate(value: number) {
    this.position = this.currentTime; this.anchor = Date.now(); this.rate = value; this.armEnd();
    this.later('ratechange');
  }
  /** Buffering: media time stops advancing for `ms`. */
  stall(ms: number) {
    this.position = this.currentTime; this.anchor = Date.now(); this.holdUntil = this.anchor + ms; this.armEnd();
    this.later('waiting');
    this.later('playing', ms);
  }
  play() {
    if (!this.paused) return Promise.resolve();
    if (this.ended || this.position >= this.duration) { this.position = 0; this.ended = false; }
    this.anchor = Date.now(); this.paused = false;
    this.ticker = setInterval(() => this.dispatchEvent(new Event('timeupdate')), TIMEUPDATE_MS);
    this.armEnd();
    this.later('play');
    return Promise.resolve();
  }
  pause() {
    if (this.paused) return;
    this.position = this.currentTime; this.paused = true; this.disarm(); this.stops.push(this.position);
    this.later('pause');
  }
  private disarm() {
    if (this.ticker) { clearInterval(this.ticker); this.ticker = null; }
    if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null; }
  }
  private armEnd() {
    if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null; }
    if (this.paused) return;
    const hold = Math.max(0, this.holdUntil - Date.now());
    const ms = hold + Math.max(0, (this.duration - this.currentTime) / this.rate * 1000);
    this.endTimer = setTimeout(() => {
      this.endTimer = null;
      this.position = this.duration; this.paused = true; this.ended = true;
      this.disarm(); this.stops.push(this.position);
      this.dispatchEvent(new Event('timeupdate'));
      this.dispatchEvent(new Event('pause'));
      this.dispatchEvent(new Event('ended'));
    }, ms);
  }
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function setup() {
  const audio = new MediaClock();
  const controller = createProgrammeReplayController(() => audio as unknown as HTMLAudioElement);
  return { audio, controller };
}

describe('PC-J208 programme replay clip end (fake media clock)', () => {
  // B20-T1 Q1 / LIS-038 Q30 / LIS-025 Q40-shaped windows, scaled into a 40 s fixture.
  // 2.5–9.28 at 1x is the raw-timeupdate negative control: its end falls just
  // after a 250 ms tick, so a timeupdate-only stop lands ~+180 ms late.
  it.each([
    [2.5, 9.28, 1], [10.17, 13.84, 1], [20.46, 39.16, 1], [2.5, 9.28, 1.5], [2.5, 9.28, 0.75],
  ])('window %s–%s at %sx stops within ±150 ms (target 50 ms) of end', async (start, end, rate) => {
    const { audio, controller } = setup();
    audio.playbackRate = rate;
    expect(await controller.replay({ start, end })).toBe(true);
    await vi.advanceTimersByTimeAsync(((end - start) / rate) * 1000 + 2000);
    expect(audio.paused).toBe(true);
    expect(audio.stops).toHaveLength(1);
    expect(Math.abs(audio.stops[0] - end)).toBeLessThanOrEqual(TOLERANCE_S);
    expect(Math.abs(audio.stops[0] - end)).toBeLessThanOrEqual(TARGET_S);
    expect(audio.listeners()).toBe(0);
  });

  it('a seek inside the clip (native controls) still stops at the same end', async () => {
    const { audio, controller } = setup();
    await controller.replay({ start: 2, end: 12 });
    await vi.advanceTimersByTimeAsync(1300);
    audio.currentTime = 9.4;
    await vi.advanceTimersByTimeAsync(1000);
    expect(audio.paused).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(audio.stops).toHaveLength(1);
    expect(Math.abs(audio.stops[0] - 12)).toBeLessThanOrEqual(TARGET_S);
  });

  it('a buffering stall rechecks media time instead of stopping early', async () => {
    const { audio, controller } = setup();
    await controller.replay({ start: 5, end: 9 });
    await vi.advanceTimersByTimeAsync(2000);
    audio.stall(700);
    // The wall-clock timer armed before the stall would expire around here.
    await vi.advanceTimersByTimeAsync(2100);
    expect(audio.paused).toBe(false);
    expect(audio.currentTime).toBeLessThan(9);
    await vi.advanceTimersByTimeAsync(1500);
    expect(audio.stops).toHaveLength(1);
    expect(Math.abs(audio.stops[0] - 9)).toBeLessThanOrEqual(TARGET_S);
  });

  it('a user pause keeps the clip end for the resumed playback', async () => {
    const { audio, controller } = setup();
    await controller.replay({ start: 3, end: 8 });
    await vi.advanceTimersByTimeAsync(2000);
    audio.pause();
    await vi.advanceTimersByTimeAsync(5000);
    expect(audio.stops).toHaveLength(1);
    await audio.play();
    await vi.advanceTimersByTimeAsync(4000);
    expect(audio.stops).toHaveLength(2);
    expect(Math.abs(audio.stops[1] - 8)).toBeLessThanOrEqual(TARGET_S);
  });

  it('switching to a later question mid-clip drops the earlier end and timer', async () => {
    const { audio, controller } = setup();
    await controller.replay({ start: 2, end: 6 });
    await vi.advanceTimersByTimeAsync(1000);
    await controller.replay({ start: 20, end: 25 });
    await vi.advanceTimersByTimeAsync(4500);
    expect(audio.paused).toBe(false);
    await vi.advanceTimersByTimeAsync(1500);
    expect(audio.stops).toHaveLength(1);
    expect(Math.abs(audio.stops[0] - 25)).toBeLessThanOrEqual(TARGET_S);
  });

  it('a stored end past the media end stops at the real duration and `ended` releases the clip', async () => {
    const { audio, controller } = setup();
    await controller.replay({ start: 34, end: 40.6 });
    await vi.advanceTimersByTimeAsync(7000);
    expect(audio.ended).toBe(true);
    expect(audio.stops).toEqual([40]);
    expect(audio.listeners(), 'no clip boundary may outlive the media end').toBe(0);
    // The learner restarts the whole recording from the native controls.
    await audio.play();
    await vi.advanceTimersByTimeAsync(3000);
    expect(audio.paused).toBe(false);
    expect(audio.stops).toEqual([40]);
  });
});
