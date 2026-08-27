'use client';

import { useEffect } from 'react';

const RUNTIME_SCRIPTS = [
  { src: '/js/speaking-debt.js', ready: (win: any) => Boolean(win.SpeakingDebt) },
  { src: '/js/practice.js', ready: (win: any) => typeof win.PracticeApp?.init === 'function' },
  {
    src: '/js/pronunciation-drilldown.js',
    ready: (win: any) => Boolean(win.PronunciationDrilldown),
  },
] as const;

function loadScript(src: string, ready: (win: any) => boolean) {
  if (ready(window)) return Promise.resolve();

  const selector = `script[data-practice-runtime="${src}"]`;
  const existing = document.querySelector<HTMLScriptElement>(selector);
  if (existing?.dataset.practiceRuntimeState === 'failed') {
    return Promise.reject(new Error(`practice-runtime-load-failed:${src}`));
  }

  return new Promise<void>((resolve, reject) => {
    const script = existing || document.createElement('script');
    const onLoad = () => {
      script.dataset.practiceRuntimeState = 'loaded';
      if (ready(window)) resolve();
      else reject(new Error(`practice-runtime-missing-global:${src}`));
    };
    const onError = () => {
      script.dataset.practiceRuntimeState = 'failed';
      reject(new Error(`practice-runtime-load-failed:${src}`));
    };
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    if (!existing) {
      script.src = src;
      script.async = false;
      script.dataset.practiceRuntime = src;
      document.head.appendChild(script);
    }
  });
}

/** Load route-owned legacy orchestration on both document and App Router entry. */
export function PracticeRuntimeScripts() {
  useEffect(() => {
    // Keep the tags and globals after unmount. PracticeApp.destroy() releases
    // attempt state; retaining definitions prevents duplicate evaluation when
    // the learner returns to the player through client navigation.
    void RUNTIME_SCRIPTS.reduce(
      (chain, script) => chain.then(() => loadScript(script.src, script.ready)),
      Promise.resolve(),
    ).catch((error) => {
      (window as any).aver?.reportError?.(String(error), {
        type: 'practice_runtime_script_failed',
      });
    });
  }, []);

  return null;
}
