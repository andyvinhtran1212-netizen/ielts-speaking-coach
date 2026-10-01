'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/auth-provider';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type SourceState<T> = { status: 'loading' } | { status: 'error'; code: number } | { status: 'ready'; data: T };

export function useListeningSource<T>(path: string) {
  const { status, user } = useAuth();
  const [revision, setRevision] = useState(0);
  const scope = JSON.stringify([status, user?.id ?? null, path, revision]);
  const [slot, setSlot] = useState<{ scope: string | null; state: SourceState<T> }>({ scope: null, state: { status: 'loading' } });
  const retry = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (status === 'signed-out') { window.location.replace('/login'); return; }
    if (status !== 'signed-in' || !user?.id) return;
    const controller = new AbortController(); let active = true;
    setSlot({ scope, state: { status: 'loading' } });
    (async () => {
      const ready = await whenGlobalReady(() => !!window.api?.getWith, 'window.api (source collection)');
      if (!ready || !active) throw new Error('API chưa sẵn sàng');
      const data = await window.api.getWith<T>(path, undefined, { signal: controller.signal });
      if (active) setSlot({ scope, state: { status: 'ready', data } });
    })().catch((error: unknown) => {
      if (!active || (error instanceof DOMException && error.name === 'AbortError')) return;
      const code = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0;
      setSlot({ scope, state: { status: 'error', code } });
    });
    return () => { active = false; controller.abort(); };
  }, [path, scope, status, user?.id]);
  const state: SourceState<T> = status === 'signed-in' && user?.id && slot.scope === scope ? slot.state : { status: 'loading' };
  return { state, retry };
}
