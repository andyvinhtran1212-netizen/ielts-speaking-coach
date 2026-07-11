/*
 * mock-exam-runner.js — 4-skill mock orchestrator (student, LRW seated flow).
 *
 * Status-driven: on every load it fetches the sitting and renders the right
 * screen from `sitting.status` (+ a `?done=<section>` return flag). The reading
 * and listening sections REDIRECT to the existing runner pages (with
 * ?sitting_id=), which seal + hand back via mock-exam-hook.js. Writing is a
 * native 2-tab step here. Speaking (when the exam defines it) is scheduled
 * separately — see the "đã thu bài" screen.
 *
 * Server timestamps are authoritative; the client timers are display-only.
 */
(function () {
  'use strict';
  initSupabase('https://huwsmtubwulikhlmcirx.supabase.co', 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao');

  var S = { sittingId: null, code: null, done: null, sitting: null, exam: null, timeLeft: {} };
  var writingTimer = null;

  function el(id) { return document.getElementById(id); }
  function esc(s) { return (window.WC && window.WC.escapeHtml) ? window.WC.escapeHtml(s) : String(s == null ? '' : s); }
  function showState(name) {
    ['loading', 'error', 'prep', 'buffer', 'writing', 'submitted'].forEach(function (s) {
      var e = el('state-' + s); if (e) e.classList.toggle('hidden', s !== name);
    });
  }
  function fail(msg) { el('state-error').textContent = msg; showState('error'); }
  function wordCount(t) { return (t || '').trim() ? (t.trim().split(/\s+/).length) : 0; }
  function readingLink() { return '/pages/reading-exam.html?test_id=' + encodeURIComponent(S.exam.reading_test_code) + '&sitting_id=' + encodeURIComponent(S.sittingId); }
  function listeningLink() { return '/pages/listening-test.html?id=' + encodeURIComponent(S.exam.listening_test_id) + '&sitting_id=' + encodeURIComponent(S.sittingId); }

  async function api(method, path, body) {
    return method === 'get' ? window.api.get(path) : window.api.post(path, body || {});
  }

  // ── Boot ───────────────────────────────────────────────────────────
  async function boot() {
    var q = new URLSearchParams(location.search);
    S.code = q.get('code'); S.sittingId = q.get('sitting'); S.done = q.get('done');
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
    S.sitting = st.sitting; S.exam = st.exam || {}; S.timeLeft = st.time_left_seconds || {};
    route();
  }

  function route() {
    var st = S.sitting.status;
    if (st === 'released') { location.href = '/pages/mock-result.html?sitting=' + encodeURIComponent(S.sittingId); return; }
    if (st === 'void') return fail('Kỳ thi đã bị huỷ. Vui lòng liên hệ giám khảo để được cấp lượt thi mới.');
    if (st === 'registered') return renderPrep();
    if (st === 'lrw_listening') return S.done === 'listening' ? advanceToReading() : gotoListening();
    if (st === 'lrw_reading') return S.done === 'reading' ? advanceToWriting() : gotoReading();
    if (st === 'lrw_writing') return renderWriting();
    // lrw_submitted / speaking_pending / all_submitted / under_review / reviewed
    return renderSubmitted();
  }

  // ── Prep ───────────────────────────────────────────────────────────
  function renderPrep() {
    el('prep-title').textContent = 'Thi thử: ' + (S.exam.reading_title || S.code || 'IELTS');
    var mins = S.exam.section_minutes || {};
    var rows = [
      ['🎧 Listening', mins.listening], ['📖 Reading', mins.reading], ['✍️ Writing', mins.writing],
    ].map(function (r) { return '<li><span>' + r[0] + '</span><span>' + (r[1] || '—') + ' phút</span></li>'; }).join('');
    el('prep-sections').innerHTML = rows;
    var hasListening = !!S.exam.listening_test_id;
    el('prep-start').textContent = hasListening ? 'Bắt đầu — vào Listening' : 'Bắt đầu — vào Reading';
    el('prep-start').onclick = hasListening ? startListening : startReadingFirst;
    showState('prep');
  }

  async function startListening() {
    try { await api('post', '/api/mock-exams/sittings/' + S.sittingId + '/sections/listening/start'); }
    catch (e) { return fail('Không bắt đầu được Listening: ' + (e && e.message)); }
    location.href = listeningLink();
  }

  async function startReadingFirst() {
    // exam without a listening component → reading is the first LRW section
    try { await api('post', '/api/mock-exams/sittings/' + S.sittingId + '/sections/reading/start'); }
    catch (e) { return fail('Không bắt đầu được Reading: ' + (e && e.message)); }
    location.href = readingLink();
  }

  // ── Section transitions ────────────────────────────────────────────
  function gotoListening() { location.href = listeningLink(); }   // resume
  function gotoReading() { location.href = readingLink(); }       // resume

  function advanceToReading() {
    buffer('Xong Listening. Chuẩn bị vào Reading (60 phút).', async function () {
      try { await api('post', '/api/mock-exams/sittings/' + S.sittingId + '/sections/reading/start'); }
      catch (e) { return fail('Không chuyển sang Reading: ' + (e && e.message)); }
      location.href = readingLink();
    });
  }

  async function advanceToWriting() {
    try { await api('post', '/api/mock-exams/sittings/' + S.sittingId + '/sections/writing/start'); }
    catch (e) { return fail('Không chuyển sang Writing: ' + (e && e.message)); }
    // reload state so the writing timer reads the server start
    await loadState();
  }

  // ── Buffer ─────────────────────────────────────────────────────────
  function buffer(msg, cb) {
    el('buffer-msg').textContent = msg;
    var n = 60; el('buffer-count').textContent = n;
    showState('buffer');
    var iv = setInterval(function () {
      n -= 1; el('buffer-count').textContent = n;
      if (n <= 0) { clearInterval(iv); cb(); }
    }, 1000);
    el('buffer-skip').onclick = function () { clearInterval(iv); cb(); };
  }

  // ── Writing ────────────────────────────────────────────────────────
  function lsKey(t) { return 'mock-writing:' + S.sittingId + ':' + t; }

  function renderWriting() {
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

    document.querySelectorAll('.me-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        document.querySelectorAll('.me-tab').forEach(function (x) { x.classList.remove('active'); });
        document.querySelectorAll('.me-writing-panel').forEach(function (x) { x.classList.remove('active'); });
        tab.classList.add('active');
        document.querySelector('.me-writing-panel[data-wpanel="' + tab.dataset.wtab + '"]').classList.add('active');
      });
    });

    el('writing-submit').onclick = submitWriting;
    startWritingTimer();
    showState('writing');
  }

  function startWritingTimer() {
    var remaining = S.timeLeft.writing;
    if (remaining == null) { var m = (S.exam.section_minutes || {}).writing || 60; remaining = m * 60; }
    function tick() {
      if (remaining <= 0) {
        clearInterval(writingTimer);
        el('writing-timer').textContent = '00:00';
        submitWriting(true);
        return;
      }
      var mm = Math.floor(remaining / 60), ss = remaining % 60;
      el('writing-timer').textContent = (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
      remaining -= 1;
    }
    tick();
    writingTimer = setInterval(tick, 1000);
  }

  var _submitting = false;
  async function submitWriting(auto) {
    if (_submitting) return;
    if (auto !== true && !confirm('Nộp cả mạch và kết thúc bài thi? Bạn sẽ không thể sửa lại.')) return;
    _submitting = true;
    if (writingTimer) clearInterval(writingTimer);
    var t1 = el('essay-task1').value, t2 = el('essay-task2').value;
    try {
      await api('post', '/api/mock-exams/sittings/' + S.sittingId + '/writing', { task1_text: t1, task2_text: t2 });
      await api('post', '/api/mock-exams/sittings/' + S.sittingId + '/submit-lrw');
      try { localStorage.removeItem(lsKey('task1')); localStorage.removeItem(lsKey('task2')); } catch (e) {}
      await loadState();
    } catch (e) { _submitting = false; fail('Nộp bài thất bại: ' + (e && e.message)); }
  }

  // ── Submitted ──────────────────────────────────────────────────────
  function renderSubmitted() {
    var sla = (S.exam.review_sla_days != null) ? S.exam.review_sla_days : 3;
    var when = S.sitting.writing_submitted_at ? new Date(S.sitting.writing_submitted_at).toLocaleString('vi-VN') : '';
    el('submitted-msg').innerHTML =
      'Bài của bạn đã được ghi nhận' + (when ? ' lúc <b>' + esc(when) + '</b>' : '') + '. ' +
      'Giám khảo sẽ trả kết quả trong khoảng <b>' + sla + ' ngày</b>. ' +
      'Bạn sẽ thấy điểm tại trang chủ khi có kết quả.';

    var extra = el('submitted-extra');
    if (S.sitting.status === 'speaking_pending') {
      extra.innerHTML = '<p class="me-muted">Phần <b>Speaking</b> của kỳ thi này được sắp lịch riêng — giám khảo sẽ liên hệ để hẹn giờ thi vấn đáp.</p>';
    } else {
      extra.innerHTML = '<p class="me-muted">Kết quả đang chờ giám khảo duyệt.</p>';
    }
    showState('submitted');
  }

  boot();
})();
