'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AttemptReviewFlagError, REVIEW_FLAG_CONFLICT_MESSAGE, createAttemptFlagCoordinator } from './attempt-review-flags.mjs';
import type { components } from '@/types/api';
import { registerNavigationGuard } from './navigation-guard';

type FlagView = {
  scope: string;
  ready: boolean;
  flagged: Set<number>;
  states: Map<number, 'pending' | 'retrying' | 'failed'>;
  error: string;
};
const empty = (scope: string): FlagView => ({ scope, ready: false, flagged: new Set(), states: new Map(), error: '' });
const loadErrorMessage = (error: unknown) => error instanceof AttemptReviewFlagError
  ? error.message : 'Chưa tải được các câu đã đánh dấu xem lại. Bạn hãy kiểm tra kết nối mạng rồi bấm Thử lại.';

export function useAttemptReviewFlags({
  attemptId, domain, ownerScope, enabled, headers,
}: {
  attemptId?: string;
  domain: 'reading' | 'listening';
  ownerScope: string;
  enabled: boolean;
  headers?: () => Record<string, string> | undefined;
}) {
  const scope = `${ownerScope}:${domain}:${attemptId || ''}`;
  const [view, setView] = useState<FlagView>(() => empty(scope));
  const active = useRef<{ scope: string; coordinator: ReturnType<typeof createAttemptFlagCoordinator> } | null>(null);

  useEffect(() => {
    setView(empty(scope));
    if (!attemptId || !enabled) return;
    let disposed = false;
    const storageKey = `aver:review-flags:${scope}`;
    let restoredPending: unknown = [];
    try { restoredPending = JSON.parse(sessionStorage.getItem(storageKey) || '[]'); } catch {}
    const path = domain === 'reading'
      ? `/api/reading/test/attempts/${encodeURIComponent(attemptId)}/review-flags`
      : `/api/listening/tests/attempts/${encodeURIComponent(attemptId)}/review-flags`;
    const coordinator = createAttemptFlagCoordinator({
      attemptId,
      restoredPending: Array.isArray(restoredPending) ? restoredPending : [],
      read: () => window.api.getWith<components['schemas']['ReviewFlagStateResponse']>(path, headers?.(), { noRedirect: true }),
      write: (body: components['schemas']['ReviewFlagPatchRequest'], options: { keepalive?: boolean; signal?: AbortSignal }) => window.api.patchWith<components['schemas']['ReviewFlagWriteResponse']>(
        path, body, headers?.(), { noRedirect: true, keepalive: !!options.keepalive, signal: options.signal },
      ),
    });
    active.current = { scope, coordinator };
    const unsubscribe = coordinator.subscribe((snapshot: any) => {
      if (disposed) return;
      let error = snapshot.conflict ? REVIEW_FLAG_CONFLICT_MESSAGE : '';
      try {
        if (snapshot.pending.length) sessionStorage.setItem(storageKey, JSON.stringify(snapshot.pending));
        else sessionStorage.removeItem(storageKey);
      } catch {
        if (snapshot.pending.length && !error) error = 'Chưa lưu xong các câu đã đánh dấu xem lại. Bạn hãy giữ tab này mở để thử lưu lại.';
      }
      setView({ scope, ready: snapshot.ready, flagged: snapshot.flagged, states: snapshot.states, error });
    });
    const load = () => coordinator.load().catch((error: unknown) => {
      if (!disposed) setView((previous) => ({ ...previous, error: loadErrorMessage(error) }));
    });
    void load();
    const flushPage = () => { void coordinator.flush({ keepalive: true }); };
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      if (!coordinator.snapshot().states.size) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const reconcile = () => {
      if (document.visibilityState === 'hidden') void coordinator.flush();
      else void load();
    };
    window.addEventListener('pagehide', flushPage);
    const unregisterGuard = registerNavigationGuard(warnUnsaved);
    document.addEventListener('visibilitychange', reconcile);
    return () => {
      disposed = true;
      unsubscribe();
      coordinator.dispose();
      if (active.current?.coordinator === coordinator) active.current = null;
      window.removeEventListener('pagehide', flushPage);
      unregisterGuard();
      document.removeEventListener('visibilitychange', reconcile);
    };
  }, [attemptId, domain, enabled, headers, scope]);

  const current = view.scope === scope && enabled ? view : empty(scope);
  const toggle = useCallback((qNum: number) => {
    const bound = active.current;
    if (!enabled || bound?.scope !== scope || !bound.coordinator.snapshot().ready) return;
    bound.coordinator.update(qNum, !bound.coordinator.snapshot().flagged.has(qNum));
  }, [enabled, scope]);
  const retry = useCallback(() => {
    const bound = active.current;
    if (!enabled || bound?.scope !== scope) return;
    if (!bound.coordinator.snapshot().ready) {
      void bound.coordinator.load().catch((error: unknown) => {
        if (active.current === bound) setView((previous) => ({ ...previous, error: loadErrorMessage(error) }));
      });
    } else bound.coordinator.retryFailed();
  }, [enabled, scope]);
  const flush = useCallback(() => active.current?.scope === scope ? active.current.coordinator.flush() : Promise.resolve(true), [scope]);
  return { ...current, toggle, retry, flush };
}
