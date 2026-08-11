import { SpeakingPlayerController } from './speaking-player-controller.mjs';

export function installPracticePlayerController(browser = globalThis) {
  const controller = new SpeakingPlayerController({
    document: browser.document,
    urlApi: browser.URL,
    speechSynthesis: browser.speechSynthesis,
    setIntervalFn: browser.setInterval.bind(browser),
    clearIntervalFn: browser.clearInterval.bind(browser),
    setTimeoutFn: browser.setTimeout.bind(browser),
    clearTimeoutFn: browser.clearTimeout.bind(browser),
    // App Router renders the active state from the controller snapshot. The
    // default controller path still mutates classes for the legacy page.
    domStateActivation: false,
  });
  browser.PracticePlayer = controller;
  let cleaned = false;

  return {
    controller,
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      // PracticeApp.destroy() is idempotent and releases references to this
      // bridge-owned controller before StrictMode installs the replacement.
      browser.PracticeApp?.destroy?.();
      controller.destroy();
      if (browser.PracticePlayer === controller) delete browser.PracticePlayer;
    },
  };
}
