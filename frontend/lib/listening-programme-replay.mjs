/**
 * Own the one active result-audio stop listener. Switching directly to a
 * later question must remove the earlier clip boundary before seeking.
 *
 * @param {() => (HTMLAudioElement | null)} getAudio
 */
export function createProgrammeReplayController(getAudio) {
  /** @type {HTMLAudioElement | null} */
  let activeAudio = null;
  /** @type {(() => void) | null} */
  let activeStop = null;

  function clear() {
    if (activeAudio && activeStop) {
      activeAudio.removeEventListener('timeupdate', activeStop);
    }
    activeAudio = null;
    activeStop = null;
  }

  function replay(window) {
    const element = getAudio();
    if (!element || window?.start == null) return Promise.resolve(false);
    clear();
    element.currentTime = Number(window.start);
    const started = Promise.resolve(element.play()).then(() => true, () => {
      clear();
      return false;
    });
    if (window.end == null) return started;

    const end = Number(window.end);
    const stop = () => {
      if (element.currentTime < end) return;
      element.pause();
      if (activeStop === stop) clear();
    };
    activeAudio = element;
    activeStop = stop;
    element.addEventListener('timeupdate', stop);
    return started;
  }

  return { replay, dispose: clear };
}
