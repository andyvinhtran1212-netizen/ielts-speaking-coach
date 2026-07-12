/*
 * mock-exam-runner.js — 4-skill mock orchestrator (student, SEQUENTIAL model).
 *
 * The three seated sections open ONE AT A TIME, gated by the admin — there is
 * no per-student "Start" button. The client polls the sitting endpoint; when
 * the exam's active_section changes it shows that section (Reading/Listening
 * as an iframe, Writing as native textareas) under a countdown computed from
 * the SHARED server clock. There is no early manual submit — the section
 * auto-submits when its own clock hits 0. Between sections the student sees a
 * waiting room until the admin opens the next one.
 *
 * Server timestamps are authoritative; the client timer is display-only and is
 * re-anchored from the server on every poll.
 */
(function () {
  'use strict';
  initSupabase('https://huwsmtubwulikhlmcirx.supabase.co', 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao');

  var POLL_MS = 8000;
  var WARN_SECONDS = 120;

  var S = { code: null, sittingId: null, sitting: null, exam: null,
            activeSection: null, timeLeft: null, remaining: 0, renderedSection: null };
  var timerIv = null;
  var pollIv = null;
  var _submitting = false;

  function el(id) { return document.getElementById(id); }
  function esc(s) { return (window.WC && window.WC.escapeHtml) ? window.WC.escapeHtml(s) : String(s == null ? '' : s); }
  function wordCount(t) { return (t || '').trim() ? t.trim().split(/\s+/).length : 0; }
  function api(method, path, body) { return method === 'get' ? window.api.get(path) : window.api.post(path, body || {}); }

  function showState(name) {
    ['loading', 'error', 'waiting', 'submitted'].forEach(function (s) {
      var e = el('state-' + s); if (e) e.classList.toggle('hidden', s !== name);
    });
    el('state-test').classList.toggle('on', name === 'test');
  }
  function fail(msg) {
    stopPolling();
    if (timerIv) { clearInterval(timerIv); timerIv = null; }
    el('state-error').querySelector('div').textContent = msg;
    showState('error');
  }

  function configuredSections() {
    var out = [];
    if (S.exam.listening_test_id) out.push('listening');
    if (S.exam.reading_test_code) out.push('reading');
    out.push('writing');
    return out;
  }

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

  async function loadState(isPoll) {
    var st = await api('get', '/api/mock-exams/sittings/' + encodeURIComponent(S.sittingId));
    S.sitting = st.sitting; S.exam = st.exam || {};
    S.activeSection = st.active_section || 'not_started';
    S.timeLeft = st.section_time_left_seconds;
    route(isPoll);
  }

  function startPolling() {
    if (pollIv) return;
    pollIv = setInterval(function () { loadState(true).catch(function () {}); }, POLL_MS);
  }
  function stopPolling() { if (pollIv) { clearInterval(pollIv); pollIv = null; } }

  // ── Routing ────────────────────────────────────────────────────────
  function route() {
    var s = S.sitting.status;
    if (s === 'released') { stopPolling(); location.href = '/pages/mock-result.html?sitting=' + encodeURIComponent(S.sittingId); return; }
    if (s === 'void') return fail('Kỳ thi đã bị huỷ. Liên hệ giám khảo để được cấp lượt mới.');
    if (s !== 'registered' && s !== 'lrw_in_progress') { stopPolling(); return renderSubmitted(); }

    var configured = configuredSections();
    var active = S.activeSection;
    var isOpenSection = active && configured.indexOf(active) !== -1 && !S.sitting[active + '_submitted_at'];

    if (!isOpenSection) {
      S.renderedSection = null;
      if (timerIv) { clearInterval(timerIv); timerIv = null; }
      return renderWaiting();
    }
    if (S.renderedSection === active) {
      // Already showing this section — resync the countdown only, never touch
      // the iframe/src (that would reload it and lose in-progress answers).
      S.remaining = (S.timeLeft != null) ? S.timeLeft : S.remaining;
      return;
    }
    S.renderedSection = active;
    renderSection(active);
  }

  // ── Waiting room ───────────────────────────────────────────────────
  var _SECTION_LABEL = { listening: '🎧 Listening', reading: '📖 Reading', writing: '✍️ Writing' };

  function renderWaiting() {
    el('waiting-title').textContent = 'Thi thử: ' + (S.exam.reading_title || S.code || 'IELTS');
    var configured = configuredSections();
    el('waiting-msg').textContent = (S.activeSection === 'not_started')
      ? 'Đang chờ giám thị bắt đầu bài thi…'
      : 'Đã nộp phần trước — đang chờ giám thị mở phần tiếp theo…';
    el('waiting-checklist').innerHTML = configured.map(function (s) {
      var done = !!S.sitting[s + '_submitted_at'];
      return '<span class="me-check-pill' + (done ? ' done' : '') + '">' + esc(_SECTION_LABEL[s]) + (done ? ' ✓' : '') + '</span>';
    }).join('');
    startPolling();
    showState('waiting');
  }

  // ── Test (ONE section at a time) ──────────────────────────────────
  function lsKey(t) { return 'mock-writing:' + S.sittingId + ':' + t; }

  function renderSection(section) {
    el('section-label').textContent = _SECTION_LABEL[section] || section;
    el('timer').classList.remove('warn');
    el('warn-banner').classList.remove('on');

    var frame = el('panel-frame'), writing = el('panel-writing');
    if (section === 'writing') {
      frame.classList.add('hidden'); frame.removeAttribute('src');
      writing.classList.remove('hidden');
      setupWriting();
    } else {
      writing.classList.add('hidden');
      frame.classList.remove('hidden');
      frame.src = section === 'listening'
        ? '/pages/listening-test.html?id=' + encodeURIComponent(S.exam.listening_test_id) + '&sitting_id=' + encodeURIComponent(S.sittingId) + '&mock_embed=1'
        : '/pages/reading-exam.html?test_id=' + encodeURIComponent(S.exam.reading_test_code) + '&sitting_id=' + encodeURIComponent(S.sittingId) + '&mock_embed=1';
    }

    S.remaining = (S.timeLeft != null) ? S.timeLeft : 0;
    startTimer(section);
    startPolling();
    showState('test');
  }

  function setupWriting() {
    var t1 = S.exam.writing_task1, t2 = S.exam.writing_task2;
    el('prompt-task1').textContent = t1 ? (t1.title ? t1.title + ' — ' : '') + (t1.prompt_text || '') : '(Không có đề Task 1)';
    el('prompt-task2').textContent = t2 ? (t2.title ? t2.title + ' — ' : '') + (t2.prompt_text || '') : '(Không có đề Task 2)';
    // Task 1 Academic prompts may carry a chart/graph image — same treatment
    // as the Writing dashboard's prompt modal (image shown, else hidden).
    var img = el('prompt-task1-image');
    if (t1 && t1.prompt_image_url) {
      img.src = t1.prompt_image_url;
      img.classList.remove('hidden');
    } else {
      img.removeAttribute('src');
      img.classList.add('hidden');
    }
    ['task1', 'task2'].forEach(function (t) {
      var ta = el('essay-' + t);
      try { var saved = localStorage.getItem(lsKey(t)); if (saved) ta.value = saved; } catch (e) {}
      el('count-' + t).textContent = wordCount(ta.value);
      ta.addEventListener('input', function () {
        el('count-' + t).textContent = wordCount(ta.value);
        try { localStorage.setItem(lsKey(t), ta.value); } catch (e) {}
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
  }

  function startTimer(section) {
    if (timerIv) clearInterval(timerIv);
    function tick() {
      if (S.remaining <= 0) {
        clearInterval(timerIv); timerIv = null;
        el('timer').textContent = '00:00';
        submitSection(section, true);
        return;
      }
      var h = Math.floor(S.remaining / 3600), m = Math.floor((S.remaining % 3600) / 60), sec = S.remaining % 60;
      var txt = (h > 0 ? h + ':' + (m < 10 ? '0' : '') : (m < 10 ? '0' : '')) + m + ':' + (sec < 10 ? '0' : '') + sec;
      el('timer').textContent = txt;
      if (S.remaining <= WARN_SECONDS) { el('timer').classList.add('warn'); el('warn-banner').classList.add('on'); }
      S.remaining -= 1;
    }
    tick();
    timerIv = setInterval(tick, 1000);
  }

  // Ask the currently-embedded runner to flush its debounced autosave; resolve
  // when it acks OR after a 3s safety timeout.
  function flushEmbed() {
    var frame = el('panel-frame');
    if (!frame || !frame.src) return Promise.resolve();
    return new Promise(function (resolve) {
      var done = false;
      function finish() { if (!done) { done = true; window.removeEventListener('message', onMsg); resolve(); } }
      function onMsg(ev) { if (ev.data && ev.data.type === 'mock-flushed') finish(); }
      window.addEventListener('message', onMsg);
      try { frame.contentWindow.postMessage({ type: 'mock-flush' }, '*'); } catch (e) {}
      setTimeout(finish, 3000);
    });
  }

  async function submitSection(section, auto) {
    if (_submitting) return;
    _submitting = true;
    if (timerIv) { clearInterval(timerIv); timerIv = null; }
    try {
      if (section === 'writing') {
        await api('post', '/api/mock-exams/sittings/' + S.sittingId + '/sections/writing/submit',
          { task1_text: el('essay-task1').value, task2_text: el('essay-task2').value });
        try { localStorage.removeItem(lsKey('task1')); localStorage.removeItem(lsKey('task2')); } catch (e) {}
      } else {
        await flushEmbed();
        var fresh = await api('get', '/api/mock-exams/sittings/' + encodeURIComponent(S.sittingId));
        var sit = fresh.sitting || {};
        var attemptId = sit[section + '_attempt_id'];
        if (attemptId) {
          var path = section === 'reading'
            ? '/api/reading/test/attempts/' + encodeURIComponent(attemptId) + '/submit'
            : '/api/listening/tests/attempts/' + encodeURIComponent(attemptId) + '/submit';
          await window.api.post(path, section === 'reading' ? { answers: [] } : {}).catch(function () {});
        }
        await api('post', '/api/mock-exams/sittings/' + S.sittingId + '/sections/' + section + '/submit', {});
      }
      await loadState();
    } catch (e) {
      fail('Nộp bài thất bại: ' + (e && e.message ? e.message : e));
    } finally {
      _submitting = false;
    }
  }

  // ── Submitted ──────────────────────────────────────────────────────
  function renderSubmitted() {
    if (timerIv) { clearInterval(timerIv); timerIv = null; }
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
