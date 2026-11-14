'use client';

import { useEffect, useState } from 'react';
import { getBrowserJson } from '@/lib/browser-api';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';
import { readCuratedAvailability } from '@/public/js/curated-availability.js';

export function CuratedAvailabilityBadge() {
  const [state, setState] = useState('loading');
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        if (!await whenGlobalReady(() => !!window.api?.getWith, 'window.api')) throw new Error('API unavailable');
        if (controller.signal.aborted) return;
        const next = await readCuratedAvailability(() => getBrowserJson(
          '/admin/vocabulary/curated-availability', undefined, controller.signal,
        ));
        if (!controller.signal.aborted) setState(next);
      } catch {
        if (!controller.signal.aborted) setState('error');
      }
    })();
    return () => controller.abort();
  }, []);
  return <span role="status">{state === 'unavailable' ? 'Chưa khả dụng' : state === 'error' ? 'Không kiểm tra được khả dụng' : 'PILOT'}</span>;
}
