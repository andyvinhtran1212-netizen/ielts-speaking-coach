// Tab-scoped sign-out state shared by <aver-chrome>, the Next sign-out
// buttons and /login (U-07).
//
// supabase-js v2 signOut() clears its localStorage session only AFTER the
// network revoke succeeds. When the revoke resolves with an error — including
// "Failed to fetch" because a navigation started while it was in flight — the
// session stays persisted even though the server may already have revoked it.
// /login then boots that dead session and shows the raw /auth/me 401
// ("Token không hợp lệ hoặc đã hết hạn") to a user who just logged out.
//
// Sign-out flows therefore (1) remember which session this tab is ending
// BEFORE the revoke, so /login can recognise it even if the page dies
// mid-revoke, and (2) purge the persisted session after the revoke settles,
// whatever its outcome.

export const SIGNED_OUT_SESSION_KEY = 'aver-signed-out-session';

// supabase-js default storage keys: sb-<project-ref>-auth-token[-suffix].
const SUPABASE_AUTH_STORAGE_KEY = /^sb-.+-auth-token(?:-code-verifier|-user)?$/;

// When privacy settings deny Web Storage, the window.sessionStorage /
// window.localStorage getters themselves throw SecurityError. Every helper
// therefore resolves its default storage INSIDE its guard (never as a default
// parameter, which is evaluated before the try) so logout always proceeds.
const tabStorage = (storage) => storage || window.sessionStorage;
const persistentStorage = (storage) => storage || window.localStorage;

/** The GoTrue `session_id` claim of an access token, or null. */
export function sessionIdOf(accessToken) {
  try {
    const payload = String(accessToken || '').split('.')[1];
    if (!payload) return null;
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof claims.session_id === 'string' && claims.session_id ? claims.session_id : null;
  } catch (e) {
    return null;
  }
}

/** Record the session the user is ending. Never throws; never navigates. */
export async function rememberSignedOutSession(client, storage) {
  try {
    const result = await client.auth.getSession();
    const sessionId = sessionIdOf(result && result.data && result.data.session
      && result.data.session.access_token);
    if (sessionId) tabStorage(storage).setItem(SIGNED_OUT_SESSION_KEY, sessionId);
  } catch (e) { /* the post-revoke purge still runs */ }
}

/** True when the token belongs to a session this tab already signed out. */
export function isSignedOutSession(accessToken, storage) {
  const sessionId = sessionIdOf(accessToken);
  try {
    return Boolean(sessionId) && tabStorage(storage).getItem(SIGNED_OUT_SESSION_KEY) === sessionId;
  } catch (e) {
    return false;
  }
}

export function forgetSignedOutSession(storage) {
  try { tabStorage(storage).removeItem(SIGNED_OUT_SESSION_KEY); } catch (e) { /* best effort */ }
}

/** Remove every persisted supabase-js session key (idempotent). */
export function clearPersistedAuthSession(storage) {
  try {
    const store = persistentStorage(storage);
    const keys = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key && SUPABASE_AUTH_STORAGE_KEY.test(key)) keys.push(key);
    }
    keys.forEach((key) => store.removeItem(key));
  } catch (e) { /* storage unavailable: nothing persisted to clear */ }
}
