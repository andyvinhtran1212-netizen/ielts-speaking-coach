'use client';

import Script from 'next/script';
import { useState } from 'react';

export type RouteScriptSpec = Readonly<{
  src: string;
  type?: 'module';
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
}: {
  index: number;
  scripts: readonly RouteScriptSpec[];
}) {
  const [ready, setReady] = useState(false);
  const script = scripts[index];
  if (!script) return null;

  return (
    <>
      <Script
        src={script.src}
        type={script.type}
        strategy="afterInteractive"
        onReady={() => setReady(true)}
        onError={() => reportLoadFailure(script.src)}
      />
      {ready && index + 1 < scripts.length
        ? <RouteScriptStep index={index + 1} scripts={scripts} />
        : null}
    </>
  );
}

/**
 * Execute route-scoped globals in dependency order on both hard load and
 * App Router client navigation. Props are static, serializable route data;
 * executable callbacks stay inside this client boundary.
 */
export function RouteScriptChain({ scripts }: { scripts: readonly RouteScriptSpec[] }) {
  return scripts.length > 0 ? <RouteScriptStep index={0} scripts={scripts} /> : null;
}
