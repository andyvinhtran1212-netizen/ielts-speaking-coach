/**
 * d1-exercise.js — Fill-blank exercise UI, session-based.
 *
 * Flow:
 *   /auth/me  → flag check
 *   start screen → POST /api/exercises/d1/sessions → render queue
 *   click option → LOCAL grade (instant) → persist /attempt → unlock Next
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
  const ACTIVE_SESSION_KEY = 'aver:d1:active-session';

  let _token = null;
  let _userId = null;
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
  let _lastAttemptRateLimit = null;

  function activeSessionKey() {
    return _userId ? `${ACTIVE_SESSION_KEY}:${_userId}` : '';
  }

  function readActiveSessionIds(key = activeSessionKey()) {
    const raw = key ? window.localStorage?.getItem(key) : null;
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return [...new Set(parsed.filter(id => typeof id === 'string' && id))];
      }
    } catch (_) {
      // Backward compatibility with the pre-registry singleton value.
    }
    return [raw];
  }

  function writeActiveSessionIds(ids) {
    const key = activeSessionKey();
    if (!key) return;
    const unique = [...new Set(ids.filter(id => typeof id === 'string' && id))];
    if (unique.length) window.localStorage?.setItem(key, JSON.stringify(unique));
    else window.localStorage?.removeItem(key);
  }

  function sessionIdFromUrl() {
    return new URL(window.location.href).searchParams.get('session') || '';
  }

  function rememberActiveSession(sessionId) {
    writeActiveSessionIds([...readActiveSessionIds().filter(id => id !== sessionId), sessionId]);
    const url = new URL(window.location.href);
    url.searchParams.set('session', sessionId);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function forgetActiveSession(sessionId) {
    writeActiveSessionIds(readActiveSessionIds().filter(id => id !== sessionId));
    const url = new URL(window.location.href);
    if (url.searchParams.get('session') === sessionId) {
      url.searchParams.delete('session');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }

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
      if (typeof me.id !== 'string' || !me.id) {
        _showState('error', 'Không xác định được tài khoản đang đăng nhập.');
        return;
      }
      _userId = me.id;
    } catch (_) {
      _showState('disabled');
      return;
    }

    if (await resumeStoredSession()) return;
    renderStartScreen();
  }

  async function resumeStoredSession() {
    const storedIds = readActiveSessionIds();
    // A pre-namespace singleton is only a candidate. Never delete it on 404:
    // it may belong to another account that used this browser. Claim/remove
    // it only after the user-scoped endpoint proves ownership.
    const legacyIds = storedIds.length ? [] : readActiveSessionIds(ACTIVE_SESSION_KEY);
    const candidates = storedIds.length ? storedIds : legacyIds;
    const sessionId = sessionIdFromUrl() || candidates[candidates.length - 1];
    if (!sessionId) return false;
    try {
      const res = await fetch(`${BASE}/api/exercises/d1/sessions/${sessionId}`, {
        headers: { 'Authorization': `Bearer ${_token}` },
      });
      if (!res.ok) {
        if (res.status === 404) {
          forgetActiveSession(sessionId);
          return false;
        }
        _showState('error', 'Chưa thể khôi phục phiên đang làm. Hãy thử tải lại trang.');
        return true;
      }
      const data = await res.json();
      const session = data.session || {};
      const exercises = Array.isArray(session.exercise_snapshot)
        ? session.exercise_snapshot : [];
      if (!['active', 'completed'].includes(session.status) || exercises.length === 0) {
        _showState('error', 'Dữ liệu phiên đang làm không hợp lệ. Hãy tải lại hoặc liên hệ hỗ trợ.');
        return true;
      }
      const attemptsById = new Map(
        (Array.isArray(data.attempts) ? data.attempts : [])
          .map(attempt => [attempt.exercise_id, attempt]),
      );
      const attempts = exercises
        .filter(exercise => attemptsById.has(exercise.id))
        .map(exercise => {
          const attempt = attemptsById.get(exercise.id);
          return {
            exercise_id: exercise.id,
            user_answer: attempt.user_answer,
            is_correct: Boolean(attempt.is_correct),
            correct_answer: exercise.answer,
            sentence: exercise.sentence,
          };
        });
      _session = {
        id: session.id,
        exercises,
        current_index: Math.min(attempts.length, exercises.length),
        attempts,
        is_review: false,
      };
      rememberActiveSession(_session.id);
      if (legacyIds.includes(_session.id)) {
        window.localStorage?.removeItem(ACTIVE_SESSION_KEY);
      }
      if (session.status === 'completed' || attempts.length >= exercises.length) {
        await showSummary();
        return true;
      }
      renderCurrentExercise();
      return true;
    } catch (err) {
      console.warn('[d1] active-session resume failed:', err);
      _showState('error', 'Chưa thể khôi phục phiên đang làm. Hãy thử tải lại trang.');
      return true;
    }
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
    if (res.status === 429) {
      let detail = null;
      try { detail = (await res.json()).detail; } catch (_) {}
      _showState('rate_limited', formatQuotaMessage(detail));
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
      is_review:        false,
    };
    rememberActiveSession(_session.id);

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

    // Sprint 10.5 Phase 2 — source label distinguishes a personalized
    // question (from the user's vocab bank) from an admin-pool fallback.
    // Missing source on legacy payloads falls through to no label.
    const sourceLabel = ex.source === 'personalized'
      ? '<span class="d1-source-label d1-source-label--personalized">Từ vốn từ của bạn</span>'
      : ex.source === 'admin_fallback'
        ? '<span class="d1-source-label d1-source-label--admin">Bài luyện tập chung</span>'
        : '';

    _setHtml(`
      <div class="exercise-active">
        <div class="progress-header">
          <div class="progress-text">Câu ${current} / ${total}${_session.is_review ? ' (ôn tập)' : ''}</div>
          ${sourceLabel}
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
    const nextBtn = document.getElementById('next-btn');

    // Track locally for the summary screen and for review-wrong.
    _session.attempts.push({
      exercise_id:    ex.id,
      user_answer:    choice,
      is_correct:     isCorrect,
      correct_answer: ex.answer,
      sentence:       ex.sentence,
    });

    // Review sessions are local-only, so they can advance immediately. A real
    // session must receive a canonical persistence ACK before Next unlocks;
    // otherwise /complete could race the final attempt or silently omit it.
    //
    // Sprint 10.3 — the response now carries {srs_updated, srs_rating}
    // when this attempt fed the SRS schedule (first-attempt-only,
    // backend-gated). renderSrsIndicator() appends a small inline
    // acknowledgement below the feedback box so the user knows the
    // signal landed without showing raw SRS internals.
    if (!_session.is_review && _session.id) {
      const clientAttemptId = newClientAttemptId();
      persistAnswerBeforeAdvance(ex.id, choice, _session.id, clientAttemptId, nextBtn);
    } else {
      nextBtn.classList.remove('hidden');
    }
  }

  async function persistAnswerBeforeAdvance(
    exerciseId, choice, sessionId, clientAttemptId, nextBtn,
  ) {
    const fb = document.getElementById('feedback');
    let status = fb?.querySelector('.d1-save-status');
    if (!status && fb) {
      status = document.createElement('div');
      status.className = 'd1-save-status';
      fb.appendChild(status);
    }

    nextBtn.disabled = true;
    nextBtn.classList.add('hidden');
    if (status) status.textContent = 'Đang lưu bài…';

    const data = await postAttemptWithRetry(
      exerciseId, choice, sessionId, clientAttemptId,
    );

    if (data) {
      if (status) status.textContent = '✓ Đã lưu bài';
      renderSrsIndicator(data);
      nextBtn.disabled = false;
      nextBtn.classList.remove('hidden');
      return;
    }

    if (!status) return;
    if (_lastAttemptRateLimit) {
      status.innerHTML = `${esc(formatQuotaMessage(_lastAttemptRateLimit))} `
        + '<button type="button" class="btn-link d1-save-retry">Thử lại</button> '
        + '<a class="btn-link" href="/exercises">Rời phiên</a>';
      const retry = status.querySelector('.d1-save-retry');
      if (retry) {
        retry.onclick = () => persistAnswerBeforeAdvance(
          exerciseId, choice, sessionId, clientAttemptId, nextBtn,
        );
      }
      return;
    }
    status.innerHTML = 'Chưa lưu được bài. '
      + '<button type="button" class="btn-link d1-save-retry">Thử lưu lại</button>';
    const retry = status.querySelector('.d1-save-retry');
    if (retry) {
      retry.onclick = () => {
        retry.disabled = true;
        persistAnswerBeforeAdvance(
          exerciseId, choice, sessionId, clientAttemptId, nextBtn,
        );
      };
    }
  }

  // Sprint 10.3 — render the "✓ Đã ghi nhận / 📝 Lưu ý" indicator
  // based on the backend response. Three states:
  //
  //   srs_updated=true,  srs_rating='good'  → "✓ Đã ghi nhận vào ôn tập"
  //   srs_updated=true,  srs_rating='again' → "📝 Lưu ý cho lần ôn tới"
  //                      (Sprint 10.3.1-hotfix flipped wrong-rating
  //                      from 'hard' to 'again' so the SRS floor
  //                      actually demotes mastered cards. The label
  //                      stays generic — branch is on != 'good', so
  //                      any non-good rating renders "Lưu ý".)
  //   srs_updated=false  (or any other shape)  → no indicator
  //
  // We append into the existing feedback box (id="feedback") so layout
  // stays stable. The indicator is replaced if onAnswerClick fires
  // multiple times (defensive — shouldn't happen because options are
  // disabled after the first click).
  function renderSrsIndicator(data) {
    if (!data || !data.srs_updated) return;
    const fb = document.getElementById('feedback');
    if (!fb) return;
    // Clear any prior indicator so a fast click+next doesn't stack.
    const prior = fb.querySelector('.d1-srs-indicator');
    if (prior) prior.remove();
    const label = data.srs_rating === 'good'
      ? '✓ Đã ghi nhận vào ôn tập'
      : '📝 Lưu ý cho lần ôn tới';
    const node = document.createElement('div');
    node.className = 'd1-srs-indicator';
    node.textContent = label;
    fb.appendChild(node);
  }

  // One retry with a 500ms backoff covers the common transient-flake case
  // (DNS hiccup, reused-connection RST) without making the user wait long.
  // Any non-2xx OR network error after the retry returns null. The caller keeps
  // Next locked and offers a manual retry with the same idempotency key.
  async function postAttemptWithRetry(exerciseId, choice, sessionId, clientAttemptId) {
    _lastAttemptRateLimit = null;
    const url = `${BASE}/api/exercises/d1/${exerciseId}/attempt`;
    const init = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${_token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        user_answer: choice,
        session_id: sessionId,
        client_attempt_id: clientAttemptId,
      }),
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, init);
        // 429 (rate-limit) is NOT a transient flake — don't retry, but DO
        // keep the learner on this item because no canonical row was written.
        if (res.status === 429) {
          console.warn('[d1] attempt rate-limited (answer remains unsaved)');
          try {
            _lastAttemptRateLimit = (await res.json()).detail || {};
          } catch (_) {
            _lastAttemptRateLimit = {};
          }
          return null;
        }
        if (res.ok) {
          // Sprint 10.3 — return parsed body so the caller can read
          // {srs_updated, srs_rating} and render the indicator. Parse
          // failure is non-fatal: the local grade already rendered.
          try {
            return await res.json();
          } catch (_) {
            return {};
          }
        }
        // Other non-2xx — fall through to retry.
      } catch (err) {
        // Network error — fall through to retry.
        console.warn('[d1] attempt POST attempt', attempt + 1, 'failed:', err);
      }
      if (attempt === 0) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    console.warn('[d1] attempt POST failed after retry (Next remains locked)');
    return null;
  }

  function newClientAttemptId() {
    const cryptoApi = window.crypto;
    if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
    if (!cryptoApi?.getRandomValues) return null;
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function nextExercise() {
    _session.current_index += 1;
    renderCurrentExercise();
  }

  // ── Summary (basic for now; richer version lands in next commit) ─────────

  async function showSummary() {
    // Review sessions never call /complete — there's no backend session row.
    if (_session.is_review || !_session.id) {
      renderSummaryScreen(computeLocalSummary());
      return;
    }

    // Every Next transition was gated on an attempt ACK. Completion itself is
    // also a canonical write: never present a local result as completed until
    // the backend acknowledges that state transition.
    const completingSessionId = _session.id;
    _setHtml('<div class="state-msg"><div class="spinner"></div><p>Đang xác nhận kết quả…</p></div>');
    try {
      const res = await fetch(
        `${BASE}/api/exercises/d1/sessions/${completingSessionId}/complete`,
        { method: 'POST', headers: { 'Authorization': `Bearer ${_token}` } },
      );
      if (!res.ok) {
        renderCompletionError();
        return;
      }
      const summary = await res.json();
      forgetActiveSession(completingSessionId);
      renderSummaryScreen(summary);
    } catch (err) {
      console.warn('[d1] complete-session failed; completion remains pending:', err);
      renderCompletionError();
    }
  }

  function renderCompletionError() {
    _setHtml(`
      <div class="state-msg error d1-completion-error">
        <h2>Chưa thể xác nhận hoàn thành</h2>
        <p>Bài làm đã được lưu, nhưng phiên vẫn chưa được đánh dấu hoàn thành.</p>
        <div class="summary-actions">
          <button class="btn-primary" id="d1-complete-retry">Thử xác nhận lại</button>
          <a class="btn-ghost" href="/exercises">Rời phiên, tiếp tục sau</a>
        </div>
      </div>
    `);
    document.getElementById('d1-complete-retry').onclick = showSummary;
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
    document.getElementById('d1-back-btn').onclick    = () => { window.location.href = '/exercises'; };
    if (wrong.length > 0) {
      const wrongIds = wrong.map(w => w.exercise_id);
      document.getElementById('d1-review-btn').onclick = () => reviewWrong(wrongIds);
    }
  }

  function reviewWrong(wrongIds) {
    // Build a local-only review session from the exercises the user just got
    // wrong. No DB row is created — review attempts skip the persistence gate
    // in onAnswerClick so they don't burn the daily quota
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

  function formatQuotaMessage(detail) {
    const remaining = Number.isFinite(Number(detail?.remaining))
      ? ` Bạn còn ${Number(detail.remaining)} lượt.` : '';
    let reset = '';
    if (detail?.reset_at) {
      const parsed = new Date(detail.reset_at);
      if (!Number.isNaN(parsed.getTime())) reset = ` Có thể thử lại sau ${parsed.toLocaleString('vi-VN')}.`;
    }
    return `Không đủ lượt hôm nay để hoàn thành phiên.${remaining}${reset}`;
  }

  // Expose hooks the summary buttons bind to.
  window._d1 = { startNewSession, reviewWrong };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
