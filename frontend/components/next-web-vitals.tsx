'use client';

import { useReportWebVitals } from 'next/web-vitals';
import { useCallback, useEffect, useRef } from 'react';

import { buildNextVitalsPayload } from '@/lib/next-vitals-model.mjs';

type WebVitalMetric = {
  id: string;
  name: string;
  value: number;
};

const LOADED_AT = Date.now();

export function NextWebVitals({
  apiBase,
  release,
}: {
  apiBase: string;
  release: string | null;
}) {
  // Core Web Vitals describe the initial document navigation. Keep that path
  // stable even if a later App Router transition occurs before CLS/INP settles.
  const initialPath = useRef<string | null>(null);
  useEffect(() => {
    if (initialPath.current === null) initialPath.current = window.location.pathname;
  }, []);
  const report = useCallback((metric: WebVitalMetric) => {
    const payload = buildNextVitalsPayload(metric, {
      path: initialPath.current || window.location.pathname,
      release,
      loadedAt: LOADED_AT,
      now: Date.now(),
      userAgent: window.navigator?.userAgent,
    });
    if (!payload) return;

    try {
      window.fetch(`${apiBase.replace(/\/$/, '')}/api/analytics/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      // Telemetry is best-effort and must never affect the learning surface.
    }
  }, [apiBase, release]);

  useReportWebVitals(report);
  return null;
}
