/**
 * flashcard-study.js — Phase D Wave 2 study session.
 *
 * URL: flashcard-study.html?stack=<id>     (auto:* or UUID)
 *
 * Flow:
 *   /auth/me  → flag check
 *   GET /api/flashcards/stacks/{id}/cards → render queue
 *   click card / press Space → flip front ↔ back
 *   click rating / press 1-4 → POST /flashcards/{vocab_id}/review
 *                              → advance to next card
 *   end of queue → summary screen with breakdown + actions
 *
 * Rating fires fire-and-forget so the user never waits on the network
 * between cards; we still refuse to advance if the request fails so the
 * SRS state stays consistent (a "Lỗi mạng — thử lại" toast surfaces it).
 */

(function () {
  const BASE = window.api.base;
  const RATINGS = ['again', 'hard', 'good', 'easy'];
  const HOTKEYS = { '1': 'again', '2': 'hard', '3': 'good', '4': 'easy', ' ': '__flip' };

  let _token = null;
  const _state = {
    stackId: null,
    cards:   [],          // [{id, headword, definition_vi, ...}]
    index:   0,
    flipped: false,
    breakdown: { again: 0, hard: 0, good: 0, easy: 0 },
    submitting: false,    // guard so a double-click doesn't double-submit a rating
  };

  // ── Helpers ────────────────────────────────────────────────────────────────

  function $(id) { return document.getElementById(id); }
  function setHtml(id, html) { $(id).innerHTML = html; }
  function escape(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }
  function showLoading() {
    setHtml('study-container', '<div class="state-msg"><div class="spinner"></div></div>');
  }
  function showState(msg, isError) {
    const cls = isError ? 'state-msg error' : 'state-msg';
    setHtml('study-container', `<div class="${cls}">${escape(msg)}</div>`);
  }

  async function getToken() {
    const sb = window.getSupabase ? window.getSupabase() : null;
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data?.session?.access_token || null;
  }
  function authHeaders() { return { Authorization: 'Bearer ' + _token }; }

  // ── Init ───────────────────────────────────────────────────────────────────

  async function init() {
    showLoading();
    _token = await getToken();
    if (!_token) {
      window.location.href = window.api.url('index.html');
      return;
    }

    const params = new URLSearchParams(window.location.search);
    _state.stackId = (params.get('stack') || '').trim();
    if (!_state.stackId) {
      showState('Thiếu tham số stack — quay lại danh sách Flashcards.', true);
      return;
    }

    try {
      const meRes = await fetch(BASE + '/auth/me', { headers: authHeaders() });
      if (!meRes.ok) { showState('Tính năng chưa được bật.'); return; }
      const me = await meRes.json();
      if (me.flashcard_enabled !== true) {
        showState('Tính năng chưa được bật.');
        return;
      }
    } catch (_) { showState('Tính năng chưa được bật.'); return; }

    await loadCards();

    document.addEventListener('keydown', onHotkey);
  }

  async function loadCards() {
    showLoading();
    try {
      const url = BASE + '/api/flashcards/stacks/' + encodeURIComponent(_state.stackId) + '/cards';
      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) {
        if (res.status === 404) {
          showState('Stack không tồn tại hoặc đã bị xoá.', true);
          return;
        }
        showState('Không tải được thẻ.', true);
        return;
      }
      const body = await res.json();
      _state.cards = Array.isArray(body.cards) ? body.cards : [];
    } catch (err) {
      console.error('[flashcard-study] load', err);
      showState('Không tải được thẻ. Thử lại sau.', true);
      return;
    }

    if (!_state.cards.length) {
      showState('Stack chưa có thẻ nào để học.');
      return;
    }

    _state.index = 0;
    _state.flipped = false;
    _state.breakdown = { again: 0, hard: 0, good: 0, easy: 0 };
    renderCard();
  }

  // ── Card rendering ─────────────────────────────────────────────────────────

  function renderCard() {
    const card = _state.cards[_state.index];
    if (!card) { renderSummary(); return; }
    _state.flipped = false;
    _state.submitting = false;

    const total   = _state.cards.length;
    const current = _state.index + 1;
    const pct     = Math.round((_state.index / total) * 100);

    const topicTag = card.topic
      ? `<span class="topic-tag">${escape(card.topic)}</span>`
      : '';

    const ratingButtons = RATINGS.map((r, i) => `
      <button class="rate-btn rate-${r}" data-rating="${r}">
        <span class="label">${rateLabel(r)}</span>
        <span class="interval">${formatNextInterval(card, r)}</span>
        <span class="hotkey">${i + 1}</span>
      </button>
    `).join('');

    const back = `
      <div class="face back">
        <p class="def-vi">${escape(card.definition_vi || '—')}</p>
        ${card.definition_en ? `<p class="def-en">${escape(card.definition_en)}</p>` : ''}
        ${card.context_sentence ? `<p class="context">"${escape(card.context_sentence)}"</p>` : ''}
        <div class="meta-row">
          ${card.source_type ? `<span>${sourceTypeLabel(card.source_type)}</span>` : ''}
          ${card.review ? `<span>Lần ôn: ${card.review.review_count} • Hệ số: ${Number(card.review.ease_factor).toFixed(2)}</span>` : '<span>Thẻ mới</span>'}
        </div>
      </div>
    `;

    setHtml('study-container', `
      <div class="progress-header">
        <span class="progress-text">${current} / ${total}</span>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>

      <div class="card-stage">
        <div id="study-card" class="flashcard">
          <div class="face front">
            ${topicTag}
            <p class="headword" style="margin-top:14px">${escape(card.headword || '')}</p>
            <p class="flip-hint">Tap / Space để xem nghĩa</p>
          </div>
          ${back}
        </div>
      </div>

      <div id="study-ratings" class="ratings hidden-prompt">${ratingButtons}</div>
      <p class="ratings-hint">Lật thẻ rồi tự đánh giá: 1 Quên • 2 Khó • 3 Tốt • 4 Dễ</p>
    `);

    $('study-card').addEventListener('click', flipCard);
    document.querySelectorAll('.rate-btn').forEach(b => {
      b.addEventListener('click', () => submitRating(b.getAttribute('data-rating')));
    });
  }

  function flipCard() {
    if (_state.flipped) return;
    _state.flipped = true;
    $('study-card').classList.add('flipped');
    $('study-ratings').classList.remove('hidden-prompt');
  }

  function rateLabel(r) {
    return ({ again: 'Quên', hard: 'Khó', good: 'Tốt', easy: 'Dễ' })[r] || r;
  }

  function sourceTypeLabel(s) {
    return ({
      used_well: '✅ Dùng tốt',
      needs_review: '⚠ Cần ôn',
      upgrade_suggested: '⬆ Có thể nâng cấp',
      manual: '✍ Tự thêm',
    })[s] || s;
  }

  /**
   * Best-effort hint for what the next interval would be — pulls the current
   * SRS state off the card and runs the same arithmetic as backend
   * services/srs.update_srs.  If the math drifts from the backend the rating
   * still fires correctly (backend is authoritative); the hint is purely UX.
   */
  function formatNextInterval(card, rating) {
    const r = card.review;
    const ease     = r ? Number(r.ease_factor)   : 2.5;
    const interval = r ? Number(r.interval_days) : 1;
    let next;
    switch (rating) {
      case 'again': next = 0;                                                break;
      case 'hard':  next = Math.max(1, Math.floor(interval * 1.2));          break;
      case 'good':  next = Math.max(1, Math.floor(interval * ease));         break;
      case 'easy':  next = Math.max(1, Math.floor(interval * ease * 1.3));   break;
      default:      next = 1;
    }
    return next === 0 ? 'Hôm nay' : (next < 30 ? `${next} ngày` : `${Math.round(next/30)} tháng`);
  }

  // ── Rating + advance ───────────────────────────────────────────────────────

  async function submitRating(rating) {
    if (!_state.flipped) { flipCard(); return; }
    if (_state.submitting) return;
    if (!RATINGS.includes(rating)) return;

    const card = _state.cards[_state.index];
    if (!card) return;
    _state.submitting = true;
    document.querySelectorAll('.rate-btn').forEach(b => b.disabled = true);

    try {
      const res = await fetch(BASE + '/api/flashcards/' + encodeURIComponent(card.id) + '/review', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const detail = err.detail;
        // Rate-limit detail comes back as an object — surface the message.
        const msg = typeof detail === 'string' ? detail :
                    (detail && detail.message) || 'Không gửi được đánh giá.';
        // Re-enable buttons so the user can retry — don't advance.
        _state.submitting = false;
        document.querySelectorAll('.rate-btn').forEach(b => b.disabled = false);
        showFlashError(msg);
        return;
      }
      _state.breakdown[rating]++;
    } catch (err) {
      console.error('[flashcard-study] review', err);
      _state.submitting = false;
      document.querySelectorAll('.rate-btn').forEach(b => b.disabled = false);
      showFlashError('Lỗi mạng — thử lại.');
      return;
    }

    _state.index++;
    if (_state.index >= _state.cards.length) {
      renderSummary();
    } else {
      renderCard();
    }
  }

  function showFlashError(msg) {
    const hint = document.querySelector('.ratings-hint');
    if (hint) {
      hint.textContent = msg;
      hint.style.color = '#fca5a5';
      setTimeout(() => {
        hint.textContent = 'Lật thẻ rồi tự đánh giá: 1 Quên • 2 Khó • 3 Tốt • 4 Dễ';
        hint.style.color = '';
      }, 3000);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  function renderSummary() {
    document.removeEventListener('keydown', onHotkey);
    const total = _state.cards.length;
    const b = _state.breakdown;
    setHtml('study-container', `
      <div class="summary">
        <h2>Hoàn thành phiên!</h2>
        <p>Bạn đã ôn ${total} thẻ. Tiến độ SRS đã được lưu tự động.</p>
        <p class="big-num">${total}</p>
        <div class="breakdown">
          <div class="cell"><div class="num" style="color:#fca5a5">${b.again}</div><div class="label">Quên</div></div>
          <div class="cell"><div class="num" style="color:#fcd34d">${b.hard}</div><div class="label">Khó</div></div>
          <div class="cell"><div class="num" style="color:#5eead4">${b.good}</div><div class="label">Tốt</div></div>
          <div class="cell"><div class="num" style="color:#93c5fd">${b.easy}</div><div class="label">Dễ</div></div>
        </div>
        <div class="summary-actions">
          <a href="flashcards.html" class="btn-secondary">Học stack khác</a>
          <a href="dashboard.html" class="btn-ghost">Về dashboard</a>
        </div>
      </div>
    `);
  }

  // ── Hotkeys ────────────────────────────────────────────────────────────────

  function onHotkey(e) {
    // Don't hijack typing in inputs (no inputs on this page today, but the
    // guard is cheap).
    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const key = e.key.toLowerCase();
    const action = HOTKEYS[key] || HOTKEYS[e.key];
    if (!action) return;
    e.preventDefault();
    if (action === '__flip') {
      flipCard();
    } else {
      submitRating(action);
    }
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
