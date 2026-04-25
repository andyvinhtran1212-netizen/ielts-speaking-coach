/**
 * d1-exercise.js — Fill-blank exercise UI logic.
 *
 * Flow:
 *   /auth/me  → flag check → /api/exercises/d1 (queue)
 *   user picks an option → POST /attempt → mark correct/incorrect → reveal "Next"
 *
 * Endpoint contract: GET /api/exercises/d1 returns an array of
 *   { id, exercise_type, content: { sentence, distractors }, _answer_hint_available }
 * (the answer is intentionally absent from the user-facing payload).
 */

(function () {
  const BASE = window.api ? window.api.base : (() => {
    const h = location.hostname;
    return (h === 'localhost' || h === '127.0.0.1')
      ? 'http://localhost:8000'
      : 'https://ielts-speaking-coach-production.up.railway.app';
  })();

  let _token = null;
  let _queue = [];           // [{ id, content }]
  let _currentIndex = 0;
  let _completed = 0;
  let _locked = false;       // prevents double-submit while a request is in flight

  // ── Init ──────────────────────────────────────────────────────────────────

  async function init() {
    showState('loading');
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
      if (!meRes.ok) { showState('disabled'); return; }
      const me = await meRes.json();
      if (me.d1_enabled !== true) { showState('disabled'); return; }
    } catch (_) {
      showState('disabled');
      return;
    }

    await loadQueue();
  }

  // ── Queue load ────────────────────────────────────────────────────────────

  async function loadQueue() {
    try {
      const res = await fetch(`${BASE}/api/exercises/d1?limit=10`, {
        headers: { Authorization: `Bearer ${_token}` },
      });
      if (res.status === 403) { showState('disabled'); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const items = await res.json();
      if (!Array.isArray(items) || items.length === 0) {
        showState('empty');
        return;
      }
      _queue = items;
      _currentIndex = 0;
      _completed = 0;
      renderCurrent();
    } catch (err) {
      console.error('[d1] load failed:', err);
      showState('error');
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function renderCurrent() {
    if (_currentIndex >= _queue.length) {
      // All done — fetch a fresh batch.
      loadQueue();
      return;
    }
    showState('stage');
    _locked = false;

    const item = _queue[_currentIndex];
    const content = item.content || {};
    const sentence = content.sentence || '';
    const options = shuffle([...(content.distractors || []), content.answer]
      .filter(Boolean));

    // Strip the answer if the backend ever includes it (defensive).
    const distractors = content.distractors || [];
    const renderable = distractors.length === 3
      ? options                          // 3 distractors + 1 answer when answer is present
      : shuffle(distractors);            // backend omits answer; just show distractors

    const finalOptions = (renderable.length === 4)
      ? renderable
      : (function () {
          // Backend strips answer; the user picks from distractors and types correctness
          // is judged server-side. We render all options the backend returned.
          return renderable;
        })();

    document.getElementById('prompt').innerHTML = renderSentence(sentence);

    const optsEl = document.getElementById('options');
    optsEl.innerHTML = finalOptions.map((opt, i) =>
      `<button class="opt-btn" data-opt="${esc(opt)}" data-idx="${i}">${esc(opt)}</button>`
    ).join('');
    Array.from(optsEl.querySelectorAll('.opt-btn')).forEach(btn => {
      btn.addEventListener('click', onPick);
    });

    document.getElementById('feedback').classList.add('hidden');
    document.getElementById('next-btn').classList.add('hidden');

    document.getElementById('progress-counter').textContent =
      `${_completed + 1} / ${_queue.length}`;
  }

  function renderSentence(sentence) {
    // Replace ___ with a styled blank token.
    const safe = esc(sentence);
    return safe.replace('___', '<span class="blank-token">_____</span>');
  }

  // ── Submit attempt ────────────────────────────────────────────────────────

  async function onPick(evt) {
    if (_locked) return;
    _locked = true;
    const btn = evt.currentTarget;
    const choice = btn.getAttribute('data-opt');
    const item = _queue[_currentIndex];

    let result;
    try {
      const res = await fetch(`${BASE}/api/exercises/d1/${item.id}/attempt`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ user_answer: choice }),
      });
      if (res.status === 429) {
        const detail = await res.json().catch(() => ({}));
        const reset = detail?.detail?.reset_at;
        const note = reset ? `Resets at ${new Date(reset).toLocaleString()}.` : 'Try again tomorrow.';
        document.getElementById('rate-limited-detail').textContent = note;
        showState('rate-limited');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      result = await res.json();
    } catch (err) {
      console.error('[d1] attempt failed:', err);
      _locked = false;
      return;
    }

    // Mark choice + correct
    Array.from(document.querySelectorAll('.opt-btn')).forEach(b => {
      b.disabled = true;
      const optVal = b.getAttribute('data-opt');
      if (optVal === result.correct_answer) b.classList.add('correct');
      else if (optVal === choice && !result.is_correct) b.classList.add('incorrect');
      else b.classList.add('dimmed');
    });

    const fb = document.getElementById('feedback');
    fb.classList.remove('hidden', 'fb-correct', 'fb-incorrect');
    if (result.is_correct) {
      fb.classList.add('fb-correct');
      fb.textContent = '✓ Correct!';
    } else {
      fb.classList.add('fb-incorrect');
      fb.textContent = `✗ The answer is "${result.correct_answer}".`;
    }

    _completed += 1;
    const nextBtn = document.getElementById('next-btn');
    nextBtn.classList.remove('hidden');
    nextBtn.onclick = function () { _currentIndex += 1; renderCurrent(); };
  }

  // ── State helpers ─────────────────────────────────────────────────────────

  function showState(state) {
    ['loading', 'disabled', 'empty', 'error', 'rate-limited'].forEach(s => {
      const el = document.getElementById(`state-${s}`);
      if (el) el.classList.toggle('hidden', s !== state);
    });
    document.getElementById('stage').classList.toggle('hidden', state !== 'stage');
  }

  // ── Util ──────────────────────────────────────────────────────────────────

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
