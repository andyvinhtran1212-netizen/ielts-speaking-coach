'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type RuntimeConfig = {
  supabaseUrl?: string | null;
  supabaseAnonKey?: string | null;
};

let singleton: SupabaseClient | null = null;
let singletonIdentity = '';

function runtimeConfig(): RuntimeConfig {
  return window.__AVER_RUNTIME_CONFIG__ || {};
}

/**
 * Own the one GoTrue client used by every App Router surface.
 *
 * Runtime config is loaded before this function is called, so Preview/staging
 * can select their Supabase project without baking production credentials into
 * the client bundle. A remounted route-group reuses the module singleton; a
 * conflicting config fails closed instead of starting a second refresh loop.
 */
export function getBrowserSupabase(
  fallbackUrl: string,
  fallbackAnonKey: string,
): SupabaseClient {
  const config = runtimeConfig();
  const url = config.supabaseUrl || fallbackUrl;
  const anonKey = config.supabaseAnonKey || fallbackAnonKey;
  const identity = `${url}\n${anonKey}`;

  if (singleton) {
    if (singletonIdentity !== identity) {
      throw new Error('Supabase runtime configuration changed after initialization.');
    }
    return singleton;
  }

  // Local browser fixtures inject a complete client before hydration. This is
  // also a safe handoff seam for a future host shell; production never defines
  // it before this module does.
  const injected = window.__AVER_SUPABASE_CLIENT__ as SupabaseClient | undefined;
  if (injected) {
    singleton = injected;
    singletonIdentity = identity;
    return singleton;
  }

  singleton = createClient(url, anonKey);
  singletonIdentity = identity;
  return singleton;
}

/** Temporary compatibility export for routes that still consume api.js. */
export function exposeLegacySupabaseClient(client: SupabaseClient) {
  const existing = window.__AVER_SUPABASE_CLIENT__;
  if (existing && existing !== client) {
    throw new Error('A second Supabase client attempted to claim the page.');
  }
  window.__AVER_SUPABASE_CLIENT__ = client;
}
