import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// PC-J125 — review clips must stop within ±150 ms of `segment-end`, keep that
// bound after a mid-clip seek, and play a final clip (end at/after the media
// end) through to its end. The clock models a browser media element: time
// advances with the (fake) wall clock, native timeupdate is coarse (250 ms),
// seek events are asynchronous, and reaching `duration` ends playback; play()
// on ended media restarts at 0.
const TIMEUPDATE_MS = 250;
const TOLERANCE_S = 0.15;

class BrowserMediaClock extends EventTarget {
  static instances: BrowserMediaClock[] = [];
  paused = true;
  ended = false;
  duration = 40;
  src = '';
  preload = '';
  private position = 0;
  private started = 0;
  private rate = 1;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  /** Every media time at which playback stopped (pause or end). */
  stops: number[] = [];
  constructor() { super(); BrowserMediaClock.instances.push(this); }
  private raw() { return this.position + (!this.paused ? (Date.now() - this.started) / 1000 * this.rate : 0); }
  get currentTime() { return Math.min(this.duration, this.raw()); }
  set currentTime(value: number) {
    this.position = Math.max(0, Math.min(this.duration, value)); this.started = Date.now(); this.ended = false;
    this.armEnd();
    // Browsers fire seeking/seeked as later tasks, never inside the setter.
    setTimeout(() => { this.dispatchEvent(new Event('seeking')); this.dispatchEvent(new Event('seeked')); }, 0);
  }
  get playbackRate() { return this.rate; }
  set playbackRate(value: number) {
    this.position = this.currentTime; this.started = Date.now(); this.rate = value; this.armEnd();
    this.dispatchEvent(new Event('ratechange'));
  }
  play() {
    if (!this.paused) return Promise.resolve();
    if (this.ended || this.position >= this.duration) { this.position = 0; this.ended = false; }
    this.started = Date.now(); this.paused = false;
    this.ticker = setInterval(() => this.dispatchEvent(new Event('timeupdate')), TIMEUPDATE_MS);
    this.armEnd();
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  }
  pause() {
    if (this.paused) return;
    this.position = this.currentTime; this.paused = true; this.disarm(); this.stops.push(this.position);
    this.dispatchEvent(new Event('pause'));
  }
  load() { this.pause(); this.position = 0; this.ended = false; this.dispatchEvent(new Event('loadedmetadata')); }
  private disarm() {
    if (this.ticker) { clearInterval(this.ticker); this.ticker = null; }
    if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null; }
  }
  private armEnd() {
    if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null; }
    if (this.paused) return;
    const ms = Math.max(0, (this.duration - this.currentTime) / this.rate * 1000);
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

type Player = HTMLElement & { seekTo(value: number): void; pause(): void; play(): Promise<void>; getCurrentTime(): number | null };

beforeAll(async () => {
  vi.stubGlobal('Audio', BrowserMediaClock);
  await import('@/public/js/components/audio-player.js');
});
beforeEach(() => { vi.useFakeTimers(); BrowserMediaClock.instances = []; });
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); });

function mount() {
  const node = document.createElement('audio-player') as Player;
  node.setAttribute('src', '/fixture.mp3');
  document.body.append(node);
  return { node, audio: BrowserMediaClock.instances.at(-1)! };
}

// Same attribute sequence as listening-review-workspace.tsx `locate()`.
function locate(node: Player, start: number, end: number) {
  node.removeAttribute('auto-loop');
  node.setAttribute('segment-start', String(start));
  node.setAttribute('segment-end', String(end));
  node.seekTo(start);
}

describe('PC-J125 review clip end boundary (fake media clock)', () => {
  // B20-T1 Q1 / LIS-038 Q30 / LIS-025 Q40-shaped windows, scaled into a 40 s fixture.
  it.each([
    [2.5, 9.28, 1], [10.17, 13.84, 1], [20.46, 39.16, 1], [2.5, 9.28, 1.5], [2.5, 9.28, 0.75],
  ])('window %s–%s at %sx stops within ±150 ms of end', async (start, end, rate) => {
    const { node, audio } = mount();
    audio.playbackRate = rate;
    locate(node, start, end);
    await vi.advanceTimersByTimeAsync(((end - start) / rate) * 1000 + 2000);
    expect(audio.paused).toBe(true);
    expect(audio.stops).toHaveLength(1);
    expect(Math.abs(audio.stops[0] - end)).toBeLessThanOrEqual(TOLERANCE_S);
    expect(node.getCurrentTime()).toBe(end);
  });

  it('a seek inside the clip still stops at the same end', async () => {
    const { node, audio } = mount();
    locate(node, 2, 12);
    await vi.advanceTimersByTimeAsync(1300);
    (node.shadowRoot!.getElementById('scrub') as HTMLInputElement).value = '9.4';
    node.shadowRoot!.getElementById('scrub')!.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(audio.paused).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(audio.stops).toHaveLength(1);
    expect(Math.abs(audio.stops[0] - 12)).toBeLessThanOrEqual(TOLERANCE_S);
  });

  it('switching to another question mid-clip drops the earlier end', async () => {
    const { node, audio } = mount();
    locate(node, 2, 6);
    await vi.advanceTimersByTimeAsync(1000);
    locate(node, 20, 25);
    await vi.advanceTimersByTimeAsync(4500);
    expect(audio.paused).toBe(false);
    await vi.advanceTimersByTimeAsync(1500);
    expect(audio.stops).toHaveLength(1);
    expect(Math.abs(audio.stops[0] - 25)).toBeLessThanOrEqual(TOLERANCE_S);
  });

  it('a final clip whose end is the media end plays to the end, and replays from its start', async () => {
    const { node, audio } = mount();
    locate(node, 33.5, 40);
    await vi.advanceTimersByTimeAsync(6000);
    expect(audio.paused).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(audio.paused).toBe(true);
    expect(audio.stops).toEqual([40]);

    // Play again (player ▶ button): must restart the clip, not the whole recording.
    await node.play();
    expect(node.getCurrentTime()).toBe(33.5);
    await vi.advanceTimersByTimeAsync(7000);
    expect(audio.stops).toEqual([40, 40]);
  });

  it('a final clip whose stored end overshoots the media end still replays from its start', async () => {
    const { node, audio } = mount();
    locate(node, 34, 40.6);
    await vi.advanceTimersByTimeAsync(7000);
    expect(audio.stops).toEqual([40]);
    await node.play();
    expect(node.getCurrentTime()).toBe(34);
    await vi.advanceTimersByTimeAsync(7000);
    expect(audio.stops).toEqual([40, 40]);
  });
});
