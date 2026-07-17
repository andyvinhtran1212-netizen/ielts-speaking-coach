/**
 * frontend/js/quiz-review.js — end-of-session review list (audit 2026-07-17 §II).
 *
 * Pure logic (no DOM) so it is unit-testable under `node --test`. The page
 * (quiz.html) logs one entry per graded answer during the session and calls
 * buildReviewList() on the result screen. The engine stays untouched: it drains
 * attempts to the backend and keeps no history, so the page-level log is the
 * only place the learner's answers survive until the summary.
 */

/**
 * Group per-attempt log entries by qid, keeping the LAST attempt (what the
 * learner finally saw — the adaptive loop can re-ask a question until it's
 * answered right) plus how many attempts were wrong along the way. Output
 * preserves first-seen order so the review reads in session sequence.
 *
 * Entry shape (page-provided): {qid, item_key, prompt, given, correctText,
 * correct, explain, article_url}. Returned items add {attempts, wrongCount}.
 */
export function buildReviewList(log) {
  var byQid = new Map();
  var order = [];
  (log || []).forEach(function (e) {
    if (!e || !e.qid) return;
    var g = byQid.get(e.qid);
    if (!g) { g = { attempts: 0, wrong: 0, last: null }; byQid.set(e.qid, g); order.push(e.qid); }
    g.attempts += 1;
    if (!e.correct) g.wrong += 1;
    g.last = e;
  });
  return order.map(function (qid) {
    var g = byQid.get(qid);
    var it = {};
    Object.keys(g.last).forEach(function (k) { it[k] = g.last[k]; });
    it.attempts = g.attempts;
    it.wrongCount = g.wrong;
    return it;
  });
}
