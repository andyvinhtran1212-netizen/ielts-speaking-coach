'use client';

import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import {
  RouteScriptChain,
} from '@/components/route-script-chain';

const PRE_CLIENT_SCRIPTS = [
  { src: '/js/runtime-config.js' },
  { src: '/js/error-reporter.js', continueOnError: true },
] as const;
const API_BRIDGE_SCRIPTS = [{ src: '/js/api.js' }] as const;

// supabase-js is ~60 KB gzipped and nothing calls it before runtime-config.js
// and error-reporter.js have loaded, so it is a separate chunk instead of part
// of the hydration bundle. The import starts on mount, parallel to that chain.
// Routes that import the module statically (AuthProvider) share the same
// module instance, so there is still exactly one client.
const loadSupabaseBrowser = () => import('@/lib/supabase-browser');

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
 * Loads runtime config, creates the one bundled ESM Supabase client, then lets
 * api.js adopt it for routes that still use the compatibility transport.
 * Dependent scripts stay unavailable until that identity check succeeds.
 */
export function SupabaseRuntimeBoundary({
  supabaseUrl,
  supabaseAnonKey,
  children,
}: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  children?: ReactNode;
}) {
  const [bootstrapReady, setBootstrapReady] = useState(false);
  const [clientReady, setClientReady] = useState(false);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const markBootstrapReady = useCallback(() => setBootstrapReady(true), []);
  const markBridgeReady = useCallback(() => {
    try {
      const init = window.initSupabase;
      const expected = window.__AVER_SUPABASE_CLIENT__;
      if (typeof init !== 'function' || !expected) {
        reportRuntimeFailure('Supabase compatibility bridge is unavailable after api.js loaded.');
        return;
      }
      const adopted = init(supabaseUrl, supabaseAnonKey);
      if (adopted !== expected || window.getSupabase?.() !== expected) {
        reportRuntimeFailure('Supabase compatibility bridge did not adopt the ESM client.');
        return;
      }
      setRuntimeReady(true);
    } catch (error) {
      reportRuntimeFailure('Supabase compatibility bridge initialization failed.', error);
    }
  }, [supabaseAnonKey, supabaseUrl]);

  // Start the chunk download now; a load failure is reported by the effect
  // below once the bootstrap scripts are ready.
  useEffect(() => {
    void loadSupabaseBrowser().catch(() => {});
  }, []);

  useEffect(() => {
    if (!bootstrapReady) return;
    let cancelled = false;
    loadSupabaseBrowser().then(({ exposeLegacySupabaseClient, getBrowserSupabase }) => {
      if (cancelled) return;
      try {
        const client = getBrowserSupabase(supabaseUrl, supabaseAnonKey);
        exposeLegacySupabaseClient(client);
        setClientReady(true);
      } catch (error) {
        reportRuntimeFailure('Supabase ESM client initialization failed.', error);
      }
    }, (error) => {
      if (!cancelled) reportRuntimeFailure('Supabase ESM client failed to load.', error);
    });
    return () => {
      cancelled = true;
    };
  }, [bootstrapReady, supabaseAnonKey, supabaseUrl]);

  return (
    <>
      <RouteScriptChain scripts={PRE_CLIENT_SCRIPTS} onComplete={markBootstrapReady} />
      {clientReady && (
        <RouteScriptChain scripts={API_BRIDGE_SCRIPTS} onComplete={markBridgeReady} />
      )}
      {runtimeReady ? children : null}
    </>
  );
}
