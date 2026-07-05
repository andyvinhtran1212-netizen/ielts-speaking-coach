/* exam-player.js — multi-source exam player (Phase 3 frontend).
 *
 * Drives frontend/pages/exam.html against the exam endpoints:
 *   ?id=<test_id>  → play that exam → submit → result + KP-aware review.
 *   (no id)        → list published exams (optionally ?source=toeic_rc).
 * Solution review reuses window.KPStepper (js/kp-stepper.js). --av-* tokens only.
 */
(function () {
  'use strict';

  function esc(s) {
    if (window.WC && typeof window.WC.escapeHtml === 'function') return window.WC.escapeHtml(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(id) { return document.getElementById(id); }
  function showState(name) {
    ['loading', 'list', 'exam', 'result', 'error'].forEach(function (s) {
      var e = $('state-' + s); if (e) e.classList.toggle('hidden', s !== name);
    });
  }
  function showError(msg) { var e = $('error-msg'); if (e) e.textContent = msg; showState('error'); }

  var SOURCE_LABEL = { toeic_rc: 'TOEIC · Reading', toeic_lc: 'TOEIC · Listening', thpt_qg: 'THPT Quốc gia' };
  var current = { testId: null, questions: [] };

  async function init() {
    var sb = getSupabase();
    var sess = await sb.auth.getSession();
    if (!sess.data.session) { window.location.href = '/login.html'; return; }
    var params = new URLSearchParams(window.location.search);
    var id = params.get('id');
    if (id) loadExam(id); else loadList(params.get('source'));
  }

  async function loadList(source) {
    showState('loading');
    try {
      var data = await window.api.get('/api/exams' + (source ? ('?source=' + encodeURIComponent(source)) : ''));
      var exams = (data && data.exams) || [];
      var wrap = $('exam-list');
      wrap.innerHTML = exams.length ? exams.map(function (e) {
        return '<a href="?id=' + encodeURIComponent(e.id) + '" class="card p-4" ' +
          'style="display:block;text-decoration:none;margin-bottom:12px;">' +
          '<div style="font-weight:600;color:var(--av-text-primary);">' + esc(e.title) + '</div>' +
          '<div style="font-size:var(--av-fs-xs);color:var(--av-text-muted);margin-top:2px;">' +
            esc(SOURCE_LABEL[e.exam_source] || e.exam_source) + ' · ' + (e.total_questions || 0) + ' câu' +
            (e.time_limit_minutes ? (' · ' + e.time_limit_minutes + ' phút') : '') + '</div></a>';
      }).join('') : '<p style="color:var(--av-text-muted);">Chưa có đề nào.</p>';
      showState('list');
    } catch (err) { showError('Không tải được danh sách đề: ' + err.message); }
  }

  async function loadExam(id) {
    showState('loading');
    try {
      var exam = await window.api.get('/api/exams/' + encodeURIComponent(id));
      current.testId = exam.id;
      current.questions = exam.questions || [];
      $('exam-source-label').textContent = SOURCE_LABEL[exam.exam_source] || exam.exam_source || '';
      $('exam-title').textContent = exam.title || '';
      $('exam-meta').textContent = (exam.total_questions || current.questions.length) + ' câu' +
        (exam.time_limit_minutes ? (' · ' + exam.time_limit_minutes + ' phút') : '');
      $('exam-questions').innerHTML = current.questions.map(questionHtml).join('');
      showState('exam');
    } catch (err) { showError('Không tải được đề: ' + err.message); }
  }

  function questionHtml(q) {
    var opts = (q.options || []).map(function (o) {
      var label = esc(o.label);
      return '<label style="display:flex;gap:10px;align-items:flex-start;padding:8px 12px;' +
        'border:1px solid var(--av-border-default);border-radius:var(--av-radius-md);margin-top:8px;cursor:pointer;">' +
        '<input type="radio" name="q' + q.q_num + '" value="' + label + '" style="margin-top:3px;">' +
        '<span style="color:var(--av-text-primary);"><b>' + label + '.</b> ' + esc(o.text) + '</span></label>';
    }).join('');
    return '<div class="card p-4" data-q="' + q.q_num + '">' +
      '<div style="font-weight:600;color:var(--av-text-primary);">' +
        '<span style="color:var(--av-text-muted);">Câu ' + q.q_num + '.</span> ' + esc(q.prompt) + '</div>' +
      opts + '</div>';
  }

  function collectAnswers() {
    return current.questions.map(function (q) {
      var sel = document.querySelector('input[name="q' + q.q_num + '"]:checked');
      return { q_num: q.q_num, user_answer: sel ? sel.value : '' };
    });
  }

  async function submit() {
    var btn = $('exam-submit');
    btn.disabled = true; btn.textContent = 'Đang chấm…';
    try {
      var res = await window.api.post('/api/exams/' + encodeURIComponent(current.testId) + '/attempts',
        { answers: collectAnswers() });
      var review = await window.api.get('/api/exams/attempts/' + encodeURIComponent(res.attempt_id) + '/review');
      renderResult(review);
      showState('result');
      window.scrollTo(0, 0);
    } catch (err) {
      showError('Không chấm được bài: ' + err.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Nộp bài';
    }
  }

  function reviewCardHtml(item) {
    var correct = !!item.correct;
    var stepperHtml = (window.KPStepper && item.stepper) ? window.KPStepper.renderHtml(item.stepper) : '';
    return '<div class="card p-4">' +
      '<div data-toggle role="button" tabindex="0" ' +
        'style="cursor:pointer;display:flex;justify-content:space-between;gap:12px;">' +
        '<span style="font-weight:600;color:var(--av-text-primary);">' +
          '<span style="color:var(--av-text-muted);">Câu ' + item.q_num + '.</span> ' + esc(item.prompt || '') + '</span>' +
        '<span style="flex:none;font-weight:700;color:' + (correct ? 'var(--av-success)' : 'var(--av-error)') + ';">' +
          (correct ? '✓' : '✗') + '</span>' +
      '</div>' +
      '<div style="margin-top:8px;font-size:var(--av-fs-sm);">' +
        '<span style="color:var(--av-text-muted);">Bạn chọn:</span> <b>' + esc(item.user_answer || '—') + '</b>' +
        ' · <span style="color:var(--av-text-muted);">Đáp án:</span> ' +
        '<b style="color:var(--av-success);">' + esc(item.expected || '') + '</b>' +
      '</div>' +
      (stepperHtml ? '<div data-detail hidden style="margin-top:10px;padding-top:10px;' +
        'border-top:1px solid var(--av-border-subtle);">' + stepperHtml + '</div>' : '') +
    '</div>';
  }

  function renderResult(review) {
    $('result-score').textContent = (review.score != null ? review.score : '—') + ' / ' + (review.max_score || '—');
    $('result-sub').textContent = 'Đúng ' + (review.correct_count || 0) + ' câu';
    $('result-retry').setAttribute('href', '?id=' + encodeURIComponent(review.test_id || ''));
    $('result-review').innerHTML = (review.review || []).map(reviewCardHtml).join('');

    // Expand/collapse each question's solution; then wire micro-checks.
    $('result-review').querySelectorAll('[data-toggle]').forEach(function (t) {
      var toggle = function () {
        var d = t.parentElement.querySelector('[data-detail]');
        if (d) d.hidden = !d.hidden;
      };
      t.addEventListener('click', toggle);
      t.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    });
    if (window.KPStepper) window.KPStepper.wire($('result-review'));
  }

  document.addEventListener('DOMContentLoaded', function () {
    var btn = $('exam-submit');
    if (btn) btn.addEventListener('click', submit);
  });
  window.examPlayer = { init: init };
})();
