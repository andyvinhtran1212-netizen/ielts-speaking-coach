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
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { clearCoreOperationIntents } from '@/lib/core-operation-intent.mjs';
import { clearLearnerTabDraftAccount, invalidateLearnerTabDraftOwner } from '@/lib/learner-tab-drafts.mjs';
import { clearPersistedAuthSession } from '@/lib/auth/sign-out-state.mjs';
import { clearForeignLocalCopies, clearOwnerLocalCopies } from '@/lib/exam-room/local-copy.mjs';
import { getCurrentActiveStatus } from '@/lib/auth-api';
import { setAuthMeAccount } from '@/lib/auth/auth-me-single-flight.mjs';
import {
  activationDecision,
  isInactiveOpenPath,
  isRememberedActive,
  rememberActive,
  requiresActivation,
} from '@/lib/auth/activation-gate.mjs';

// LEARNERCORE-0063 FR-092: loaded only when shown, so its styles never reach
// an active learner's page.
const NeedsCourseScreen = dynamic(() => import('@/components/ui/needs-course-screen'), { ssr: false });

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
// A chrome logout whose '/' navigation has not unloaded the page by now (e.g.
// a beforeunload guard was cancelled) falls back to the fail-closed state.
const CHROME_SIGN_OUT_NAVIGATION_GRACE_MS = 10_000;

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

