// Client-only helper of the /speaking route (not a public content loader, so
// it lives next to its one caller rather than in lib/, whose files must load
// through lib/backend.ts).
// Reads `/auth/me` through the shared single flight (PC-J147), so the profile
// lands in the registry that `useLearnerV2` and other observers read.
// `/speaking` fetches its own profile (`role-source="page"`, Perf P1.1), so
// without this the learner_v2 flag would never be known there and no second
// `/auth/me` is paid for it. Any failure falls back to the page's previous read,
// `api.get('/auth/me')`, which keeps its own 401 handling.
import { sharedAuthMe } from '@/lib/auth/auth-me-single-flight.mjs';

type Api = { base?: string; get: (path: string) => Promise<unknown> };

export async function readAuthMeShared<T>(api: Api): Promise<T> {
  try {
    const base = api?.base;
    const sb = typeof window.getSupabase === 'function' ? (window.getSupabase() as any) : null;
    const token: string | undefined = sb ? (await sb.auth.getSession())?.data?.session?.access_token : undefined;
    if (base && token) {
      const read = await sharedAuthMe(token, (signal: AbortSignal, requestId: string) => fetch(`${base}/auth/me`, {
        headers: { Authorization: `Bearer ${token}`, 'X-Request-ID': requestId },
        signal,
      }));
      if (read?.ok && read.payload && typeof read.payload === 'object') return read.payload as T;
    }
  } catch {
    // fall back below
  }
  return api.get('/auth/me') as Promise<T>;
}
