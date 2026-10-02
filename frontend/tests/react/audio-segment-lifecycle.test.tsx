import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

class MediaClock extends EventTarget {
  static instances: MediaClock[] = [];
  paused = true;
  duration = 30;
  src = '';
  preload = '';
  volume = 1;
  buffering = false;
  private position = 0;
  private started = 0;
  private rate = 1;
  constructor() { super(); MediaClock.instances.push(this); }
  get currentTime() { return this.position + (!this.paused && !this.buffering ? (Date.now() - this.started) / 1000 * this.rate : 0); }
  set currentTime(value: number) {
    this.position = value; this.started = Date.now();
    this.dispatchEvent(new Event('seeking')); this.dispatchEvent(new Event('seeked'));
  }
  get playbackRate() { return this.rate; }
  set playbackRate(value: number) {
    this.position = this.currentTime; this.started = Date.now(); this.rate = value;
    this.dispatchEvent(new Event('ratechange'));
  }
  play() {
    if (!this.paused) return Promise.resolve();
    this.started = Date.now(); this.paused = false; this.dispatchEvent(new Event('play')); return Promise.resolve();
  }
  pause() { this.position = this.currentTime; this.paused = true; this.dispatchEvent(new Event('pause')); }
  load() { this.pause(); this.position = 0; this.dispatchEvent(new Event('loadedmetadata')); }
}

beforeAll(async () => {
  vi.stubGlobal('Audio', MediaClock);
  await import('@/public/js/components/audio-player.js');
});
beforeEach(() => { vi.useFakeTimers(); MediaClock.instances = []; });
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); });
function player(start = 2, end = 3) {
  const node = document.createElement('audio-player') as HTMLElement & { seekTo(value: number): void; pause(): void; play(): Promise<void>; getCurrentTime(): number };
  node.setAttribute('src', '/fixture.wav'); node.setAttribute('segment-start', String(start)); node.setAttribute('segment-end', String(end));
  document.body.append(node);
  return { node, audio: MediaClock.instances.at(-1)! };
}

describe('shared audio player segment lifecycle without timeupdate polling', () => {
  it.each([0.75, 1, 1.25, 1.5])('stops exactly at the bound at %sx and replay starts the segment', async (rate) => {
    const { node, audio } = player(); audio.playbackRate = rate; node.seekTo(2);
    await vi.advanceTimersByTimeAsync(1600);
    expect(audio.paused).toBe(true); expect(node.getCurrentTime()).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
    await node.play(); expect(node.getCurrentTime()).toBe(2);
    node.pause(); expect(vi.getTimerCount()).toBe(0);
  });

  it('reschedules on rate changes and clamps a seek beyond end even while paused', async () => {
    const { node, audio } = player(2, 4); node.seekTo(2);
    await vi.advanceTimersByTimeAsync(1000); audio.playbackRate = 1.5;
    await vi.advanceTimersByTimeAsync(700);
    expect(audio.paused).toBe(true); expect(node.getCurrentTime()).toBe(4);
    audio.currentTime = 9;
    expect(node.getCurrentTime()).toBe(4); expect(audio.paused).toBe(true);
  });

  it('keeps the precise endpoint when play is called again during playback without a new native event', async () => {
    const { node, audio } = player(); node.seekTo(2);
    await vi.advanceTimersByTimeAsync(300);
    await node.play();
    expect(node.getCurrentTime()).toBeCloseTo(2.3);
    await vi.advanceTimersByTimeAsync(700);
    expect(audio.paused).toBe(true); expect(node.getCurrentTime()).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rapid segment changes cancel the old boundary, continuous mode clears bounds', async () => {
    const { node, audio } = player(); node.seekTo(2);
    await vi.advanceTimersByTimeAsync(100);
    node.setAttribute('segment-start', '8'); node.setAttribute('segment-end', '10'); node.seekTo(8);
    await vi.advanceTimersByTimeAsync(1000);
    expect(audio.paused).toBe(false); expect(node.getCurrentTime()).toBe(9);
    node.removeAttribute('segment-start'); node.removeAttribute('segment-end'); node.seekTo(8);
    await vi.advanceTimersByTimeAsync(3000);
    expect(audio.paused).toBe(false); expect(node.getCurrentTime()).toBe(11);
    expect(node.shadowRoot?.querySelector<HTMLInputElement>('#scrub')?.max).toBe('30');
  });

  it('does not end early while buffering', async () => {
    const { node, audio } = player(); audio.buffering = true; node.seekTo(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(audio.paused).toBe(false); expect(node.getCurrentTime()).toBe(2);
    audio.buffering = false; audio.currentTime = 2;
    await vi.advanceTimersByTimeAsync(1000);
    expect(audio.paused).toBe(true); expect(node.getCurrentTime()).toBe(3);
  });

  it.each(['remove-loop', 'new-segment', 'pause', 'source', 'unmount'])('cancels a pending loop on %s', async (action) => {
    const { node, audio } = player(); node.setAttribute('auto-loop', 'true'); node.seekTo(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(audio.paused).toBe(true); expect(vi.getTimerCount()).toBe(1);
    if (action === 'remove-loop') node.removeAttribute('auto-loop');
    if (action === 'new-segment') node.setAttribute('segment-end', '4');
    if (action === 'pause') node.pause();
    if (action === 'source') node.setAttribute('src', '/new.wav');
    if (action === 'unmount') node.remove();
    await vi.advanceTimersByTimeAsync(600);
    expect(audio.paused).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['#btn-replay', '#btn-play'])('manual %s cancels the old loop instead of rewinding playback again', async (button) => {
    const { node, audio } = player(); node.setAttribute('auto-loop', 'true'); node.seekTo(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(audio.paused).toBe(true); expect(vi.getTimerCount()).toBe(1);
    node.shadowRoot?.querySelector<HTMLButtonElement>(button)?.click();
    await vi.advanceTimersByTimeAsync(550);
    expect(audio.paused).toBe(false); expect(node.getCurrentTime()).toBeCloseTo(2.55);
  });

  it('manual scrubbing cancels the pending loop and stays paused at the chosen position', async () => {
    const { node, audio } = player(); node.setAttribute('auto-loop', 'true'); node.seekTo(2);
    await vi.advanceTimersByTimeAsync(1000);
    const scrub = node.shadowRoot!.querySelector<HTMLInputElement>('#scrub')!;
    scrub.value = '2.4'; scrub.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(600);
    expect(audio.paused).toBe(true); expect(node.getCurrentTime()).toBeCloseTo(2.4);
    expect(vi.getTimerCount()).toBe(0);
  });
});
