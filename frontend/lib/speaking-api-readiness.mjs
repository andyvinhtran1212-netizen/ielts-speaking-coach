/**
 * api.js exposes its methods before SupabaseRuntimeBoundary initializes the
 * shared auth client. Waiting for the methods alone can send /auth/me without
 * a token and redirect an already signed-in learner to /login.
 *
 * This is runtime readiness, not authorization: api.js still awaits the
 * client's getSession() and the backend verifies every protected request.
 * @param {any} browser
 * @returns {boolean}
 */
export function isSpeakingApiReady(browser) {
  if (typeof browser?.api?.get !== 'function') return false;
  if (typeof browser?.getSupabase !== 'function') return false;
  const client = browser.getSupabase();
  return typeof client?.auth?.getSession === 'function';
}
