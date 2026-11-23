'use client';

// ThresholdsProvider (ADMINIA-0074 FR-081; G09-T23): the one place admin pages
// read the operations thresholds from, GET /admin/settings/thresholds. No page
// keeps its own threshold number. While the read is pending or failed a value
// is null (unknown), never a guessed default. The Settings page calls
// `reload()` after a save so the frame shows the new values at once.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { getThresholds, type ThresholdItemWire } from '@/lib/admin-settings-api';
import { thresholdMap } from '@/lib/admin-settings-model.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

export type ThresholdsState = {
  status: 'off' | 'loading' | 'ready' | 'error';
  items: ThresholdItemWire[];
  /** key → value; null = not set, or not read yet. */
  values: Record<string, number | null>;
  reload: () => Promise<void>;
};

const OFF: ThresholdsState = { status: 'off', items: [], values: {}, reload: async () => undefined };
const ThresholdsContext = createContext<ThresholdsState>(OFF);

export function useThresholds(): ThresholdsState {
  return useContext(ThresholdsContext);
}

export function ThresholdsProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [status, setStatus] = useState<ThresholdsState['status']>(enabled ? 'loading' : 'off');
  const [items, setItems] = useState<ThresholdItemWire[]>([]);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    try {
      if (!await whenGlobalReady(() => !!window.api?.getWith, 'Admin API')) return;
      const body = await getThresholds();
      if (mine !== seq.current) return;
      setItems(Array.isArray(body?.items) ? body.items : []);
      setStatus('ready');
    } catch (caught) {
      if (mine !== seq.current) return;
      console.warn('[admin-frame] thresholds unavailable', caught);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (!enabled) { setStatus('off'); return undefined; }
    setStatus('loading');
    void reload();
    return () => { seq.current += 1; };
  }, [enabled, reload]);

  const value = useMemo<ThresholdsState>(() => ({
    status,
    items: status === 'ready' ? items : [],
    values: status === 'ready' ? thresholdMap(items) : {},
    reload,
  }), [status, items, reload]);

  return <ThresholdsContext.Provider value={value}>{children}</ThresholdsContext.Provider>;
}
