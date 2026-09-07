'use client';

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

type AverTelemetryWindow = Window & {
  aver?: {
    trackPageView?: () => void;
  };
};

/** Emit one page_view for every App Router pathname, including soft navigation. */
export function NextPageViewBeacon() {
  const pathname = usePathname();
  const [scriptReady, setScriptReady] = useState(false);

  useEffect(() => {
    if (!scriptReady) return;
    (window as AverTelemetryWindow).aver?.trackPageView?.();
  }, [pathname, scriptReady]);

  return (
    <Script
      src="/js/analytics-beacon.js"
      strategy="afterInteractive"
      onReady={() => setScriptReady(true)}
    />
  );
}
