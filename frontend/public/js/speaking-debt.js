/*
 * speaking-debt.js — the unpaid "Speaking is done" report, shared.
 *
 * A5. When a mock's Speaking part finishes, practice.js POSTs
 * /sittings/{id}/speaking. If that call fails the sitting stays
 * `speaking_pending` FOREVER: _reconcile_terminal never runs, no review row is
 * created, the result is never released. The speaking work itself is fine; only
 * the last hop is lost.
 *
 * So the debt is persisted and retried. It lives HERE rather than inside
 * practice.js because practice.js is loaded only by the practice pages — a
 * student who closes the completion tab and comes back through Home or the
 * mock-exam page (the normal post-exam path) would never have settled it
 * (Codex review, PR #847).
 *
 * The queue is keyed by sitting AND stamped with the owning user, because
 * localStorage is origin-wide: on a shared browser, user B's retry gets a 403
 * for user A's debt, and clearing on that response destroyed A's only record.
 */
window.SpeakingDebt = (function () {
  'use strict';

  var KEY = 'mock-speaking-owed';
  var RETRY_DELAYS = [1000, 3000, 8000];

  function read() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return []; }
    if (!raw) return [];
    // Migrate the single-object shape written before the queue existed.
    if (!Array.isArray(raw)) return raw.sitting_id ? [raw] : [];
    return raw.filter(function (d) { return d && d.sitting_id; });
  }

  function write(list) {
    try {
      if (!list.length) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, JSON.stringify(list));
    } catch (e) {}
  }

  function remember(sittingId, ids, userId) {
    var list = read().filter(function (d) {
      return String(d.sitting_id) !== String(sittingId);
    });
    list.push({ sitting_id: sittingId, session_ids: ids, user_id: userId || null });
    write(list);
  }

  // Remove ONLY the entry whose request settled. Clearing the whole key would
  // drop every other sitting's debt with it.
  function clear(sittingId) {
    write(read().filter(function (d) {
      return String(d.sitting_id) !== String(sittingId);
    }));
  }

  async function currentUserId() {
    try {
      var sb = window.getSupabase && window.getSupabase();
      if (!sb) return null;
      var res = await sb.auth.getSession();
      var sess = res && res.data && res.data.session;
      return (sess && sess.user && sess.user.id) || null;
    } catch (e) { return null; }
  }

  function report(sittingId, ids, attempt, ownerId) {
    attempt = attempt || 0;
    if (!sittingId || !ids || !ids.length) return Promise.resolve();
    remember(sittingId, ids, ownerId);
    return window.api.post(
      '/api/mock-exams/sittings/' + encodeURIComponent(sittingId) + '/speaking',
      { session_ids: ids }
    ).then(function (r) {
      // api.js resolves NULL after redirecting an unauthenticated request.
      // Clearing the debt on that would throw away the only retry record.
      if (r === null || r === undefined) throw new Error('unauthenticated');
      clear(sittingId);
      return r;
    }).catch(function (err) {
      var st = err && err.status;
      // 401 is NOT terminal — we asked too early or the token lapsed. Keep the
      // debt so the next authenticated load settles it.
      if (st === 401) throw err;
      if (st === 403 || st === 409 || st === 404) { clear(sittingId); throw err; }
      if (attempt >= RETRY_DELAYS.length) throw err;   // debt persists
      return new Promise(function (resolve) {
        setTimeout(function () {
          resolve(report(sittingId, ids, attempt + 1, ownerId));
        }, RETRY_DELAYS[attempt]);
      });
    });
  }

  // Settle every outstanding report. Runs on load, costs nothing when there is
  // no debt, and is the difference between a sitting that finalises on the
  // student's next page view and one that never does.
  //
  // MUST be called after authentication: an unauthenticated POST 401s, api.js
  // redirects to login and resolves null, and the student is bounced out.
  async function retryAll() {
    var debts = read();
    if (!debts.length) return;
    var me = await currentUserId();
    debts.forEach(function (owed) {
      // Someone else's debt on a shared browser. Their 403 would otherwise
      // delete the only record they have of it.
      if (me && owed.user_id && String(owed.user_id) !== String(me)) return;
      report(owed.sitting_id, owed.session_ids || [], 0, owed.user_id || me)
        .catch(function (e) {
          console.warn('[speaking-debt] still failing', owed.sitting_id, e);
        });
    });
  }

  return { read: read, write: write, remember: remember, clear: clear,
           report: report, retryAll: retryAll, KEY: KEY };
})();
