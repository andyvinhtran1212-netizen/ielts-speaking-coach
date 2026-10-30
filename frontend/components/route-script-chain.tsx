'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';

export type RouteScriptSpec = Readonly<{
  src: string;
  type?: 'module';
  /** Keep loading later scripts when this optional dependency is unavailable. */
  continueOnError?: boolean;
}>;

function reportLoadFailure(src: string) {
  const message = `[route-script-chain] Không tải được ${src}`;
  try {
    const reporter = (window as any).aver?.reportError;
    if (typeof reporter === 'function') {
      reporter(message, { type: 'route_script_load_failed', src });
      return;
    }
  } catch (_) {
    // Reporting is best-effort; the dependent feature remains fail-closed.
  }
  console.error(message);
}

function reportScriptFailure(src: string) {
  if (src === '/js/runtime-config.js') {
    window.dispatchEvent(new CustomEvent('aver:runtime-config-failed', {
      detail: { src },
    }));
  }
}

function reportScriptReady(src: string) {
  if (src === '/js/runtime-config.js') {
    window.dispatchEvent(new Event('aver:runtime-config-ready'));
  }
}

type ScriptOutcome = 'loaded' | 'failed';

type ScriptEntry = {
  status: 'pending' | ScriptOutcome;
  /** A native listener on the injected element decides the outcome. */
  watched: boolean;
  waiters: Set<(outcome: ScriptOutcome) => void>;
};

// One entry per src for the lifetime of the document, shared by every chain.
// next/script injects a src once and, when a second <Script> with that src
// mounts while the first load is still in flight, only chains its onLoad:
// onReady never fires for the remounted step (PC-J280). Every step therefore
// waits on this registry instead of on its own <Script> callbacks.
const scriptRegistry = new Map<string, ScriptEntry>();

function settleScript(src: string, outcome: ScriptOutcome) {
  let entry = scriptRegistry.get(src);
  if (!entry) {
    entry = { status: outcome, watched: false, waiters: new Set() };
    scriptRegistry.set(src, entry);
    return;
  }
  if (entry.status !== 'pending') return;
  entry.status = outcome;
  const waiters = [...entry.waiters];
  entry.waiters.clear();
  waiters.forEach(waiter => waiter(outcome));
}

// next/script callbacks are the fallback for a src the registry has not
// watched yet (e.g. already loaded by a plain <Script> on an earlier route).
// Once an element is watched they are ignored: on a third mount during the
// same in-flight load next/script reports onReady before the script has run.
function settleFromNextScript(src: string, outcome: ScriptOutcome) {
  if (!scriptRegistry.get(src)?.watched) settleScript(src, outcome);
}

function watchScript(src: string): ScriptEntry {
  let entry = scriptRegistry.get(src);
  if (!entry) {
    entry = { status: 'pending', watched: false, waiters: new Set() };
    scriptRegistry.set(src, entry);
  }
  if (entry.status === 'pending' && !entry.watched) {
    const elements = Array.from(document.scripts)
      .filter(element => element.getAttribute('src') === src);
    for (const element of elements) {
      element.addEventListener('load', () => settleScript(src, 'loaded'), { once: true });
      element.addEventListener('error', () => settleScript(src, 'failed'), { once: true });
    }
    entry.watched = elements.length > 0;
  }
  return entry;
}

function RouteScriptStep({
  index,
  scripts,
  onComplete,
}: {
  index: number;
  scripts: readonly RouteScriptSpec[];
  onComplete?: () => void;
}) {
  const [outcome, setOutcome] = useState<ScriptOutcome | null>(null);
  const reported = useRef(false);
  const script = scripts[index];
  const src = script?.src;
  const ready = outcome === 'loaded' || (outcome === 'failed' && !!script?.continueOnError);

  // Runs after the child <Script> effect, so a first mount finds the element
  // next/script has just injected; a remount finds the registry entry.
  useEffect(() => {
    if (!src) return;
    const entry = watchScript(src);
    if (entry.status !== 'pending') {
      setOutcome(entry.status);
      return;
    }
    const waiter = (settled: ScriptOutcome) => setOutcome(settled);
    entry.waiters.add(waiter);
    return () => {
      entry.waiters.delete(waiter);
    };
  }, [src]);

  useEffect(() => {
    if (!src || !outcome || reported.current) return;
    reported.current = true;
    if (outcome === 'loaded') {
      reportScriptReady(src);
    } else {
      reportLoadFailure(src);
      reportScriptFailure(src);
    }
  }, [outcome, src]);

  useEffect(() => {
    if (ready && index + 1 === scripts.length) onComplete?.();
  }, [index, onComplete, ready, scripts.length]);

  if (!script) return null;

  return (
    <>
      <Script
        src={script.src}
        type={script.type}
        strategy="afterInteractive"
        onReady={() => settleFromNextScript(script.src, 'loaded')}
        onError={() => settleFromNextScript(script.src, 'failed')}
      />
      {ready && index + 1 < scripts.length
        ? <RouteScriptStep index={index + 1} scripts={scripts} onComplete={onComplete} />
        : null}
    </>
  );
}

/**
 * Execute route-scoped globals in dependency order on both hard load and
 * App Router client navigation. Props are static, serializable route data;
 * executable callbacks stay inside this client boundary.
 */
export function RouteScriptChain({
  scripts,
  onComplete,
}: {
  scripts: readonly RouteScriptSpec[];
  onComplete?: () => void;
}) {
  return scripts.length > 0
    ? <RouteScriptStep index={0} scripts={scripts} onComplete={onComplete} />
    : null;
}
