/* frontend/js/feedback-widgets.js — Feedback PR-2 (student surfaces).
 *
 * Shared widgets for the Reading + Listening review pages. Three surfaces, all
 * posting to the PR-1 endpoint POST /api/feedback:
 *   • mountSurvey(host, ctx)   — one-time "rate this test" card (rating_de
 *                                [+ rating_audio for listening] + comment + a
 *                                "Báo lỗi" link). Show-once per attempt.
 *   • openReportModal(ctx)     — "báo lỗi đề" modal: category chips (per skill)
 *                                + optional q_num chips + optional note.
 *   • attachCardFlag(opts)     — per-question "flag bài giải" button → inline
 *                                popover with optional note → POST type=flag.
 *
 * Identity: logged-in → bearer (window.api.post); anonymous reading share-link
 * → window.api.postWith(..., {'X-Reading-Anon': anonId}). The server derives
 * created_by/anon_id + test_id — we only send skill/attempt_id/payload.
 *
 * No build step (static site). Token-mapped styling lives in /css/feedback.css.
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── show-once state (per attempt) ──────────────────────────────────────────
  function _key(attemptId) { return 'av-fb-survey:' + attemptId; }
  function surveyDone(attemptId) {
    try { return !!localStorage.getItem(_key(attemptId)); } catch (e) { return false; }
  }
  function markSurveyDone(attemptId, how) {
    try { localStorage.setItem(_key(attemptId), how || 'done'); } catch (e) {}
  }

  // ── POST helper — picks authed vs anon (reading share-link) ─────────────────
  // Anchor: attempt_id (test review) HOẶC passage_slug / content_id
  // (practice + exercise lẻ — 2026-07-17 audit extension).
  function submit(ctx, payload) {
    var body = Object.assign({ skill: ctx.skill }, payload);
    if (ctx.attemptId) body.attempt_id = ctx.attemptId;
    if (ctx.passageSlug) body.passage_slug = ctx.passageSlug;
    if (ctx.contentId) body.content_id = ctx.contentId;
    if (ctx.anonId && window.api.postWith) {
      return window.api.postWith('/api/feedback', body, { 'X-Reading-Anon': ctx.anonId }, { noRedirect: true });
    }
    return window.api.post('/api/feedback', body);
  }

  var CATEGORIES = {
    // skill → [{ value, label }]; listening adds the audio option.
    reading: [
      { value: 'wrong_answer', label: 'Sai đáp án' },
      { value: 'unclear_typo', label: 'Đề khó hiểu / lỗi chính tả' },
      { value: 'other', label: 'Khác' },
    ],
    listening: [
      { value: 'wrong_answer', label: 'Sai đáp án' },
      { value: 'audio_issue', label: 'Lỗi audio' },
      { value: 'unclear_typo', label: 'Đề khó hiểu / lỗi chính tả' },
      { value: 'other', label: 'Khác' },
    ],
  };

  // ── 1. SURVEY ───────────────────────────────────────────────────────────────
  function mountSurvey(host, ctx) {
    if (!host || !ctx || !ctx.attemptId) return;
    if (surveyDone(ctx.attemptId)) return;
    if (host.querySelector('.fb-survey')) return;   // idempotent (reading re-renders per part)

    var audioRow = ctx.hasAudio ? (
      '<div class="fb-qrow">' +
        '<label id="fb-audio-lbl">Chất lượng audio</label>' +
        '<div class="fb-rating" role="radiogroup" aria-labelledby="fb-audio-lbl" data-rating="audio">' +
          _ratingButtons() +
        '</div>' +
        '<div class="fb-rating-scale"><span>Khó nghe</span><span>Rõ</span></div>' +
      '</div>') : '';

    var card = document.createElement('section');
    card.className = 'av-fb fb-survey';
    card.setAttribute('aria-label', 'Khảo sát chất lượng đề');
    card.innerHTML =
      '<div class="fb-survey__head">' +
        '<div class="fb-survey__ic" aria-hidden="true">★</div>' +
        '<div><h3 class="fb-survey__title">Đề này thế nào?</h3>' +
        '<p class="fb-survey__sub">Đánh giá giúp bọn mình cải thiện chất lượng đề. Bỏ qua nếu muốn.</p></div>' +
      '</div>' +
      '<div class="fb-qrow">' +
        '<label id="fb-de-lbl">Chất lượng đề</label>' +
        '<div class="fb-rating" role="radiogroup" aria-labelledby="fb-de-lbl" data-rating="de">' +
          _ratingButtons() +
        '</div>' +
        '<div class="fb-rating-scale"><span>Kém</span><span>Tốt</span></div>' +
      '</div>' +
      audioRow +
      '<div class="fb-qrow">' +
        '<label for="fb-survey-note">Góp ý thêm <span class="fb-opt">· không bắt buộc</span></label>' +
        '<textarea id="fb-survey-note" class="fb-textarea" placeholder="Phần nào hay/dở, độ khó, gợi ý…"></textarea>' +
      '</div>' +
      '<div class="fb-survey__foot">' +
        '<button type="button" class="fb-btn fb-btn--primary" data-act="send">Gửi đánh giá</button>' +
        '<button type="button" class="fb-btn fb-btn--ghost" data-act="dismiss">Bỏ qua</button>' +
        '<button type="button" class="fb-report-link" data-act="report">⚑ Báo lỗi trong đề</button>' +
      '</div>' +
      '<p class="fb-survey__msg" role="status" aria-live="polite" hidden></p>';

    host.insertBefore(card, host.firstChild);
    _wireRatingGroups(card);

    function close() { card.remove(); }
    function msg(text, ok) {
      var m = card.querySelector('.fb-survey__msg');
      m.textContent = text; m.hidden = false;
      m.classList.toggle('is-ok', !!ok); m.classList.toggle('is-err', !ok);
    }

    card.querySelector('[data-act="dismiss"]').addEventListener('click', function () {
      markSurveyDone(ctx.attemptId, 'dismissed'); close();
    });
    card.querySelector('[data-act="report"]').addEventListener('click', function () {
      openReportModal(ctx);
    });
    card.querySelector('[data-act="send"]').addEventListener('click', function () {
      var de = _selectedRating(card, 'de');
      if (!de) { msg('Chọn số sao cho “Chất lượng đề” trước nhé.', false); return; }
      var payload = { type: 'rating', rating_de: de };
      var audio = _selectedRating(card, 'audio');
      if (ctx.hasAudio && audio) payload.rating_audio = audio;
      var note = card.querySelector('#fb-survey-note').value.trim();
      if (note) payload.note = note;
      var btn = card.querySelector('[data-act="send"]');
      btn.disabled = true;
      submit(ctx, payload).then(function () {
        markSurveyDone(ctx.attemptId, 'submitted');
        msg('Cảm ơn bạn đã đánh giá! 🎉', true);
        setTimeout(close, 1200);
      }).catch(function (e) {
        if (e && /409/.test(String(e.message || e))) {   // already rated this attempt
          markSurveyDone(ctx.attemptId, 'submitted');
          msg('Bạn đã đánh giá đề này rồi.', true);
          setTimeout(close, 1200);
        } else {
          btn.disabled = false;
          msg('Không gửi được, thử lại sau.', false);
        }
      });
    });
  }

  function _ratingButtons() {
    var out = '';
    for (var i = 1; i <= 5; i++) {
      out += '<button type="button" class="fb-star" role="radio" aria-checked="false" ' +
             'data-val="' + i + '" aria-label="' + i + ' sao">' + i + '</button>';
    }
    return out;
  }
  function _wireRatingGroups(root) {
    root.querySelectorAll('.fb-rating').forEach(function (group) {
      group.addEventListener('click', function (e) {
        var b = e.target.closest('.fb-star'); if (!b) return;
        group.querySelectorAll('.fb-star').forEach(function (x) {
          var on = x === b;
          x.setAttribute('aria-checked', on ? 'true' : 'false');
          x.classList.toggle('is-on', on);
        });
      });
    });
  }
  function _selectedRating(root, which) {
    var sel = root.querySelector('.fb-rating[data-rating="' + which + '"] .fb-star.is-on');
    return sel ? Number(sel.getAttribute('data-val')) : null;
  }

  // ── 2. REPORT MODAL ──────────────────────────────────────────────────────────
  function openReportModal(ctx) {
    var prev = document.querySelector('.fb-modal-scrim');
    if (prev) prev.remove();
    var lastFocus = document.activeElement;

    var cats = CATEGORIES[ctx.skill] || CATEGORIES.reading;
    var catChips = cats.map(function (c) {
      return '<button type="button" class="fb-chip" role="radio" aria-checked="false" data-cat="' +
             esc(c.value) + '">' + esc(c.label) + '</button>';
    }).join('');
    var qnums = (ctx.qNums || []).map(function (n) {
      return '<button type="button" class="fb-qnum" aria-pressed="false" data-q="' + n + '">' + n + '</button>';
    }).join('');

    var scrim = document.createElement('div');
    scrim.className = 'av-fb fb-modal-scrim';
    scrim.innerHTML =
      '<div class="fb-modal" role="dialog" aria-modal="true" aria-labelledby="fb-modal-title">' +
        '<div class="fb-modal__head">' +
          '<div class="fb-modal__ic fb-modal__ic--flag" aria-hidden="true">⚑</div>' +
          '<h3 id="fb-modal-title">Báo lỗi trong đề</h3>' +
          '<button type="button" class="fb-modal__x" data-act="close" aria-label="Đóng">×</button>' +
        '</div>' +
        '<div class="fb-modal__body">' +
          '<label class="fb-field-label">Loại lỗi</label>' +
          '<div class="fb-chips" role="radiogroup" aria-label="Loại lỗi">' + catChips + '</div>' +
          (qnums ? ('<label class="fb-field-label">Ở câu nào? <span class="fb-opt">· không bắt buộc</span></label>' +
                    '<div class="fb-qnums">' + qnums + '</div>') : '') +
          '<label class="fb-field-label" for="fb-report-note">Mô tả lỗi <span class="fb-opt">· không bắt buộc</span></label>' +
          '<textarea id="fb-report-note" class="fb-textarea" placeholder="VD: đáp án câu 2 phải là “5th”, audio nhiễu ở đoạn 1:40…"></textarea>' +
          '<p class="fb-modal__msg" role="status" aria-live="polite" hidden></p>' +
        '</div>' +
        '<div class="fb-modal__foot">' +
          '<button type="button" class="fb-btn fb-btn--ghost" data-act="close">Huỷ</button>' +
          '<button type="button" class="fb-btn fb-btn--flag" data-act="send">Gửi báo lỗi</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(scrim);

    var dialog = scrim.querySelector('.fb-modal');
    var selectedCat = null, selectedQ = null;

    // single-select category chips
    scrim.querySelectorAll('.fb-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        selectedCat = chip.getAttribute('data-cat');
        scrim.querySelectorAll('.fb-chip').forEach(function (c) {
          var on = c === chip;
          c.setAttribute('aria-checked', on ? 'true' : 'false');
          c.classList.toggle('is-on', on);
        });
      });
    });
    // q_num chips toggle (single-select, click-again clears)
    scrim.querySelectorAll('.fb-qnum').forEach(function (qb) {
      qb.addEventListener('click', function () {
        var was = qb.getAttribute('aria-pressed') === 'true';
        scrim.querySelectorAll('.fb-qnum').forEach(function (x) {
          x.setAttribute('aria-pressed', 'false'); x.classList.remove('is-on');
        });
        selectedQ = was ? null : Number(qb.getAttribute('data-q'));
        if (!was) { qb.setAttribute('aria-pressed', 'true'); qb.classList.add('is-on'); }
      });
    });

    function close() {
      document.removeEventListener('keydown', onKey);
      scrim.remove();
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    function modalMsg(text, ok) {
      var m = scrim.querySelector('.fb-modal__msg');
      m.textContent = text; m.hidden = false;
      m.classList.toggle('is-ok', !!ok); m.classList.toggle('is-err', !ok);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'Tab') {   // focus trap
        var f = dialog.querySelectorAll('button, textarea, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKey);
    scrim.addEventListener('mousedown', function (e) { if (e.target === scrim) close(); });
    scrim.querySelectorAll('[data-act="close"]').forEach(function (b) { b.addEventListener('click', close); });

    scrim.querySelector('[data-act="send"]').addEventListener('click', function () {
      var note = scrim.querySelector('#fb-report-note').value.trim();
      if (!selectedCat && !note) { modalMsg('Chọn loại lỗi hoặc mô tả lỗi trước nhé.', false); return; }
      var payload = { type: 'report' };
      if (selectedCat) payload.category = selectedCat;
      if (selectedQ) payload.q_num = selectedQ;
      if (note) payload.note = note;
      var btn = scrim.querySelector('[data-act="send"]');
      btn.disabled = true;
      submit(ctx, payload).then(function () {
        modalMsg('Đã gửi báo lỗi — cảm ơn bạn!', true);
        setTimeout(close, 1100);
      }).catch(function () { btn.disabled = false; modalMsg('Không gửi được, thử lại sau.', false); });
    });

    // initial focus into the dialog (first chip)
    var firstChip = scrim.querySelector('.fb-chip');
    if (firstChip) firstChip.focus();
  }

  // ── 3. PER-CARD FLAG ──────────────────────────────────────────────────────────
  function attachCardFlag(opts) {
    var card = opts.card, top = opts.top;
    if (!card || !top || top.querySelector('.fb-flag-btn')) return;   // idempotent
    var ctx = {
      skill: opts.skill, attemptId: opts.attemptId, anonId: opts.anonId || null,
      passageSlug: opts.passageSlug || null, contentId: opts.contentId || null,
    };
    var qNum = (opts.qNum == null) ? null : opts.qNum;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'av-fb fb-flag-btn';
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span aria-hidden="true">⚑</span> ' + (opts.label || 'Báo lỗi bài giải');
    top.appendChild(btn);

    var pop = null;
    btn.addEventListener('click', function () {
      if (pop) { pop.remove(); pop = null; btn.setAttribute('aria-expanded', 'false'); btn.classList.remove('is-on'); return; }
      pop = document.createElement('div');
      pop.className = 'av-fb fb-pop';
      var noteId = 'fb-pop-note-' + (qNum == null ? 'page' : qNum);
      var prompt = (qNum == null)
        ? 'Bài này có vấn đề gì?'
        : 'Bài giải câu này có vấn đề gì?';
      pop.innerHTML =
        '<label for="' + noteId + '">' + prompt + ' <span class="fb-opt">· không bắt buộc</span></label>' +
        '<textarea id="' + noteId + '" class="fb-textarea" placeholder="VD: giải thích chưa khớp transcript, link nghe-lại sai đoạn…"></textarea>' +
        '<p class="fb-pop__msg" role="status" aria-live="polite" hidden></p>' +
        '<div class="fb-pop__foot">' +
          '<button type="button" class="fb-btn fb-btn--ghost fb-btn--sm" data-act="cancel">Huỷ</button>' +
          '<button type="button" class="fb-btn fb-btn--flag fb-btn--sm" data-act="send">Gửi</button>' +
        '</div>';
      card.appendChild(pop);
      btn.setAttribute('aria-expanded', 'true'); btn.classList.add('is-on');
      var ta = pop.querySelector('textarea'); if (ta) ta.focus();

      pop.querySelector('[data-act="cancel"]').addEventListener('click', function () {
        pop.remove(); pop = null; btn.setAttribute('aria-expanded', 'false'); btn.classList.remove('is-on');
      });
      pop.querySelector('[data-act="send"]').addEventListener('click', function () {
        var note = pop.querySelector('textarea').value.trim();
        var payload = { type: 'flag' };
        if (qNum != null) payload.q_num = qNum;
        if (note) payload.note = note;
        var sb = pop.querySelector('[data-act="send"]');
        sb.disabled = true;
        submit(ctx, payload).then(function () {
          pop.innerHTML = '<p class="fb-pop__msg is-ok">Đã gửi — cảm ơn bạn!</p>';
          btn.innerHTML = '<span aria-hidden="true">⚑</span> Đã báo lỗi';
          btn.classList.add('is-flagged');
          setTimeout(function () { if (pop) { pop.remove(); pop = null; } btn.setAttribute('aria-expanded', 'false'); }, 1100);
        }).catch(function () {
          sb.disabled = false;
          var m = pop.querySelector('.fb-pop__msg'); m.textContent = 'Không gửi được, thử lại.'; m.hidden = false; m.classList.add('is-err');
        });
      });
    });
  }

  window.AverFeedback = {
    mountSurvey: mountSurvey,
    openReportModal: openReportModal,
    attachCardFlag: attachCardFlag,
    _surveyDone: surveyDone,   // exposed for tests
  };
})();
