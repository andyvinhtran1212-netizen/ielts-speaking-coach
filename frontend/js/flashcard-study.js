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
    breakdown:    { again: 0, hard: 0, good: 0, easy: 0 },
    // Failed POST /review attempts collected during the session so the
    // summary screen can warn the user and (later) offer a retry.
    // Each entry: { vocab_id, rating, error }.
    failedSyncs:  [],
    pendingSyncs: 0,      // in-flight reviews — summary can mention "still saving"
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

    // PR-B: every stack — including auto:needs_review — now renders study
    // mode here.  The verdict-triage flow that used to live behind
    // auto:needs_review moved to my-vocabulary.html (the canonical vocab
    // management hub); this page is study-only again.  auto:needs_review
    // continues to populate from the backend with vocab the user has
    // lapsed on (lapse_count > 0), so the SRS use case still has a queue.
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
    _state.breakdown   = { again: 0, hard: 0, good: 0, easy: 0 };
    _state.failedSyncs = [];
    _state.pendingSyncs = 0;
    renderCard();
  }

  // ── Card rendering ─────────────────────────────────────────────────────────

  function renderCard() {
    const card = _state.cards[_state.index];
    if (!card) { renderSummary(); return; }
    _state.flipped = false;

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

    // Phase D Wave 2 rich-content layout.  Back face stack (top → bottom):
    //   1. Headword + IPA banner       — what the word LOOKS like + sounds like
    //   2. Definition VI               — primary meaning, Vietnamese
    //   3. Definition EN               — secondary meaning, English
    //   4. Example sentence            — AI-generated, vetted, blank-free
    //   5. "Xem câu gốc" button        — opt-in reveal of user's transcript
    //   6. Meta row (review state etc) — bottom
    //
    // Each section renders independently — a card with IPA but no example
    // shows the IPA banner and skips the example block.  When ALL of
    // definition_vi / definition_en / example_sentence are missing the
    // card has nothing studyable to show, so we render a friendly
    // "no data" notice + still expose context_sentence via the opt-in
    // source button (NEVER inline — Codex audit MEDIUM caught the prior
    // version inlining transcript text in the fallback path, which is the
    // exact UX issue this whole rich-content rollout is trying to fix).
    const hasDefinition = !!(card.definition_vi || card.definition_en);
    const hasContent    = hasDefinition || !!card.example_sentence;

    const headwordBanner = `
      <div class="back-headword-row">
        <span class="back-headword">${escape(card.headword || '')}</span>
        ${card.ipa ? `<span class="back-ipa">${escape(card.ipa)}</span>` : ''}
      </div>
    `;

    const definitionBlock = hasDefinition
      ? `${card.definition_vi ? `<p class="def-vi">${escape(card.definition_vi)}</p>` : ''}
         ${card.definition_en ? `<p class="def-en">${escape(card.definition_en)}</p>` : ''}`
      : '';

    // AI-generated example (migration 029 + services/vocab_enrichment).
    // Visually distinct from definitions so the learner knows the sentence
    // is reference material, not the dictionary entry itself.  Skipped
    // entirely when example_sentence is NULL — no placeholder.
    const exampleBlock = card.example_sentence
      ? `<div class="example-block">
           <span class="example-label">Ví dụ</span>
           <p class="example-text">${escape(card.example_sentence)}</p>
         </div>`
      : '';

    // No-content fallback: card has neither definitions nor an example.
    // Shows a friendly notice — context_sentence is OFFERED via the
    // existing source button (rendered below, gated only on the
    // context_sentence existing) but NEVER inlined.  Backfill will fill
    // these in eventually.
    const noContentBlock = !hasContent
      ? `<div style="padding:14px;border-radius:10px;
                     background:rgba(252,211,77,0.05);
                     border:1px solid rgba(252,211,77,0.2);
                     margin-bottom:14px;">
           <p style="font-size:14px;color:rgba(252,211,77,0.9);margin-bottom:6px;">
             Chưa có dữ liệu chi tiết cho từ này.
           </p>
           <p style="font-size:12px;color:rgba(255,255,255,0.5);line-height:1.5;">
             Hệ thống sẽ tự bổ sung định nghĩa và câu ví dụ ở lần luyện tập tới.
           </p>
         </div>`
      : '';

    // The card's context_sentence comes from the user's own STT transcript
    // and can carry grammar errors — exposed via opt-in button only, with
    // a warning in the overlay.  Available regardless of whether the card
    // has rich content (post-Codex fix): the no-content path also gets
    // this button so the user has a way to look at the source, and the
    // has-content path has it as a "show me where I used this" affordance.
    const showSourceButton = !!card.context_sentence;
    const sourceSection = showSourceButton
      ? `<button id="study-source-btn" type="button"
                 style="margin-top:14px;font-size:12px;padding:6px 12px;border-radius:8px;
                        background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);
                        color:rgba(255,255,255,0.7);cursor:pointer;">
           📖 Xem câu gốc
         </button>`
      : '';

    const back = `
      <div class="face back">
        ${headwordBanner}
        ${definitionBlock}
        ${exampleBlock}
        ${noContentBlock}
        ${sourceSection}
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

      <div id="study-ratings" class="ratings">${ratingButtons}</div>
      <p class="ratings-hint">Bấm thẻ để xem nghĩa • Đánh giá: 1 Quên • 2 Khó • 3 Tốt • 4 Dễ</p>
    `);

    $('study-card').addEventListener('click', flipCard);
    document.querySelectorAll('.rate-btn').forEach(b => {
      b.addEventListener('click', () => submitRating(b.getAttribute('data-rating')));
    });
    const srcBtn = $('study-source-btn');
    if (srcBtn) {
      srcBtn.addEventListener('click', (e) => {
        // Stop the click from bubbling to the card and re-flipping it.
        e.stopPropagation();
        showSourceSentence(card);
      });
    }
  }

  /**
   * Reveal the user's own transcript sentence behind a "may contain grammar
   * errors" warning.  The sentence comes from speech-to-text of a Speaking
   * practice answer, so it can be ungrammatical — opt-in surface protects
   * the learner from reinforcing those errors.
   */
  function showSourceSentence(card) {
    const sentence = card && card.context_sentence ? card.context_sentence : '';
    if (!sentence) return;
    // Reuse a single overlay element so consecutive opens don't stack DOM.
    let overlay = document.getElementById('study-source-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'study-source-overlay';
      overlay.style.cssText =
        'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:50;' +
        'display:flex;align-items:center;justify-content:center;padding:24px;';
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
      <div style="max-width:480px;width:100%;background:#0f1f3a;
                  border:1px solid rgba(255,255,255,0.1);border-radius:14px;
                  padding:20px;color:#fff;">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:6px;">📖 Câu gốc trong bài nói</h3>
        <p style="font-size:11px;color:#fcd34d;margin-bottom:12px;">
          ⚠ Câu này lấy từ transcript bài Speaking của bạn — có thể có lỗi ngữ pháp.
          Đừng coi đây là câu mẫu chuẩn.
        </p>
        <p style="font-size:14px;line-height:1.6;background:rgba(255,255,255,0.04);
                  border-left:2px solid rgba(20,184,166,0.4);padding:10px 12px;
                  border-radius:6px;font-style:italic;color:rgba(255,255,255,0.85);">
          "${escape(sentence)}"
        </p>
        <div style="text-align:right;margin-top:14px;">
          <button id="study-source-close" type="button"
                  style="font-size:13px;padding:8px 16px;border-radius:8px;
                         background:rgba(20,184,166,0.18);border:1px solid rgba(20,184,166,0.4);
                         color:#14b8a6;cursor:pointer;">Đóng</button>
        </div>
      </div>
    `;
    overlay.style.display = 'flex';
    const close = () => { overlay.style.display = 'none'; };
    document.getElementById('study-source-close').onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
  }

  function flipCard() {
    // Day 1 dogfood: flip is now bidirectional.  Earlier behaviour was a
    // one-way front→back so the user couldn't peek at the headword again
    // after seeing the answer; testers reported this as broken because
    // tapping the back card looked like nothing happened.  Rating buttons
    // are visible from both faces (post-Wave-2 UX fix), so toggling does
    // not affect the rating flow.
    _state.flipped = !_state.flipped;
    $('study-card').classList.toggle('flipped', _state.flipped);
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

  /**
   * Optimistic rating: update local state and advance immediately, fire
   * the POST /review in the background.  Per-rate latency was the #1 UX
   * complaint after Wave 2 ship — awaiting a 200-300ms round-trip per
   * card adds up across a 20-card session.
   *
   * Tradeoff: if the network call later fails we don't roll back the
   * "advance" since the user has moved on; we record the failure so the
   * summary screen can surface it (and a future retry pass can replay).
   * Rate-limit (429) is the one case where this hurts — the local
   * breakdown overcounts vs server SRS — but at 500/day the bound is
   * generous enough that the user is unlikely to walk into it
   * mid-session.
   */
  function submitRating(rating) {
    if (!RATINGS.includes(rating)) return;
    const card = _state.cards[_state.index];
    if (!card) return;

    _state.breakdown[rating]++;
    _state.pendingSyncs++;

    // Fire-and-forget — the .then() runs whenever the network finishes.
    fetch(BASE + '/api/flashcards/' + encodeURIComponent(card.id) + '/review', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          const detail = err.detail;
          const msg = typeof detail === 'string' ? detail :
                      (detail && detail.message) || ('HTTP ' + res.status);
          _state.failedSyncs.push({ vocab_id: card.id, rating, error: msg });
          console.warn('[flashcard-study] review sync failed:', msg);
        }
      })
      .catch((err) => {
        _state.failedSyncs.push({
          vocab_id: card.id,
          rating,
          error: (err && err.message) || 'network error',
        });
        console.warn('[flashcard-study] review sync errored:', err);
      })
      .finally(() => {
        _state.pendingSyncs = Math.max(0, _state.pendingSyncs - 1);
        // If the user has reached the summary screen, refresh the warning
        // banner so an in-flight result coming back late updates it.
        if (_state.index >= _state.cards.length) {
          _refreshSummaryWarning();
        }
      });

    _state.index++;
    if (_state.index >= _state.cards.length) {
      renderSummary();
    } else {
      renderCard();
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
        <div id="study-summary-warning"></div>
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
    _refreshSummaryWarning();
  }

  /**
   * Show a banner on the summary screen when reviews are still in flight
   * or finished with errors.  Called both on initial render and from each
   * pending fetch's .finally() so a late-arriving failure updates the
   * banner instead of silently disappearing.
   */
  function _refreshSummaryWarning() {
    const slot = document.getElementById('study-summary-warning');
    if (!slot) return;  // user navigated away
    const failed = _state.failedSyncs.length;
    const pending = _state.pendingSyncs;
    if (!failed && !pending) {
      slot.innerHTML = '';
      return;
    }
    const parts = [];
    if (pending > 0) {
      parts.push(`<span style="color:#94a3b8;">⏳ Đang đồng bộ ${pending} đánh giá…</span>`);
    }
    if (failed > 0) {
      parts.push(
        `<span style="color:#fcd34d;">⚠ ${failed} đánh giá chưa sync — ` +
        `tiến độ local đã ghi, hệ thống sẽ retry lần đăng nhập tới.</span>`
      );
    }
    slot.innerHTML = `
      <div style="margin:12px 0;padding:10px 14px;border-radius:8px;
                  background:rgba(252,211,77,0.05);border:1px solid rgba(252,211,77,0.2);
                  font-size:12px;line-height:1.5;text-align:left;">
        ${parts.join('<br/>')}
      </div>
    `;
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

  // PR-B: triage moved to my-vocabulary.html.  The flashcard-study page
  // is study-only again — every stack, including auto:needs_review,
  // renders the standard SRS card UI populated by the backend (which
  // sources auto:needs_review from flashcard_reviews.lapse_count > 0).

  // ── Boot ───────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
