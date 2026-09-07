'use client';

import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import {
  RouteScriptChain,
  type RouteScriptSpec,
} from '@/components/route-script-chain';

const CLIENT_READY_TIMEOUT_MS = 10_000;
const CLIENT_POLL_INTERVAL_MS = 50;

function reportRuntimeFailure(message: string, error?: unknown) {
  try {
    const reporter = (window as any).aver?.reportError;
    if (typeof reporter === 'function') {
      reporter(message, {
        type: 'supabase_runtime_bootstrap_failed',
        detail: error instanceof Error ? error.message : String(error || ''),
      });
      return;
    }
  } catch (_) {
    // Reporting is best-effort; the runtime stays fail-closed below.
  }
  console.error(message, error || '');
}

/**
 * Loads the browser auth/API runtime in dependency order on hard loads and
 * App Router client navigation. Dependent route scripts remain unavailable
 * until api.js has created the single shared Supabase client.
 */
export function SupabaseRuntimeBoundary({
  scripts,
  supabaseUrl,
  supabaseAnonKey,
  children,
}: {
  scripts: readonly RouteScriptSpec[];
  supabaseUrl: string;
  supabaseAnonKey: string;
  children?: ReactNode;
}) {
  const [scriptsReady, setScriptsReady] = useState(false);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const markScriptsReady = useCallback(() => setScriptsReady(true), []);

  useEffect(() => {
    if (!scriptsReady) return undefined;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = performance.now();

    const finishWhenClientExists = () => {
      if (cancelled) return;
      const getClient = (window as any).getSupabase;
      const client = typeof getClient === 'function' ? getClient() : null;
      if (client) {
        setRuntimeReady(true);
        return;
      }
      if (performance.now() - startedAt >= CLIENT_READY_TIMEOUT_MS) {
        reportRuntimeFailure('Supabase runtime did not become ready before timeout.');
        return;
      }
      timer = setTimeout(finishWhenClientExists, CLIENT_POLL_INTERVAL_MS);
    };

    try {
      const init = (window as any).initSupabase;
      if (typeof init !== 'function') {
        reportRuntimeFailure('initSupabase is unavailable after api.js loaded.');
        return undefined;
      }
      init(supabaseUrl, supabaseAnonKey);
      finishWhenClientExists();
    } catch (error) {
      reportRuntimeFailure('Supabase runtime initialization failed.', error);
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [scriptsReady, supabaseAnonKey, supabaseUrl]);

  return (
    <>
      <RouteScriptChain scripts={scripts} onComplete={markScriptsReady} />
      {runtimeReady ? children : null}
    </>
  );
}