function sessionStore(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

// W-03 — ask the backend whether this account is activated, through the shared
// authenticated transport (typed /auth/check-active consumer). Any failure —
// transport missing, network, non-2xx, malformed reply — is 'unknown'.
async function probeActivation() {
  try {
    return activationDecision(true, await getCurrentActiveStatus());
  } catch {
    return activationDecision(false, null);
  }
}

function InactiveLearnerPage({ children }: { children: ReactNode }) {
  const routerPath = usePathname();
  const pathname = routerPath ?? (typeof window === 'undefined' ? '' : window.location.pathname);
  return requiresActivation(pathname) && !isInactiveOpenPath(pathname) ? <NeedsCourseScreen /> : children;
}

export function AuthProvider({
  children,
  activationGate = false,
}: {
  children: ReactNode;
  /**
   * W-03 — learner layouts: an inactive account is sent to /login (activation
   * dialog) before `signed-in` is ever exposed, so the page never renders or
   * calls learner APIs first. Exempt paths: see lib/auth/activation-gate.mjs.
   * LEARNERCORE-0063 FR-091/FR-092: with learner_v2 on (check-active says
   * `inactive_open`), the open pages render and every other learner page is
   * replaced by "Cần có khoá" before it mounts.
   */
  activationGate?: boolean;
}) {
  const [status, setStatus] = useState<AuthStatus>('initial-loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const sbRef = useRef<any>(null);
  const confirmedAccountRef = useRef<string | null>(null);
  // EXAMROOM-0066 FR-035: the last account seen signed in. Unlike
  // confirmedAccountRef it survives a null session (an expired session is not
  // a sign-out), so an explicit sign-out can still drop that account's copies.
  const lastSignedInAccountRef = useRef<string | null>(null);
  const sessionReadRef = useRef(0);
  // Set while the user-initiated <aver-chrome> logout owns the navigation.
  const chromeSignOutRef = useRef(false);
  // W-03 — the account whose activation this provider already settled (active
  // or fail-open). Token refreshes for it never re-enter initial-loading.
  const activationSettledRef = useRef<string | null>(null);
  // FR-091/FR-092: the account the probe answered `inactive_open` for. Only
  // INACTIVE_OPEN_PATHS render for it; any other learner page shows "Cần có
  // khoá" in place. Decided per render from the current path, so a client
  // navigation inside the same layout is covered too. Never remembered.
  const [inactiveOpenAccount, setInactiveOpenAccount] = useState<string | null>(null);
  const inactiveOpenRef = useRef<string | null>(null);

  // Single transition point: every signal (initial getSession, refresh events,
  // cross-tab storage sync, chrome sign-out) funnels through here, so a null
  // session can only ever move us to signed-out — the fail-closed direction.
  const applySession = useCallback((session: any | null) => {
    ++sessionReadRef.current; // A newer auth signal supersedes pending reads.
    const nextAccount = typeof session?.user?.id === 'string' ? session.user.id : null;
    setAuthMeAccount(nextAccount);
    const previousAccount = confirmedAccountRef.current;
    if (previousAccount && previousAccount !== nextAccount) clearLearnerTabDraftAccount(previousAccount);
    else if (!nextAccount) invalidateLearnerTabDraftOwner();
    confirmedAccountRef.current = nextAccount;
    if (inactiveOpenRef.current && inactiveOpenRef.current !== nextAccount) {
      inactiveOpenRef.current = null;
      setInactiveOpenAccount(null);
    }
    try { clearCoreOperationIntents(window.sessionStorage, session?.user?.id || null); } catch { /* auth must proceed */ }
    // EXAMROOM-0066 FR-035 (Scenario 6a): an account signing in drops every
    // exam-room local copy of another owner, decided from the key alone,
    // without reading it. A null session (expired, refresh failed) clears
    // nothing: the copy is what FR-015 restores after signing in again.
    if (nextAccount) {
      lastSignedInAccountRef.current = nextAccount;
      try { clearForeignLocalCopies(window.localStorage, nextAccount); } catch { /* auth must proceed */ }
    }
    if (session && session.user) {
      const signedIn = { id: session.user.id, email: session.user.email ?? null };
      const accountId: string = session.user.id;
      if (
        activationGate
        && activationSettledRef.current !== accountId
        && requiresActivation(window.location.pathname)
        && !isRememberedActive(sessionStore(), accountId)
      ) {
        // Hold the private-data-free loading state until the backend answers;
        // a newer auth signal (logout, account switch) supersedes this probe.
        const read = sessionReadRef.current;
        const store = sessionStore();
        setUser(null);
        setStatus('initial-loading');
        void probeActivation().then((decision) => {
          if (read !== sessionReadRef.current) return;
          if (decision === 'inactive') {
            // Stay in initial-loading: nothing private renders before /login.
            window.location.replace('/login');
            return;
          }
          if (decision === 'active') rememberActive(store, accountId);
          if (decision === 'inactive_open') {
            // Not an activation: nothing is remembered, the next load probes again.
            inactiveOpenRef.current = accountId;
            setInactiveOpenAccount(accountId);
          }
          activationSettledRef.current = accountId;
          setUser(signedIn);
          setStatus('signed-in');
        });
        return;
      }
      setUser(signedIn);
      setStatus('signed-in');
    } else {
      setUser(null);
      // The chrome logout redirects to its canonical '/' itself. Pages react to
      // 'signed-out' with a fail-closed replace('/login') that would run after
      // — and override — that redirect, so hold them in the same
      // private-data-free loading state bfcache re-validation uses.
      setStatus(chromeSignOutRef.current ? 'initial-loading' : 'signed-out');
    }
  }, [activationGate]);

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

      // Subscribe before the initial read: logout/account changes must win
      // over an older getSession response.
      const { data: sub } = sb.auth.onAuthStateChange((_event: string, session: any) => {
        if (!disposed) applySession(session ?? null);
      });
      unsubscribe = () => sub?.subscription?.unsubscribe?.();
      const initialRead = ++sessionReadRef.current;

      try {
        const { data } = await sb.auth.getSession();
        if (!disposed && initialRead === sessionReadRef.current) applySession(data?.session ?? null);
      } catch {
        if (!disposed && initialRead === sessionReadRef.current) applySession(null); // fail-closed
      }

      // supabase-js v2 covers refresh outcomes AND cross-tab sync (storage
      // events on its localStorage key): TOKEN_REFRESHED keeps signed-in,
      // refresh failure / SIGNED_OUT arrive with session=null → signed-out.
    })();

    // ADR-011 §4 coexistence: the legacy <aver-chrome> logout button performs
    // supabase signOut() itself, then dispatches this event — receive it so
    // both stacks agree immediately (not one poll later).
    let chromeSignOutFallback: ReturnType<typeof setTimeout> | null = null;
    const clearChromeSignOut = () => {
      chromeSignOutRef.current = false;
      if (chromeSignOutFallback !== null) clearTimeout(chromeSignOutFallback);
      chromeSignOutFallback = null;
    };
    // Announced before the revoke; it never navigates, so the review #762
    // ordering (revoke settles before any sign-out navigation) still holds.
    const onChromeSigningOut = () => {
      if (!disposed) chromeSignOutRef.current = true;
    };
    const onChromeSignedOut = () => {
      if (disposed) return;
      // EXAMROOM-0066 FR-035: an explicit sign-out (chrome, shell or
      // signOut() below, all announce this event) drops that account's copies.
      const signedOutAccount = lastSignedInAccountRef.current;
      lastSignedInAccountRef.current = null;
      if (signedOutAccount) {
        try { clearOwnerLocalCopies(window.localStorage, signedOutAccount); } catch { /* sign-out must proceed */ }
      }
      applySession(null);
      if (chromeSignOutRef.current && chromeSignOutFallback === null) {
        chromeSignOutFallback = setTimeout(() => {
          clearChromeSignOut();
          if (!disposed) applySession(null);
        }, CHROME_SIGN_OUT_NAVIGATION_GRACE_MS);
      }
    };
    document.addEventListener('av-chrome-signing-out', onChromeSigningOut);
    document.addEventListener('av-chrome-signed-out', onChromeSignedOut);

    // bfcache restoration (ADR-011 §3): a Back navigation can revive this page
    // from the back/forward cache with pre-logout React state. Re-validate the
    // real session on every persisted pageshow.
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted || !sbRef.current) return;
      // Back after a chrome logout: its navigation finished, so the revived
      // page must fail closed again.
      clearChromeSignOut();
      const read = ++sessionReadRef.current;
      setUser(null);
      setStatus('initial-loading');
      sbRef.current.auth
        .getSession()
        .then(({ data }: any) => {
          if (!disposed && read === sessionReadRef.current) applySession(data?.session ?? null);
        })
        .catch(() => {
          if (!disposed && read === sessionReadRef.current) applySession(null);
        });
    };
    window.addEventListener('pageshow', onPageShow);

    return () => {
      disposed = true;
      unsubscribe?.();
      clearChromeSignOut();
      document.removeEventListener('av-chrome-signing-out', onChromeSigningOut);
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
    // U-07: a failed revoke leaves the session persisted; never let the next
    // page boot it.
    clearPersistedAuthSession();
    document.dispatchEvent(
      new CustomEvent('av-chrome-signed-out', { bubbles: true, composed: true }),
    );
  }, [applySession]);

  const inactiveLearner = activationGate && status === 'signed-in' && user && inactiveOpenAccount === user.id;
  return (
    <AuthContext.Provider value={{ status, user, signOut }}>
      {inactiveLearner ? (
        <Suspense fallback={null}>
          <InactiveLearnerPage>{children}</InactiveLearnerPage>
        </Suspense>
      ) : children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
