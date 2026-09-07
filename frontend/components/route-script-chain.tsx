'use client';

import Script from 'next/script';
import { useEffect, useState } from 'react';

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

function RouteScriptStep({
  index,
  scripts,
  onComplete,
}: {
  index: number;
  scripts: readonly RouteScriptSpec[];
  onComplete?: () => void;
}) {
  const [ready, setReady] = useState(false);
  const script = scripts[index];

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
        onReady={() => setReady(true)}
        onError={() => {
          reportLoadFailure(script.src);
          if (script.continueOnError) setReady(true);
        }}
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
