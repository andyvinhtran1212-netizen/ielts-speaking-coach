'use client';

// AuthProvider — ADR-011 state machine, client-only module (ADR-003 §3:
// bearer token never crosses an RSC boundary; the root layout stays
// cookie/header-free so the public tree remains static).
//
// State machine (ADR-011):
//   initial-loading → signed-in | signed-out
//   refresh-success  → stays signed-in
//   refresh-failure  → signed-out FAIL-CLOSED (never render stale private data)
//   sign-out         → signed-out, local + cross-tab
//
// Coexistence invariant: there is exactly ONE GoTrue client per page — the
// window client that api.js creates via initSupabase() (CDN supabase-js,
// loaded by the route-group layout). Bundling a second @supabase/supabase-js
// here would race token refreshes against it. The provider therefore consumes
// window.getSupabase() and waits for the deferred legacy scripts, exactly the
// way legacy pages sequence init() behind DOMContentLoaded.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type AuthStatus = 'initial-loading' | 'signed-in' | 'signed-out';

export interface AuthUser {
  id: string;
  email: string | null;
}

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  status: 'initial-loading',
  user: null,
  signOut: async () => {},
});

// If the deferred CDN/api.js scripts never arrive (blocked CDN, script error),
// auth state is unknowable → FAIL CLOSED to signed-out rather than hanging in
// initial-loading forever.
const SUPABASE_READY_TIMEOUT_MS = 10_000;
const SUPABASE_POLL_INTERVAL_MS = 50;

function waitForSupabase(): Promise<any | null> {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const tick = () => {
      const getSb = (window as any).getSupabase;
      const sb = typeof getSb === 'function' ? getSb() : null;
      if (sb) return resolve(sb);
      if (performance.now() - startedAt > SUPABASE_READY_TIMEOUT_MS) return resolve(null);
      setTimeout(tick, SUPABASE_POLL_INTERVAL_MS);
    };
    tick();
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('initial-loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const sbRef = useRef<any>(null);

  // Single transition point: every signal (initial getSession, refresh events,
  // cross-tab storage sync, chrome sign-out) funnels through here, so a null
  // session can only ever move us to signed-out — the fail-closed direction.
  const applySession = useCallback((session: any | null) => {
    if (session && session.user) {
      setUser({ id: session.user.id, email: session.user.email ?? null });
      setStatus('signed-in');
    } else {
      setUser(null);
      setStatus('signed-out');
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | null = null;

    (async () => {
      const sb = await waitForSupabase();
      if (disposed) return;
      if (!sb) {
        applySession(null); // fail-closed: auth stack unavailable
        return;
      }
      sbRef.current = sb;

      try {
        const { data } = await sb.auth.getSession();
        if (!disposed) applySession(data?.session ?? null);
      } catch {
        if (!disposed) applySession(null); // fail-closed
      }

      // supabase-js v2 covers refresh outcomes AND cross-tab sync (storage
      // events on its localStorage key): TOKEN_REFRESHED keeps signed-in,
      // refresh failure / SIGNED_OUT arrive with session=null → signed-out.
      const { data: sub } = sb.auth.onAuthStateChange((_event: string, session: any) => {
        if (!disposed) applySession(session ?? null);
      });
      unsubscribe = () => sub?.subscription?.unsubscribe?.();
    })();

    // ADR-011 §4 coexistence: the legacy <aver-chrome> logout button performs
    // supabase signOut() itself, then dispatches this event — receive it so
    // both stacks agree immediately (not one poll later).
    const onChromeSignedOut = () => {
      if (!disposed) applySession(null);
    };
    document.addEventListener('av-chrome-signed-out', onChromeSignedOut);

    // bfcache restoration (ADR-011 §3): a Back navigation can revive this page
    // from the back/forward cache with pre-logout React state. Re-validate the
    // real session on every persisted pageshow.
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted || !sbRef.current) return;
      sbRef.current.auth
        .getSession()
        .then(({ data }: any) => {
          if (!disposed) applySession(data?.session ?? null);
        })
        .catch(() => {
          if (!disposed) applySession(null);
        });
    };
    window.addEventListener('pageshow', onPageShow);

    return () => {
      disposed = true;
      unsubscribe?.();
      document.removeEventListener('av-chrome-signed-out', onChromeSignedOut);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [applySession]);

  const signOut = useCallback(async () => {
    // Local state drops FIRST (fail-closed even if the network call fails),
    // then the shared client broadcasts cross-tab, then the legacy-compat
    // event keeps any legacy chrome/listeners on the page in sync (ADR-011 §4
    // is bidirectional: phát/nhận).
    //
    // ⚠ ORDERING HAZARD for future callers (review #762): applySession(null)
    // flips pages to signed-out, and a fail-closed page effect (profile)
    // NAVIGATES on that. supabase-js v2 signOut() runs the network revoke
    // BEFORE clearing localStorage — if the navigation fires mid-revoke, both
    // the revoke and the storage cleanup are cancelled and the next page load
    // RESTORES the session (logout silently undone). The legacy chrome logout
    // (aver-chrome.js _bindLogout) therefore awaits the revoke before
    // announcing sign-out — today the ONLY user-initiated logout path. If you
    // wire a Next logout button to THIS function, await the revoke before
    // applySession(null), or verify the caller's page has no signed-out
    // navigation effect.
    applySession(null);
    try {
      // AUDIT F6: supabase-js v2 signOut() does NOT throw on failure — it
      // RESOLVES with { error }. The old bare await silently discarded it,
      // so a failed server-side revoke (refresh token still valid!) looked
      // identical to a real sign-out. Local state stays signed-out either
      // way (fail-closed), but the failure must be observable: report it so
      // the error dashboard sees revoke failures instead of nothing.
      const result = await sbRef.current?.auth?.signOut?.();
      if (result?.error) {
        console.error('[auth] signOut revoke failed:', result.error);
        (window as any).aver?.reportError?.(
          'signOut revoke failed: ' + (result.error.message || String(result.error)),
          { type: 'auth_signout_revoke_failed' },
        );
      }
    } catch (e) {
      // Network-level failure — same story: local + cross-tab state is
      // already signed-out; leave a trace instead of swallowing silently.
      console.error('[auth] signOut threw:', e);
      (window as any).aver?.reportError?.(
        'signOut threw: ' + ((e as any)?.message || String(e)),
        { type: 'auth_signout_revoke_failed' },
      );
    }
    document.dispatchEvent(
      new CustomEvent('av-chrome-signed-out', { bubbles: true, composed: true }),
    );
  }, [applySession]);

  return (
    <AuthContext.Provider value={{ status, user, signOut }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
