/**
 * Trang "Kết quả thi thử" — phiếu điểm TRF của một lượt thi.
 *
 * TÁCH RA TỪ MÃ INLINE của `pages/mock-result.html` khi port sang Next (không
 * đổi một dòng logic nào). Bản Next chạy CHÍNH mã này, không chép lại.
 *
 * KHÔNG tự gọi `initSupabase`: bản legacy gọi ngay trước `mount()`.
 */

  var SKILLS = [
    { key: 'listening', label: 'Listening' },
    { key: 'reading', label: 'Reading' },
    { key: 'writing', label: 'Writing' },
    { key: 'speaking', label: 'Speaking' },
  ];

  var $ = function (id) { return document.getElementById(id); };
  function showState(name) {
    ['loading', 'pending', 'error', 'content'].forEach(function (s) {
      var el = $('state-' + s);
      if (el) el.classList.toggle('hidden', s !== name);
    });
  }
  function esc(s) { return (window.WC && window.WC.escapeHtml) ? window.WC.escapeHtml(s) : String(s == null ? '' : s); }
  function fmtBand(v) { return (v == null || v === '') ? '—' : Number(v).toFixed(1); }

  function render(data) {
    var fb = data.final_bands || {};

    // Overall hero. Only the sitting's REQUIRED skills carry a band (a
    // writing-only retake scores 1 skill, not 4) — so both the count and the
    // band grid are driven by the skills actually scored, never a hard-coded 4.
    $('overall-val').textContent = fmtBand(fb.overall);
    // Vòng cung /9 quanh overall — cùng thước đo với thanh mức từng kỹ năng.
    var ringEl = $('overall-ring');
    if (ringEl && fb.overall != null) {
      ringEl.style.background = 'conic-gradient(var(--av-primary) '
        + (Math.min(9, Math.max(0, Number(fb.overall))) / 9 * 360) + 'deg, var(--av-border-subtle) 0)';
    }
    var scored = SKILLS.filter(function (s) { return fb[s.key] != null; });
    $('overall-sub').textContent = scored.length ? (scored.length + ' kỹ năng đã chấm') : '';

    // Per-skill bands — show the scored skills (fall back to all four only in
    // the defensive no-band case, which release shouldn't produce).
    var grid = $('bands');
    grid.innerHTML = (scored.length ? scored : SKILLS).map(function (s) {
      var v = fb[s.key];
      var pct = (v == null) ? 0 : Math.round(Math.min(9, Math.max(0, Number(v))) / 9 * 100);
      return '<div class="trf-sk' + (v == null ? ' trf-sk--empty' : '') + '">'
        + '<span class="trf-sk__name">' + s.label + '</span>'
        + '<span class="trf-sk__bar" aria-hidden="true"><i style="width:' + pct + '%"></i></span>'
        + '<span class="trf-sk__val">' + fmtBand(v) + '</span></div>';
    }).join('');

    // Examiner comment.
    if (data.examiner_comment_vi) $('examiner-comment').textContent = data.examiner_comment_vi;
    else $('comment-wrap').classList.add('hidden');

    // Per-skill notes. Speaking from a live teacher assessment arrives as a
    // STRUCTURED object (bands per criterion, measured metrics vs class,
    // per-criterion feedback) — the generic esc()'d text note would render it
    // as "[object Object]". It gets its own block; strings keep the old path.
    var notes = data.per_skill_notes || {};
    // Speaking chi tiết KHÔNG còn nằm chen giữa trang — nó là thẻ trong
    // "Việc tiếp theo" mở /pages/speaking-result.html (bản duyệt trf-v2).
    var spk = (notes.speaking && typeof notes.speaking === 'object') ? notes.speaking : null;
    var keys = Object.keys(notes).filter(function (k) {
      return notes[k] && !(k === 'speaking' && spk);
    });
    var nwrap = $('notes-wrap');
    if (keys.length) {
      nwrap.classList.remove('hidden');
      nwrap.innerHTML = '<h2 class="trf-h2">Ghi chú từng kỹ năng</h2>'
        + keys.map(function (k) {
            return '<div class="trf-note"><div class="trf-note__skill">' + esc(k)
              + '</div><div class="trf-note__body">' + esc(notes[k]) + '</div></div>';
          }).join('');
    }

    if (data.released_at) {
      $('released-at').textContent = 'Công bố lúc ' + new Date(data.released_at).toLocaleString('vi-VN');
    }

    // Chữa bài — one action card per available skill review. L/R link to the
    // per-question review; Writing links to the delivered essay feedback. All
    // are only present in the payload once released (this page is gated on that).
    // ?from=mock&sitting= — both review pages are shared with their skill's two
    // test libraries; without the origin their back button sends a mock taker to
    // a test shelf instead of back to this result. Read the id off the URL (the
    // same source the loader uses) — render() has no sittingId in scope.
    var sitting = new URLSearchParams(location.search).get('sitting') || '';
    var mockOrigin = '&from=mock&sitting=' + encodeURIComponent(sitting);
    var reviews = [];
    if (data.listening_attempt_id) reviews.push({ icon: '🎧', title: 'Chữa bài Listening', hint: 'Xem lại từng câu + transcript',
      href: '/pages/listening-review.html?attempt_id=' + encodeURIComponent(data.listening_attempt_id) + mockOrigin });
    if (data.reading_attempt_id) reviews.push({ icon: '📖', title: 'Chữa bài Reading', hint: 'Xem lại từng câu + bài đọc',
      href: '/pages/reading-review.html?attempt_id=' + encodeURIComponent(data.reading_attempt_id) + mockOrigin });
    // Writing: one card per task. A task with readable feedback links to it; a
    // task that never got graded says SO — the old code just skipped it, so a
    // student with one graded task saw a single link and an unexplained gap.
    var TASK_LABEL = { task1: 'Task 1', task2: 'Task 2' };
    var wTasks = data.writing_tasks || [];
    wTasks.forEach(function (t) {
      var label = TASK_LABEL[t.task] || t.task;
      if (t.state === 'delivered' && t.essay_id) {
        reviews.push({ icon: '✍️', title: 'Nhận xét Writing ' + label, hint: 'Chữa bài chi tiết',
          href: '/pages/writing-result.html?id=' + encodeURIComponent(t.essay_id) });
      }
    });

    if (spk) {
      reviews.push({ icon: '🎙', title: 'Nhận xét Speaking', hint: 'Thi trực tiếp — band 4 tiêu chí + cách luyện',
        href: '/pages/speaking-result.html?sitting=' + encodeURIComponent(sitting) });
    }

    var cwrap = $('chuabai-wrap');
    if (reviews.length) {
      cwrap.classList.remove('hidden');
      cwrap.innerHTML = '<h2 class="trf-h2">Xem chữa bài chi tiết</h2><div class="trf-review-grid">'
        + reviews.map(function (r) {
            return '<a class="trf-review" target="_blank" rel="noopener" href="' + r.href + '">'
              + '<span class="trf-review__icon" aria-hidden="true">' + r.icon + '</span>'
              + '<span class="trf-review__body"><span class="trf-review__title">' + esc(r.title) + '</span>'
              + '<span class="trf-review__hint">' + esc(r.hint) + '</span></span>'
              + '<span class="trf-review__arrow" aria-hidden="true">↗</span></a>';
          }).join('') + '</div>';
    }

    renderRetest(data.retest_flags || {});
    renderLrGaps(data.lr_skills || [], fb);
    renderWritingGaps(wTasks);
    showState('content');
  }

  // The skills the examiner ruled must be retaken. Its own block, driven ONLY
  // by retest_flags — the notice used to be a line inside the no-band warning
  // cards, so it appeared only for a skill that had no band. The common case is
  // the opposite: a skill IS banded and the examiner still wants it redone. For
  // those students the instruction rendered nowhere and they never learned they
  // had to sit it again.
  function renderRetest(retestFlags) {
    var LABEL = { listening: 'Listening', reading: 'Reading',
                  writing: 'Writing', speaking: 'Speaking' };
    var skills = Object.keys(LABEL).filter(function (s) { return retestFlags[s]; });
    var wrap = $('retest-wrap');
    if (!wrap || !skills.length) return;
    wrap.classList.remove('hidden');
    wrap.innerHTML = '<div class="trf-retest">'
      + '<span class="trf-retest__icon" aria-hidden="true">↻</span>'
      + '<span class="trf-retest__body">'
      +   '<span class="trf-retest__title">Giám khảo yêu cầu thi lại: '
      +     esc(skills.map(function (s) { return LABEL[s]; }).join(', ')) + '</span>'
      +   '<span class="trf-retest__detail">Kết quả dưới đây vẫn là kết quả của lần thi này. '
      +     'Liên hệ lớp/trung tâm để sắp lịch thi lại phần được yêu cầu.</span>'
      + '</span></div>';
  }

  // A Listening/Reading skill with no band used to just DISAPPEAR from the
  // grid — the student saw the other skills and was left guessing. Say what
  // happened, and say the true thing: production's stuck sittings all submitted
  // on time, so "không nhận được bài làm" would be a lie about their own exam.
  function renderLrGaps(lrSkills, fb) {
    var LABEL = { listening: 'Listening', reading: 'Reading' };
    // A skill the examiner banded by hand needs no excuse, whatever the raw
    // score did — the band is what the student is given.
    var gaps = (lrSkills || []).filter(function (s) {
      return s.state !== 'scored' && fb[s.skill] == null;
    });
    var wrap = $('lr-gap-wrap');
    if (!wrap || !gaps.length) return;

    wrap.classList.remove('hidden');
    wrap.innerHTML = '<h2 class="trf-h2">Kỹ năng chưa có band</h2>'
      + gaps.map(function (s) {
          var label = LABEL[s.skill] || s.skill;
          var why, detail;
          if (s.state === 'no_attempt') {
            why = 'Không nhận được bài làm';
            detail = 'Hệ thống không nhận được bài ' + label + ' của bạn.';
          } else if (s.state === 'no_answers') {
            why = 'Không có đáp án';
            detail = 'Bài ' + label + ' đã nộp nhưng không có câu trả lời nào, '
                   + 'nên không chấm được.';
          } else {
            why = 'Không có band';
            detail = 'Bạn đúng ' + (s.score == null ? 0 : s.score) + '/' + (s.max || 40)
                   + ' câu — dưới mức thấp nhất của bảng quy đổi band IELTS, '
                   + 'nên không có band cho phần này.';
          }
          return '<div class="trf-gap">'
            + '<span class="trf-gap__icon" aria-hidden="true">⚠</span>'
            + '<span class="trf-gap__body">'
            +   '<span class="trf-gap__title">' + esc(label) + ' — ' + esc(why) + '</span>'
            +   '<span class="trf-gap__detail">' + esc(detail) + '</span>'
            // the retest instruction lives in its own block now — repeating it
            // per card said it only where it mattered least
            + '</span></div>';
        }).join('');
  }

  // Say out loud why a Writing task has no feedback. Silence here reads as "the
  // system lost my essay"; the student is owed the reason, and the reason is a
  // fact on the row (word count vs the IELTS minimum), not a guess.
  //
  // The retest line is separate on purpose: not-graded is what HAPPENED, "cần
  // thi lại" is what the examiner DECIDED. Only the examiner's own flag may
  // claim the second — this page must not invent an obligation for them.
  function renderWritingGaps(wTasks) {
    var TASK_LABEL = { task1: 'Task 1', task2: 'Task 2' };
    var gaps = (wTasks || []).filter(function (t) { return t.state !== 'delivered'; });
    var wrap = $('writing-gap-wrap');
    if (!wrap || !gaps.length) return;

    wrap.classList.remove('hidden');
    wrap.innerHTML = '<h2 class="trf-h2">Phần Writing chưa có nhận xét</h2>'
      + gaps.map(function (t) {
          var label = TASK_LABEL[t.task] || t.task;
          var why, detail;
          if (t.state === 'too_short') {
            why = 'Bài không đạt yêu cầu';
            detail = 'Bài viết chỉ có ' + (t.word_count == null ? 0 : t.word_count)
              + ' từ, dưới mức tối thiểu ' + t.min_words + ' từ của IELTS ' + label
              + ' — nên không chấm được.';
          } else if (t.state === 'missing') {
            why = 'Không có bài nộp';
            detail = 'Bạn chưa nộp bài cho ' + label + '.';
          } else {
            why = 'Chưa có nhận xét';
            detail = 'Bài ' + label + ' chưa được chấm xong nên chưa có phần chữa bài.';
          }
          return '<div class="trf-gap">'
            + '<span class="trf-gap__icon" aria-hidden="true">⚠</span>'
            + '<span class="trf-gap__body">'
            +   '<span class="trf-gap__title">' + esc(label) + ' — ' + esc(why) + '</span>'
            +   '<span class="trf-gap__detail">' + esc(detail) + '</span>'
            // retest lives in its own block — see renderRetest
            + '</span></div>';
        }).join('');
  }

  async function boot() {
    var sittingId = new URLSearchParams(location.search).get('sitting');
    if (!sittingId) { $('state-error').textContent = 'Thiếu mã sitting.'; showState('error'); return; }
    var sb = window.getSupabase && window.getSupabase();
    if (sb) {
      var sess = await sb.auth.getSession();
      if (!sess.data.session) { location.href = '/index.html'; return; }
    }
    try {
      var data = await window.api.get('/api/mock-exams/sittings/' + encodeURIComponent(sittingId) + '/result');
      render(data);
    } catch (e) {
      // 403 = chưa công bố (sealed)
      if (e && (e.status === 403 || /chờ giám khảo|403/.test(String(e.message || '')))) { showState('pending'); return; }
      $('state-error').textContent = 'Không tải được kết quả: ' + (e && e.message ? e.message : e);
      showState('error');
    }
  }

export async function mount() {
  await boot();
}
