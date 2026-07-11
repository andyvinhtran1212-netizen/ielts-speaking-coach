/*
 * mock-exam-runner.js — 4-skill mock orchestrator (student, all-at-once model).
 *
 * The 3 seated sections open TOGETHER under one total timer. Reading + Listening
 * are the existing runner pages embedded as iframes in `mock_embed` mode (they
 * auto-start their attempt, autosave answers, and hide their own timer/submit —
 * see mock-exam-hook.js). Writing is a native 2-tab step. On "Nộp toàn bộ" (or
 * when the timer hits 0) the parent submits each section's attempt directly
 * (empty body → the autosaved answers are graded, sealed) then finalises.
 *
 * Server timestamps are authoritative; the client timer is display-only and is
 * re-anchored from the server on every load.
 */
(function () {
  'use strict';
  initSupabase('https://huwsmtubwulikhlmcirx.supabase.co', 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao');

  var S = { code: null, sittingId: null, sitting: null, exam: null, timeLeft: null };
  var timerIv = null;
  var _submitting = false;

  function el(id) { return document.getElementById(id); }
  function esc(s) { return (window.WC && window.WC.escapeHtml) ? window.WC.escapeHtml(s) : String(s == null ? '' : s); }
  function wordCount(t) { return (t || '').trim() ? t.trim().split(/\s+/).length : 0; }
  function api(method, path, body) { return method === 'get' ? window.api.get(path) : window.api.post(path, body || {}); }

  function showState(name) {
    ['loading', 'error', 'prep', 'submitted'].forEach(function (s) {
      var e = el('state-' + s); if (e) e.classList.toggle('hidden', s !== name);
    });
    el('state-test').classList.toggle('on', name === 'test');
  }
  function fail(msg) { el('state-error').querySelector('div').textContent = msg; showState('error'); }

  // ── Boot ───────────────────────────────────────────────────────────
  async function boot() {
    var q = new URLSearchParams(location.search);
    S.code = q.get('code'); S.sittingId = q.get('sitting');
    var sb = window.getSupabase && window.getSupabase();
    if (sb) { var sess = await sb.auth.getSession(); if (!sess.data.session) { location.href = '/index.html'; return; } }
    try {
      if (!S.sittingId) {
        if (!S.code) return fail('Thiếu mã kỳ thi (?code=).');
        var created = await api('post', '/api/mock-exams/' + encodeURIComponent(S.code) + '/sittings');
        S.sittingId = created.id;
      }
      await loadState();
    } catch (e) { fail('Không mở được kỳ thi: ' + (e && e.message ? e.message : e)); }
  }

  async function loadState() {
    var st = await api('get', '/api/mock-exams/sittings/' + encodeURIComponent(S.sittingId));
    S.sitting = st.sitting; S.exam = st.exam || {}; S.timeLeft = st.lrw_time_left_seconds;
    route();
  }

  function route() {
    var s = S.sitting.status;
    if (s === 'released') { location.href = '/pages/mock-result.html?sitting=' + encodeURIComponent(S.sittingId); return; }
    if (s === 'void') return fail('Kỳ thi đã bị huỷ. Liên hệ giám khảo để được cấp lượt mới.');
    if (s === 'registered') return renderPrep();
    if (s === 'lrw_in_progress') return renderTest();
    return renderSubmitted();   // lrw_submitted / speaking_pending / all_submitted / under_review / reviewed
  }

  // ── Prep ───────────────────────────────────────────────────────────
  function renderPrep() {
    el('prep-title').textContent = 'Thi thử: ' + (S.exam.reading_title || S.code || 'IELTS');
    el('prep-total').textContent = 'Tổng thời gian cho cả 3 phần: ' + (S.exam.total_minutes || 150) + ' phút.';
    el('prep-start').onclick = async function () {
      el('prep-start').disabled = true;
      try { await api('post', '/api/mock-exams/sittings/' + S.sittingId + '/start'); await loadState(); }
      catch (e) { el('prep-start').disabled = false; fail('Không bắt đầu được: ' + (e && e.message)); }
    };
    showState('prep');
  }

  // ── Test (3 tabs, one timer) ───────────────────────────────────────
  function lsKey(t) { return 'mock-writing:' + S.sittingId + ':' + t; }

  function renderTest() {
    var sections = [];
    if (S.exam.listening_test_id) sections.push({ key: 'listening', label: '🎧 Listening' });
    if (S.exam.reading_test_code) sections.push({ key: 'reading', label: '📖 Reading' });
    sections.push({ key: 'writing', label: '✍️ Writing' });

    // tabs
    el('tabs').innerHTML = sections.map(function (s, i) {
      return '<div class="me-tab' + (i === 0 ? ' active' : '') + '" data-tab="' + s.key + '">' + s.label + '</div>';
    }).join('');
    // iframes (only configured sections). Loaded now so each attempt is created.
    if (S.exam.listening_test_id) {
      el('if-listening').src = '/pages/listening-test.html?id=' + encodeURIComponent(S.exam.listening_test_id) + '&sitting_id=' + encodeURIComponent(S.sittingId) + '&mock_embed=1';
    }
    if (S.exam.reading_test_code) {
      el('if-reading').src = '/pages/reading-exam.html?test_id=' + encodeURIComponent(S.exam.reading_test_code) + '&sitting_id=' + encodeURIComponent(S.sittingId) + '&mock_embed=1';
    }
    // writing prompts + native textareas
    var t1 = S.exam.writing_task1, t2 = S.exam.writing_task2;
    el('prompt-task1').textContent = t1 ? (t1.title ? t1.title + ' — ' : '') + (t1.prompt_text || '') : '(Không có đề Task 1)';
    el('prompt-task2').textContent = t2 ? (t2.title ? t2.title + ' — ' : '') + (t2.prompt_text || '') : '(Không có đề Task 2)';
    ['task1', 'task2'].forEach(function (t) {
      var ta = el('essay-' + t);
      try { var saved = localStorage.getItem(lsKey(t)); if (saved) ta.value = saved; } catch (e) {}
      el('count-' + t).textContent = wordCount(ta.value);
      ta.addEventListener('input', function () {
        el('count-' + t).textContent = wordCount(ta.value);
        try { localStorage.setItem(lsKey(t), ta.value); } catch (e) {}
      });
    });

    // tab switching (section tabs + writing sub-tabs share the .me-tab class)
    el('tabs').querySelectorAll('.me-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        el('tabs').querySelectorAll('.me-tab').forEach(function (x) { x.classList.remove('active'); });
        document.querySelectorAll('.me-panel').forEach(function (x) { x.classList.remove('active'); });
        tab.classList.add('active');
        document.querySelector('.me-panel[data-panel="' + tab.dataset.tab + '"]').classList.add('active');
      });
    });
    document.querySelectorAll('.me-wtabs .me-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        document.querySelectorAll('.me-wtabs .me-tab').forEach(function (x) { x.classList.remove('active'); });
        document.querySelectorAll('.me-wpanel').forEach(function (x) { x.classList.remove('active'); });
        tab.classList.add('active');
        document.querySelector('.me-wpanel[data-wpanel="' + tab.dataset.wtab + '"]').classList.add('active');
      });
    });
    // activate first panel
    var first = sections[0].key;
    document.querySelector('.me-panel[data-panel="' + first + '"]').classList.add('active');

    el('submit-all').onclick = function () { submitAll(false); };
    startTimer();
    showState('test');
  }

  function startTimer() {
    var remaining = (S.timeLeft != null) ? S.timeLeft : (S.exam.total_minutes || 150) * 60;
    function tick() {
      if (remaining <= 0) {
        clearInterval(timerIv);
        el('timer').textContent = '00:00';
        submitAll(true);
        return;
      }
      var h = Math.floor(remaining / 3600), m = Math.floor((remaining % 3600) / 60), s = remaining % 60;
      var txt = (h > 0 ? h + ':' + (m < 10 ? '0' : '') : (m < 10 ? '0' : '')) + m + ':' + (s < 10 ? '0' : '') + s;
      el('timer').textContent = txt;
      if (remaining <= 300) { el('timer').classList.add('warn'); el('warn-banner').classList.add('on'); }
      remaining -= 1;
    }
    tick();
    timerIv = setInterval(tick, 1000);
  }

  async function submitAll(auto) {
    if (_submitting) return;
    if (auto !== true && !confirm('Nộp toàn bộ và kết thúc bài thi? Bạn sẽ không sửa được nữa.')) return;
    _submitting = true;
    if (timerIv) clearInterval(timerIv);
    el('submit-all').disabled = true;
    try {
      // 1. save writing text
      await api('post', '/api/mock-exams/sittings/' + S.sittingId + '/writing',
        { task1_text: el('essay-task1').value, task2_text: el('essay-task2').value });
      // 2. submit the L/R attempts directly (empty body → autosaved answers graded)
      var fresh = await api('get', '/api/mock-exams/sittings/' + encodeURIComponent(S.sittingId));
      var sit = fresh.sitting || {};
      if (sit.reading_attempt_id) {
        await window.api.post('/api/reading/test/attempts/' + encodeURIComponent(sit.reading_attempt_id) + '/submit', { answers: [] }).catch(function () {});
      }
      if (sit.listening_attempt_id) {
        await window.api.post('/api/listening/tests/attempts/' + encodeURIComponent(sit.listening_attempt_id) + '/submit', {}).catch(function () {});
      }
      // 3. finalise the block
      await api('post', '/api/mock-exams/sittings/' + S.sittingId + '/submit-lrw');
      try { localStorage.removeItem(lsKey('task1')); localStorage.removeItem(lsKey('task2')); } catch (e) {}
      await loadState();
    } catch (e) {
      _submitting = false;
      el('submit-all').disabled = false;
      fail('Nộp bài thất bại: ' + (e && e.message ? e.message : e));
    }
  }

  // ── Submitted ──────────────────────────────────────────────────────
  function renderSubmitted() {
    if (timerIv) clearInterval(timerIv);
    var sla = (S.exam.review_sla_days != null) ? S.exam.review_sla_days : 3;
    el('submitted-msg').innerHTML =
      'Bài của bạn đã được ghi nhận. Giám khảo sẽ trả kết quả trong khoảng <b>' + sla + ' ngày</b>. ' +
      'Bạn sẽ thấy điểm tại trang chủ khi có kết quả.';
    var extra = el('submitted-extra');
    if (S.sitting.status === 'speaking_pending') {
      extra.innerHTML =
        '<p class="me-muted">Còn phần <b>Speaking</b> (vấn đáp 3 phần) để hoàn tất bài thi.</p>' +
        '<button class="av-btn av-btn--primary" id="start-speaking" style="margin-top:10px">Vào thi Speaking →</button>';
      var sb = el('start-speaking'); if (sb) sb.onclick = startSpeaking;
    } else {
      extra.innerHTML = '<p class="me-muted">Kết quả đang chờ giám khảo duyệt.</p>';
    }
    showState('submitted');
  }

  async function startSpeaking() {
    var set = S.exam.speaking_topic_set || {};
    var topic = (Array.isArray(set.part1) && set.part1[0]) || set.part1 || 'General';
    var btn = el('start-speaking');
    if (btn) { btn.disabled = true; btn.textContent = 'Đang mở…'; }
    try {
      var sess = await api('post', '/sessions', { mode: 'test_full', part: 1, topic: topic, sitting_id: S.sittingId });
      var sid = sess.session_id || sess.id;
      location.href = '/pages/practice.html?session_id=' + encodeURIComponent(sid);
    } catch (e) { fail('Không mở được phần Speaking: ' + (e && e.message ? e.message : e)); }
  }

  boot();
})();
