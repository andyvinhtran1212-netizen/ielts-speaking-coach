/**
 * d1-exercise.js — Fill-blank exercise UI, session-based.
 *
 * Flow:
 *   /auth/me  → flag check
 *   start screen → POST /api/exercises/d1/sessions → render queue
 *   click option → LOCAL grade (instant) → fire-and-forget POST /attempt
 *   end of queue → POST /sessions/{id}/complete → summary screen
 *   summary → [Phiên mới] / [Ôn lại câu sai] / [Về hub]
 *
 * Why local grading: D1 isn't an exam — the answer is part of the published
 * payload anyway, and the perceptible UX win (no per-click round-trip) is
 * worth the small theoretical "user opens DevTools" risk. Backend POST
 * /attempt re-grades server-side regardless, so analytics + rate limit
 * stay authoritative. See PHASE_D §5 redesign.
 */

(function () {
  // api.js sets window.api.base from a single localhost/Railway switch — no
  // per-page fallback duplication. d1-exercise.html loads api.js before this
  // script, so window.api is always defined here.
  const BASE = window.api.base;

  let _token = null;
  /** @typedef {{
   *   id: string,
   *   exercises: Array<{id: string, sentence: string, options: string[], answer: string}>,
   *   current_index: number,
   *   attempts: Array<{exercise_id: string, user_answer: string, is_correct: boolean,
   *                    correct_answer: string, sentence: string}>,
   *   is_review: boolean,
   * }}
   */
  let _session = null;

  // ── Container helpers ─────────────────────────────────────────────────────

  function _root() { return document.querySelector('.exercise-container'); }

  function _setHtml(html) { _root().innerHTML = html; }

  function _showState(state, message) {
    const map = {
      loading:  '<div class="state-msg"><div class="spinner"></div></div>',
      error:    `<div class="state-msg error">${esc(message || 'Có lỗi xảy ra. Thử lại sau.')}</div>`,
      empty:    `<div class="state-msg">${esc(message || 'Chưa có bài tập nào.')}</div>`,
      disabled: '<div class="state-msg">Tính năng chưa được bật cho tài khoản của bạn.</div>',
      rate_limited:
        `<div class="state-msg">${esc(message || 'Bạn đã đạt giới hạn hôm nay. Quay lại vào ngày mai nhé.')}</div>`,
    };
    _setHtml(map[state] || map.error);
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  async function init() {
    _showState('loading');
    try {
      const sb = window.getSupabase ? window.getSupabase() : null;
      if (sb) {
        const { data } = await sb.auth.getSession();
        _token = data?.session?.access_token || null;
      }
    } catch (_) {}

    if (!_token) {
      window.location.href = '../index.html';
      return;
    }

    try {
      const meRes = await fetch(`${BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${_token}` },
      });
      if (!meRes.ok) { _showState('disabled'); return; }
      const me = await meRes.json();
      if (me.d1_enabled !== true) { _showState('disabled'); return; }
    } catch (_) {
      _showState('disabled');
      return;
    }

    renderStartScreen();
  }

  // ── Screens ───────────────────────────────────────────────────────────────

  function renderStartScreen() {
    _setHtml(`
      <div class="start-screen">
        <h2>Sẵn sàng luyện tập?</h2>
        <p>Mỗi phiên gồm 10 câu điền từ. Bạn có thể ôn lại các câu sai sau khi hoàn thành.</p>
        <button class="btn-primary btn-large" id="d1-start-btn">Bắt đầu phiên mới</button>
      </div>
    `);
    document.getElementById('d1-start-btn').onclick = startNewSession;
  }

  async function startNewSession() {
    _showState('loading');

    let res, data;
    try {
      res = await fetch(`${BASE}/api/exercises/d1/sessions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${_token}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ size: 10 }),
      });
    } catch (err) {
      console.error('[d1] startNewSession network err:', err);
      _showState('error');
      return;
    }

    if (res.status === 503) {
      // No published exercises in the pool — surface a friendly empty state.
      _showState('empty', 'Hiện chưa có bài tập nào được phát hành. Quay lại sau nhé.');
      return;
    }
    if (!res.ok) { _showState('error'); return; }

    try {
      data = await res.json();
    } catch (_) { _showState('error'); return; }

    if (!data.exercises || data.exercises.length === 0) {
      _showState('empty', 'Chưa có bài tập nào.');
      return;
    }

    _session = {
      id:               data.session_id,
      exercises:        data.exercises,    // each item carries `answer` for local grading
      current_index:    0,
      attempts:         [],
      // Number of /attempt POSTs that failed to persist server-side.  When
      // > 0, showSummary() trusts the local count instead of /complete (whose
      // summary only sees attempts that DID land in the DB) — otherwise a
      // network blip would silently undercount the user's score.
      failed_attempts:  0,
      // Whether any in-flight /attempt POSTs are still pending. showSummary
      // waits briefly for them so a fast clicker doesn't trigger /complete
      // before the last attempts have written.
      pending_attempts: 0,
      is_review:        false,
    };

    renderCurrentExercise();
  }

  function renderCurrentExercise() {
    if (_session.current_index >= _session.exercises.length) {
      showSummary();
      return;
    }

    const ex      = _session.exercises[_session.current_index];
    const total   = _session.exercises.length;
    const current = _session.current_index + 1;
    const pctFill = ((current - 1) / total) * 100;
    const isLast  = current === total;

    _setHtml(`
      <div class="exercise-active">
        <div class="progress-header">
          <div class="progress-text">Câu ${current} / ${total}${_session.is_review ? ' (ôn tập)' : ''}</div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pctFill}%"></div></div>
        </div>

        <div class="sentence">${renderSentence(ex.sentence)}</div>

        <div class="options">
          ${ex.options.map(opt =>
            `<button class="option-btn" data-option="${esc(opt)}">${esc(opt)}</button>`
          ).join('')}
        </div>

        <div id="feedback" class="feedback hidden"></div>

        <div class="mt-5 flex justify-end">
          <button id="next-btn" class="btn-primary hidden">
            ${isLast ? 'Xem kết quả' : 'Câu tiếp theo →'}
          </button>
        </div>
      </div>
    `);

    Array.from(document.querySelectorAll('.option-btn')).forEach(btn => {
      btn.onclick = () => onAnswerClick(btn.getAttribute('data-option'));
    });
    document.getElementById('next-btn').onclick = nextExercise;
  }

  function onAnswerClick(choice) {
    const ex = _session.exercises[_session.current_index];
    // LOCAL grade — instant, no API round-trip.
    const isCorrect = (choice || '').trim().toLowerCase() ===
                      (ex.answer || '').trim().toLowerCase();

    // Mark + lock all options so the user can't keep clicking.
    Array.from(document.querySelectorAll('.option-btn')).forEach(btn => {
      btn.disabled = true;
      const optVal = btn.getAttribute('data-option');
      if (optVal === ex.answer) {
        btn.classList.add('correct');           // always reveal correct answer
      } else if (optVal === choice && !isCorrect) {
        btn.classList.add('wrong');             // mark the wrong choice
      } else {
        btn.classList.add('dimmed');
      }
    });

    const fb = document.getElementById('feedback');
    fb.classList.remove('hidden', 'correct', 'wrong');
    if (isCorrect) {
      fb.classList.add('correct');
      fb.textContent = '✓ Chính xác!';
    } else {
      fb.classList.add('wrong');
      fb.innerHTML = `✗ Đáp án đúng: <strong>${esc(ex.answer)}</strong>`;
    }
    document.getElementById('next-btn').classList.remove('hidden');

    // Track locally for the summary screen and for review-wrong.
    _session.attempts.push({
      exercise_id:    ex.id,
      user_answer:    choice,
      is_correct:     isCorrect,
      correct_answer: ex.answer,
      sentence:       ex.sentence,
    });

    // Fire-and-forget POST so the backend can log + grade + rate-limit.
    // We don't await — the local feedback already rendered. Review sessions
    // (post-summary) skip this so a re-do doesn't pollute analytics or burn
    // the daily quota a second time.
    if (!_session.is_review && _session.id) {
      _session.pending_attempts += 1;
      postAttemptWithRetry(ex.id, choice, _session.id).finally(() => {
        _session.pending_attempts -= 1;
      });
    }
  }

  // One retry with a 500ms backoff covers the common transient-flake case
  // (DNS hiccup, reused-connection RST) without making the user wait long.
  // Any non-2xx OR network error after the retry counts as a failure so
  // showSummary() can fall back to the local count.
  async function postAttemptWithRetry(exerciseId, choice, sessionId) {
    const url = `${BASE}/api/exercises/d1/${exerciseId}/attempt`;
    const init = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${_token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ user_answer: choice, session_id: sessionId }),
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, init);
        // 429 (rate-limit) is NOT a transient flake — don't retry, but DO
        // count it as a failure so the summary stays local-truthful.
        if (res.status === 429) {
          _session.failed_attempts += 1;
          console.warn('[d1] attempt rate-limited (counted as sync failure)');
          return false;
        }
        if (res.ok) return true;
        // Other non-2xx — fall through to retry.
      } catch (err) {
        // Network error — fall through to retry.
        console.warn('[d1] attempt POST attempt', attempt + 1, 'failed:', err);
      }
      if (attempt === 0) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    _session.failed_attempts += 1;
    console.warn('[d1] attempt POST failed after retry (summary will use local count)');
    return false;
  }

  function nextExercise() {
    _session.current_index += 1;
    renderCurrentExercise();
  }

  // ── Summary (basic for now; richer version lands in next commit) ─────────

  async function showSummary() {
    // Wait briefly for any in-flight /attempt POSTs so a fast clicker doesn't
    // call /complete before the last writes settle (which would manifest as
    // failed_attempts being undercounted, and /complete missing rows that
    // were only milliseconds away from landing).
    await waitForPendingAttempts(2000);

    // Review sessions never call /complete — there's no backend session row.
    if (_session.is_review || !_session.id) {
      renderSummaryScreen(computeLocalSummary());
      return;
    }

    // If any /attempt POST didn't persist, /complete's summary will under-
    // count the user's score (it's derived only from rows in the DB linked
    // by session_id). Trust local instead — backend stamping still happens
    // in the background as a best-effort.
    if (_session.failed_attempts > 0) {
      console.warn(
        '[d1] %d attempt sync failure(s) — using local summary, completing in background',
        _session.failed_attempts,
      );
      fetch(
        `${BASE}/api/exercises/d1/sessions/${_session.id}/complete`,
        { method: 'POST', headers: { 'Authorization': `Bearer ${_token}` } },
      ).catch(err => console.warn('[d1] background complete failed:', err));
      renderSummaryScreen(computeLocalSummary());
      return;
    }

    // No sync failures — backend summary is authoritative.
    let summary = computeLocalSummary();
    try {
      const res = await fetch(
        `${BASE}/api/exercises/d1/sessions/${_session.id}/complete`,
        { method: 'POST', headers: { 'Authorization': `Bearer ${_token}` } },
      );
      if (res.ok) summary = await res.json();
    } catch (err) {
      console.warn('[d1] complete-session failed; using local summary:', err);
    }
    renderSummaryScreen(summary);
  }

  // Poll pending_attempts down to 0 (or timeout). Cheap because it only fires
  // once per session at the summary boundary.
  async function waitForPendingAttempts(timeoutMs) {
    const start = Date.now();
    while (_session && _session.pending_attempts > 0 && Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 50));
    }
  }

  function computeLocalSummary() {
    const correct = _session.attempts.filter(a => a.is_correct);
    const wrong   = _session.attempts.filter(a => !a.is_correct);
    return {
      correct_count: correct.length,
      total_count:   _session.attempts.length || _session.exercises.length,
      correct: correct.map(a => ({
        exercise_id: a.exercise_id, sentence: a.sentence, answer: a.correct_answer,
      })),
      wrong: wrong.map(a => ({
        exercise_id:    a.exercise_id,
        sentence:       a.sentence,
        user_answer:    a.user_answer,
        correct_answer: a.correct_answer,
      })),
    };
  }

  function renderSummaryScreen(summary) {
    const total   = summary.total_count || 1;
    const pct     = Math.round((summary.correct_count / total) * 100);
    const correct = Array.isArray(summary.correct) ? summary.correct : [];
    const wrong   = Array.isArray(summary.wrong)   ? summary.wrong   : [];

    const correctSection = correct.length > 0 ? `
      <div class="results-section correct-section">
        <h3>✓ Đúng (${correct.length})</h3>
        <ul class="result-list">
          ${correct.map(item => `
            <li>
              <div class="word"><strong>${esc(item.answer)}</strong></div>
              <div class="sentence-preview">${esc(item.sentence)}</div>
            </li>
          `).join('')}
        </ul>
      </div>` : '';

    const wrongSection = wrong.length > 0 ? `
      <div class="results-section wrong-section">
        <h3>✗ Sai (${wrong.length})</h3>
        <ul class="result-list">
          ${wrong.map(item => `
            <li>
              <div class="sentence-preview">${esc(item.sentence)}</div>
              <div class="answers-row">
                <span class="user-ans">Bạn chọn: <strong class="wrong">${esc(item.user_answer)}</strong></span>
                <span class="correct-ans">Đáp án: <strong class="correct">${esc(item.correct_answer)}</strong></span>
              </div>
            </li>
          `).join('')}
        </ul>
      </div>` : '';

    const reviewBtn = wrong.length > 0
      ? `<button class="btn-secondary" id="d1-review-btn">Ôn lại ${wrong.length} câu sai</button>`
      : '';

    _setHtml(`
      <div class="summary">
        <h2>${_session.is_review ? 'Hoàn thành ôn tập!' : 'Hoàn thành phiên!'}</h2>
        <div class="score-display">
          <div class="score-number">${summary.correct_count}/${total}</div>
          <div class="score-percent">${pct}%</div>
        </div>
        ${correctSection}
        ${wrongSection}
        <div class="summary-actions">
          <button class="btn-primary" id="d1-restart-btn">Phiên mới</button>
          ${reviewBtn}
          <button class="btn-ghost" id="d1-back-btn">Về hub</button>
        </div>
      </div>
    `);

    document.getElementById('d1-restart-btn').onclick = startNewSession;
    document.getElementById('d1-back-btn').onclick    = () => { window.location.href = 'exercises.html'; };
    if (wrong.length > 0) {
      const wrongIds = wrong.map(w => w.exercise_id);
      document.getElementById('d1-review-btn').onclick = () => reviewWrong(wrongIds);
    }
  }

  function reviewWrong(wrongIds) {
    // Build a local-only review session from the exercises the user just got
    // wrong.  No DB row is created — review attempts skip the fire-and-forget
    // POST /attempt (see onAnswerClick) so they don't burn the daily quota
    // again or pollute analytics with practice repetitions.
    const idSet = new Set(wrongIds);
    const wrongExercises = _session.exercises.filter(e => idSet.has(e.id));

    if (wrongExercises.length === 0) {
      // Defensive — shouldn't happen if the summary rendered a review button.
      renderStartScreen();
      return;
    }

    _session = {
      id:            null,             // standalone, no backend session row
      exercises:     wrongExercises,
      current_index: 0,
      attempts:      [],
      is_review:     true,
    };
    renderCurrentExercise();
  }

  // ── Util ──────────────────────────────────────────────────────────────────

  function renderSentence(sentence) {
    return esc(sentence).replace('___', '<span class="blank-token">_____</span>');
  }

  function esc(str) {
    const div = document.createElement('div');
    div.textContent = String(str == null ? '' : str);
    return div.innerHTML;
  }

  // Expose hooks the summary buttons bind to.
  window._d1 = { startNewSession, reviewWrong };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
