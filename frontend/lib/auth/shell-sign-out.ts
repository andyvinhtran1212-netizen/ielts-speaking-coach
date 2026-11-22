// Sign-out for the "Bản in" shells (UIBASE-0056 G03-T14). The same flow and
// the same order as <aver-chrome>'s `user-menu-logout` (public/js/components/
// aver-chrome.js `_bindLogout`), so the AuthProvider and the legacy pages see
// exactly what they see today. Do not reorder (review #762, U-07, U-21):
//
//  1. `av-chrome-signing-out`: this user-initiated logout owns the final
//     navigation to '/', so the AuthProvider must not redirect to /login.
//  2. Wait for the shared Supabase client (the menu can be used before the
//     runtime has loaded), record the session being ended, then revoke.
//     A failed revoke resolves `{ error }` and is reported, not thrown.
//  3. Purge the persisted session and the API token cache (fail closed).
//  4. `av-chrome-signed-out`, then navigate to '/'.
import { clearPersistedAuthSession, rememberSignedOutSession } from '@/lib/auth/sign-out-state.mjs';

const RUNTIME_READY_EVENT = 'aver:supabase-runtime-ready';
export const SHELL_SIGN_OUT_RUNTIME_WAIT_MS = 5000;

type SupabaseLike = { auth?: { signOut?: () => Promise<{ error?: { message?: string } | null } | undefined> } };
type ShellWindow = Omit<Window, 'getSupabase' | 'api' | 'aver'> & {
  getSupabase?: () => SupabaseLike | null;
  api?: { clearAuthCache?: () => void };
  aver?: { reportError?: (message: string, context: { type: string }) => void };
};

const shellWindow = () => window as ShellWindow;

function currentSupabase(): SupabaseLike | null {
  const w = shellWindow();
  return typeof w.getSupabase === 'function' ? w.getSupabase() : null;
}

function whenSupabase(timeoutMs: number): Promise<SupabaseLike | null> {
  const ready = currentSupabase();
  if (ready) return Promise.resolve(ready);
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener(RUNTIME_READY_EVENT, done);
      resolve(currentSupabase());
    };
    const timer = setTimeout(done, timeoutMs);
    window.addEventListener(RUNTIME_READY_EVENT, done);
  });
}

function report(message: string) {
  try {
    shellWindow().aver?.reportError?.(message, { type: 'auth_signout_revoke_failed' });
  } catch { /* reporting must never block logout */ }
}

const announce = (type: string) =>
  document.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true }));

/** Signs the learner out exactly like the legacy chrome, then goes to '/'. */
export async function signOutFromShell(waitMs = SHELL_SIGN_OUT_RUNTIME_WAIT_MS): Promise<void> {
  announce('av-chrome-signing-out');
  try {
    const sb = await whenSupabase(waitMs);
    if (sb?.auth && typeof sb.auth.signOut === 'function') {
      await rememberSignedOutSession(sb);
      const result = await sb.auth.signOut();
      if (result?.error) {
        console.error('Sign-out revoke failed:', result.error);
        report(`signOut revoke failed: ${result.error.message || String(result.error)}`);
      }
    }
  } catch (err) {
    console.error('Sign-out failed:', err);
    report(`signOut threw: ${(err as Error)?.message || String(err)}`);
  }
  clearPersistedAuthSession();
  try { shellWindow().api?.clearAuthCache?.(); } catch { /* page is leaving */ }
  announce('av-chrome-signed-out');
  window.location.href = '/';
}
