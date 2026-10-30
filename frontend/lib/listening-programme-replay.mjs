import { SEGMENT_END_EPSILON_S, segmentStopDelayMs } from './media-segment-stop.mjs';

/**
 * Own the one active result-audio clip boundary. Switching directly to a
 * later question must remove the earlier clip boundary before seeking.
 *
 * Raw timeupdate (~250 ms) overshoots the clip end by up to a quarter second,
 * so the stop is a timer for the remaining media time that rechecks
 * currentTime when it fires (same approach as <audio-player> segment mode).
 * timeupdate stays as a fallback for throttled timers. A stored end past the
 * real media end is clamped to the duration, and `ended` releases the clip.
 *
 * @param {() => (HTMLAudioElement | null)} getAudio
 */
export function createProgrammeReplayController(getAudio) {
  /** @type {{ element: HTMLAudioElement, listeners: [string, () => void][], timer: ReturnType<typeof setTimeout> | null } | null} */
  let active = null;

  function clear() {
    if (!active) return;
    const { element, listeners, timer } = active;
    if (timer) clearTimeout(timer);
    for (const [type, listener] of listeners) element.removeEventListener(type, listener);
    active = null;
  }

  function arm(element, storedEnd) {
    const entry = { element, listeners: [], timer: null };
    const end = () => {
      const duration = Number(element.duration);
      return Number.isFinite(duration) && duration > 0 ? Math.min(storedEnd, duration) : storedEnd;
    };
    const cancelTimer = () => {
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = null;
    };
    const finish = () => {
      element.pause();
      if (active === entry) clear();
    };
    // True once the clip is over (and released).
    const check = () => {
      if (active !== entry) return true;
      if (element.currentTime < end() - SEGMENT_END_EPSILON_S) return false;
      finish();
      return true;
    };
    const schedule = () => {
      cancelTimer();
      if (active !== entry || element.paused || check()) return;
      entry.timer = setTimeout(() => {
        entry.timer = null;
        schedule();
      }, segmentStopDelayMs(element.currentTime, end(), element.playbackRate));
    };
    const seeked = () => { if (!check()) schedule(); };
    entry.listeners = [
      ['timeupdate', check],
      ['play', schedule],
      ['playing', schedule],
      ['ratechange', schedule],
      ['durationchange', schedule],
      ['seeking', cancelTimer],
      ['seeked', seeked],
      ['pause', cancelTimer],
      ['ended', finish],
    ];
    active = entry;
    for (const [type, listener] of entry.listeners) element.addEventListener(type, listener);
    return { entry, schedule };
  }

  function replay(window) {
    const element = getAudio();
    if (!element || window?.start == null) return Promise.resolve(false);
    clear();
    element.currentTime = Number(window.start);
    const armed = window.end == null ? null : arm(element, Number(window.end));
    return Promise.resolve(element.play()).then(() => {
      if (armed && active === armed.entry) armed.schedule();
      return true;
    }, () => {
      if (!armed || active === armed.entry) clear();
      return false;
    });
  }

  return { replay, dispose: clear };
}
