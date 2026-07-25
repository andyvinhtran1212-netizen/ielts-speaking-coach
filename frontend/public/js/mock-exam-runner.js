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

  var _SEQ = ['listening', 'reading', 'writing'];

  function configuredSections() {
    // Retake: only the skills THIS student was assigned (order-stable). Otherwise
    // the exam's configured sequence.
    if (S.examMode === 'retake') {
      var assigned = S.assignedSkills || [];
      return _SEQ.filter(function (s) { return assigned.indexOf(s) !== -1; });
    }
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
    S.examMode = st.exam_mode || 'sequential';
    S.assignedSkills = st.assigned_skills || null;
    S.activeSection = st.active_section || 'not_started';
    S.timeLeft = st.section_time_left_seconds;
    route(isPoll);
  }

  // ── Connection state ───────────────────────────────────────────────
  //
  // A3. Every API failure during the exam used to end it: the submit catch
  // called fail(), which stops polling, clears the timer and paints a dead
  // error screen with no way back — so a 30-second outage at the wrong moment
  // finished the student. Poll failures went the other way and were swallowed
  // entirely, so the countdown kept running on stale data with no hint that
  // anything was wrong.
  //
  // Now: say it out loud, keep trying, and only give up on errors a retry
  // genuinely cannot fix.
  var SUBMIT_RETRY_DELAYS = [2000, 5000, 10000, 20000];
  var _pollFails = 0;
  // A section whose submit exhausted its retry ladder. Held so a later
  // successful poll or an `online` event can finish the job.
  var _owedSubmit = null;

  var _CONN_MSG = {
    offline: '⚠ Đang mất kết nối với máy chủ — bài của bạn vẫn được giữ, hệ thống sẽ tự thử lại.',
    submitting: '⏳ Đang nộp bài — kết nối chập chờn, hệ thống đang thử lại…',
    submit_failed: '⚠ Chưa nộp được lên máy chủ. Giữ nguyên tab này; giám thị vẫn thu được bài của bạn khi hết giờ.',
  };

  function setConn(state) {
    var b = el('conn-banner');
    if (!b) return;
    if (!state) { b.classList.remove('on'); return; }
    b.textContent = _CONN_MSG[state] || '';
    b.classList.add('on');
  }

  function startPolling() {
    if (pollIv) return;
    pollIv = setInterval(function () {
      loadState(true).then(function () {
        // Recovered — clear the warning rather than leaving it to rot.
        if (_pollFails) { _pollFails = 0; setConn(null); }
        retryOwedSubmit();
      }).catch(function () {
        // One miss is noise; two in a row is a real problem worth telling the
        // student about. Polling deliberately keeps running either way.
        _pollFails++;
        if (_pollFails >= 2 && !_submitting) setConn('offline');
      });
    }, POLL_MS);
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
      // Retake has no invigilator to "open" the next section — the student
      // picks the next assigned skill from a menu.
      return (S.examMode === 'retake') ? renderRetakeMenu() : renderWaiting();
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

  // Retake: no invigilator — the student starts each assigned skill themselves.
  function renderRetakeMenu() {
    el('waiting-title').textContent = 'Bài test lại: ' + (S.exam.reading_title || S.code || 'IELTS');
    el('waiting-msg').textContent = 'Chọn phần để bắt đầu. Mỗi phần có thời gian riêng — web tự thu bài khi hết giờ.';
    el('waiting-checklist').innerHTML = configuredSections().map(function (s) {
      if (S.sitting[s + '_submitted_at']) {
        return '<span class="me-check-pill done">' + esc(_SECTION_LABEL[s]) + ' ✓</span>';
      }
      return '<button class="av-btn av-btn--primary" data-start="' + s + '" style="margin:4px">Bắt đầu ' + esc(_SECTION_LABEL[s]) + '</button>';
    }).join('');
    el('waiting-checklist').querySelectorAll('[data-start]').forEach(function (b) {
      b.addEventListener('click', function () { startRetakeSection(b.getAttribute('data-start')); });
    });
    startPolling();
    showState('waiting');
  }

  async function startRetakeSection(section) {
    try {
      await api('post', '/api/mock-exams/sittings/' + encodeURIComponent(S.sittingId) + '/sections/' + encodeURIComponent(section) + '/start');
      await loadState();   // active_section is now this section → it renders
    } catch (e) {
      el('waiting-msg').textContent = 'Không bắt đầu được: ' + (e && e.message ? e.message : e);
    }
  }

  // ── Test (ONE section at a time) ──────────────────────────────────
  function lsKey(t) { return 'mock-writing:' + S.sittingId + ':' + t; }

  // ── Writing draft persistence ──────────────────────────────────────
  //
  // Until this existed the essay lived ONLY in localStorage, so a new device, a
  // crashed browser, a cleared cache or a private window lost it outright — and
  // worse, a tab that died before the clock ran out let the server's
  // force-collect promote an EMPTY writing_submission, recording the student as
  // having written nothing. The endpoint that fixes this
  // (POST /sittings/{id}/writing) already existed and was already designed for
  // exactly this — it stores the text WITHOUT stamping writing_submitted_at.
  // Nobody was calling it until submit.
  //
  // localStorage stays as the offline tier: it survives a dead network, the
  // server survives a dead browser, and whichever copy is NEWER wins on load.
  var WRITE_SAVE_MS = 15000;      // idle debounce
  var WRITE_SAVE_CHARS = 400;     // ...or this much new text, whichever first
  var WRITE_RETRY_MS = 5000;      // after a failed save
  var WRITE_MAX_RETRIES = 6;      // ~30s of trying, then wait for the next edit
  var _wSaveTimer = null;
  var _wLastSaved = { task1: '', task2: '' };
  var _wSaving = false;
  var _wDirty = false;
  var _wFlushWired = false;
  var _wRetries = 0;
  // The promise of the save currently on the wire. submitSection AWAITS this:
  // submit_writing does an unconditional update, so a draft POST still in
  // flight when the final submit lands can overwrite the submitted essay — or
  // be the copy that gets promoted for grading (Codex review, PR #835).
  var _wInFlight = null;

  function saveLocalDraft(task, text) {
    try {
      localStorage.setItem(lsKey(task), JSON.stringify({ text: text, ts: Date.now() }));
    } catch (e) {}
  }

  function readLocalDraft(task) {
    var raw = null;
    try { raw = localStorage.getItem(lsKey(task)); } catch (e) { return null; }
    if (!raw) return null;
    try {
      var d = JSON.parse(raw);
      if (d && typeof d === 'object' && typeof d.text === 'string') return d;
    } catch (e) { /* pre-JSON draft, handled below */ }
    // Drafts written before this change were the bare string. Treat them as
    // real text with an unknown (oldest-possible) time, so the server copy wins
    // a tie rather than a stale local one silently overwriting it.
    return { text: String(raw), ts: 0 };
  }

  // Whichever copy is newer wins. Server time is the submitted_at the endpoint
  // stamps on each task blob; local time is Date.now() at keystroke. They come
  // from different clocks, so this is a heuristic — but it only ever has to
  // choose between two copies of the SAME student's work, and the alternative
  // (always trusting one side) loses real text in the other direction.
  function restoreDraft(task) {
    var blob = ((S.sitting && S.sitting.writing_submission) || {})[task] || {};
    var serverText = typeof blob.text === 'string' ? blob.text : '';
    var serverTs = blob.submitted_at ? Date.parse(blob.submitted_at) : 0;
    var local = readLocalDraft(task);
    if (!local || !local.text) return serverText;
    if (!serverText) return local.text;
    return (serverTs && serverTs > (local.ts || 0)) ? serverText : local.text;
  }

  function setSaveCue(state) {
    var cue = el('mw-savecue');
    if (!cue) return;
    var now = new Date();
    var hh = ('0' + now.getHours()).slice(-2), mm = ('0' + now.getMinutes()).slice(-2);
    cue.classList.toggle('is-failed', state === 'failed');
    cue.textContent = state === 'saved' ? 'Đã lưu lúc ' + hh + ':' + mm
      : state === 'saving' ? 'Đang lưu…'
      : 'Chưa lưu được lên máy chủ — bài vẫn giữ trên máy này, sẽ tự thử lại.';
  }

  function scheduleWritingSave() {
    _wDirty = true;
    _wRetries = 0;              // a fresh edit earns a fresh retry budget
    var t1 = el('essay-task1').value, t2 = el('essay-task2').value;
    var delta = Math.abs(t1.length - _wLastSaved.task1.length)
      + Math.abs(t2.length - _wLastSaved.task2.length);
    // A burst of writing shouldn't sit unsent for the whole idle window.
    if (delta >= WRITE_SAVE_CHARS) return flushWritingSave();
    if (_wSaveTimer) return;
    _wSaveTimer = setTimeout(flushWritingSave, WRITE_SAVE_MS);
  }

  function flushWritingSave(opts) {
    if (_wSaveTimer) { clearTimeout(_wSaveTimer); _wSaveTimer = null; }
    // Never autosave outside the open Writing section: the endpoint rejects it,
    // and after submit the text is final — a late save must not race the
    // submitted copy.
    if (!_wDirty || _wSaving || _submitting || S.renderedSection !== 'writing') {
      return _wInFlight || Promise.resolve();
    }
    _wSaving = true;
    setSaveCue('saving');
    var body = { task1_text: el('essay-task1').value, task2_text: el('essay-task2').value };
    // keepalive lets the browser finish the request after the page is gone —
    // the pagehide path is exactly the case this feature exists for.
    _wInFlight = window.api.postWith(
      '/api/mock-exams/sittings/' + encodeURIComponent(S.sittingId) + '/writing',
      body, null, { keepalive: !!(opts && opts.keepalive) }
    ).then(function () {
      _wLastSaved = { task1: body.task1_text, task2: body.task2_text };
      // Only declare the draft clean if the textareas STILL match what we sent.
      // Clearing unconditionally lost every keystroke typed while the request
      // was in flight: the scheduled follow-up then saw _wDirty false and
      // exited, so a later crash or force-collect persisted the OLDER essay
      // while the cue said "Đã lưu" (Codex review, PR #835).
      if (el('essay-task1').value === body.task1_text
          && el('essay-task2').value === body.task2_text) {
        _wDirty = false;
        setSaveCue('saved');
      } else {
        scheduleWritingSave();
      }
    }).catch(function (e) {
      // Stay dirty AND schedule a real retry. Leaving only the flag set meant
      // nothing retried until the student typed again, went offline→online, or
      // left the page — while the cue promised an automatic retry.
      setSaveCue('failed');
      console.warn('[mock-exam] writing autosave failed', e);
      if (_wRetries < WRITE_MAX_RETRIES) {
        _wRetries++;
        _wSaveTimer = setTimeout(function () {
          _wSaveTimer = null;
          flushWritingSave();
        }, WRITE_RETRY_MS);
      }
    }).then(function () {
      _wSaving = false;
      _wInFlight = null;
    });
    return _wInFlight;
  }

  function wireWritingFlush() {
    if (_wFlushWired) return;
    _wFlushWired = true;
    // pagehide covers refresh / navigate / close; visibilitychange→hidden is the
    // only reliable signal when a mobile OS kills a backgrounded tab (same pair
    // reading-exam.js relies on).
    window.addEventListener('pagehide', function () { flushWritingSave({ keepalive: true }); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushWritingSave({ keepalive: true });
    });
    window.addEventListener('online', function () { flushWritingSave(); });
  }

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
      ta.value = restoreDraft(t);
      _wLastSaved[t] = ta.value;
      el('count-' + t).textContent = wordCount(ta.value);
      ta.addEventListener('input', function () {
        el('count-' + t).textContent = wordCount(ta.value);
        saveLocalDraft(t, ta.value);
        scheduleWritingSave();
      });
    });
    wireWritingFlush();
    function selectTask(name) {
      document.querySelectorAll('.me-wtabs .me-tab').forEach(function (x) {
        var on = x.dataset.wtab === name;
        x.classList.toggle('active', on);
        x.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      // Both panes carry a panel per task — switching the tab switches BOTH the
      // đề side and the editor side, so the two never show different tasks.
      document.querySelectorAll('.mw-taskpanel').forEach(function (x) {
        x.classList.toggle('active', x.dataset.wpanel === name);
      });
    }
    document.querySelectorAll('.me-wtabs .me-tab').forEach(function (tab) {
      tab.addEventListener('click', function () { selectTask(tab.dataset.wtab); });
      tab.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        ev.preventDefault();
        selectTask(tab.dataset.wtab);
      });
    });
    setupWritingLayout();
  }

  // ── Writing layout: which side the đề sits on + how big it is ────────
  //
  // Two independent controls, both a WRITER'S PREFERENCE rather than exam
  // state, so both persist globally (not per sitting): the arrangement
  // (đề trái/phải/trên/dưới) and the đề pane's share of the split.
  // Modelled on reading-exam.js's divider — same 4-way drag + keyboard
  // affordance, extended to the vertical arrangements.
  // Below this width the stylesheet forces a vertical stack regardless of the
  // saved arrangement. The drag/keyboard maths must agree with what is actually
  // ON SCREEN, not with data-layout — otherwise a phone drags on the horizontal
  // axis of a vertical split and nothing moves (Codex review, PR #832).
  var NARROW_MQ = '(max-width: 860px)';
  function isNarrow() {
    return !!(window.matchMedia && window.matchMedia(NARROW_MQ).matches);
  }
  function effectiveLayout(split) {
    return isNarrow() ? 'top' : split.dataset.layout;
  }

  var LAYOUT_KEY = 'mock-writing-layout';
  var SPLIT_KEY = 'mock-writing-split';
  var LAYOUTS = ['left', 'right', 'top', 'bottom'];
  var SPLIT_MIN = 25, SPLIT_MAX = 75, SPLIT_DEFAULT = 45;
  var _layoutWired = false;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function setupWritingLayout() {
    var split = el('mw-split'), divider = el('mw-divider');
    if (!split || !divider || _layoutWired) return;
    _layoutWired = true;

    var saved = lsGet(LAYOUT_KEY);
    applyLayout(LAYOUTS.indexOf(saved) !== -1 ? saved : 'left');
    var pct = parseFloat(lsGet(SPLIT_KEY));
    applySplit(Number.isFinite(pct) ? pct : SPLIT_DEFAULT);

    document.querySelectorAll('#mw-layout .mw-layout__btn').forEach(function (b) {
      b.addEventListener('click', function () { applyLayout(b.dataset.layout, true); });
    });

    var dragging = false;
    function onMove(ev) {
      if (!dragging) return;
      var pt = (ev.touches && ev.touches[0]) || ev;
      if (pt.clientX == null) return;
      var rect = split.getBoundingClientRect();
      var layout = effectiveLayout(split);
      var raw;
      // The đề pane is the FIRST flex item, so in the -reverse arrangements it
      // is anchored to the right/bottom edge — measure from that edge instead.
      if (layout === 'left')        raw = (pt.clientX - rect.left) / rect.width;
      else if (layout === 'right')  raw = (rect.right - pt.clientX) / rect.width;
      else if (layout === 'top')    raw = (pt.clientY - rect.top) / rect.height;
      else                          raw = (rect.bottom - pt.clientY) / rect.height;
      applySplit(raw * 100, true);
      ev.preventDefault();
    }
    function endDrag() {
      if (!dragging) return;
      dragging = false;
      divider.classList.remove('is-dragging');
      document.body.style.userSelect = '';
    }
    function startDrag(ev) {
      dragging = true;
      divider.classList.add('is-dragging');
      document.body.style.userSelect = 'none';
      ev.preventDefault();
    }
    divider.addEventListener('mousedown', startDrag);
    divider.addEventListener('touchstart', startDrag, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchend', endDrag);

    // Keyboard: any arrow grows or shrinks the đề pane, so the control works
    // without the student having to know which axis this arrangement uses.
    divider.addEventListener('keydown', function (ev) {
      // Deliberately NOT named after a Tailwind utility. This file is scanned
      // by Tailwind's content globs, and a negated variable whose name matches
      // a utility reads to the scanner as that utility's important modifier —
      // so it emitted a phantom CSS rule and the committed build drifted from
      // a fresh one. (Writing the offending string in a comment does it too:
      // the scanner does not care that it is a comment.)
      var step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
      if (!step) return;
      var layout = effectiveLayout(split);
      if (layout === 'right' || layout === 'bottom') step = -step;
      applySplit(currentSplit() + step * 2, true);
      ev.preventDefault();
    });
  }

  function currentSplit() {
    var split = el('mw-split');
    return parseFloat(getComputedStyle(split).getPropertyValue('--mw-split')) || SPLIT_DEFAULT;
  }

  function applyLayout(name, persist) {
    var split = el('mw-split'), divider = el('mw-divider');
    if (!split) return;
    split.dataset.layout = name;
    document.querySelectorAll('#mw-layout .mw-layout__btn').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.layout === name ? 'true' : 'false');
    });
    if (divider) {
      divider.setAttribute('aria-orientation',
        (name === 'top' || name === 'bottom') ? 'horizontal' : 'vertical');
    }
    if (persist) lsSet(LAYOUT_KEY, name);
  }

  function applySplit(pct, persist) {
    var split = el('mw-split'), divider = el('mw-divider');
    if (!split) return;
    var clamped = Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, pct));
    split.style.setProperty('--mw-split', clamped + '%');
    if (divider) divider.setAttribute('aria-valuenow', String(Math.round(clamped)));
    if (persist) lsSet(SPLIT_KEY, String(clamped));
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

  async function doSubmitSection(section) {
    if (section === 'writing') {
      // SERIALISE with the autosave. submit_writing does an unconditional
      // update, so a draft POST still on the wire can land AFTER the final one
      // and overwrite the submitted essay — or be the copy promoted for
      // grading. Waiting costs at most one request; not waiting can cost the
      // student their essay (Codex review, PR #835).
      if (_wInFlight) { try { await _wInFlight; } catch (e) { /* draft lost; submit anyway */ } }
      await api('post', '/api/mock-exams/sittings/' + S.sittingId + '/sections/writing/submit',
        { task1_text: el('essay-task1').value, task2_text: el('essay-task2').value });
      try { localStorage.removeItem(lsKey('task1')); localStorage.removeItem(lsKey('task2')); } catch (e) {}
      return;
    }
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

  // Retries on anything a retry can fix. The section's clock has already hit 0,
  // so there is no rush the student can feel — and the server's
  // _force_collect_section is the ultimate backstop, which is exactly why the
  // client should be patient here instead of declaring the exam over.
  async function submitSection(section, auto, attempt) {
    attempt = attempt || 0;
    if (_submitting && attempt === 0) return;
    _submitting = true;
    if (timerIv) { clearInterval(timerIv); timerIv = null; }
    try {
      await doSubmitSection(section);
    } catch (e) {
      var st = e && e.status;
      // Terminal: the sitting is gone, or isn't ours. Retrying cannot help.
      if (st === 403 || st === 404) {
        _submitting = false;
        return fail('Không nộp được bài: ' + (e && e.message ? e.message : e));
      }
      // 409 can mean two very different things. The backend maps EVERY
      // SittingConflictError to 409 — "already collected / exam moved on" but
      // also "clock hasn't run out" and "prior section not submitted". Treating
      // them all as success stopped the timer and left the student parked at
      // 00:00 with no further attempt and no warning. So: re-read state, and
      // only accept it if the section really is done or the exam really moved
      // on (Codex review, PR #836).
      if (st === 409) {
        try {
          await loadState();
        } catch (e2) { /* fall through to the retry ladder below */ }
        var sit = S.sitting || {};
        if (sit[section + '_submitted_at'] || S.activeSection !== section) {
          _submitting = false;
          setConn(null);
          return;                       // genuinely collected / moved on
        }
        // Still our open, unsubmitted section — this was a different conflict.
        // Keep trying rather than silently stranding the student.
      }
      if (attempt < SUBMIT_RETRY_DELAYS.length) {
        setConn('submitting');
        // stays _submitting = true so nothing else fires meanwhile
        setTimeout(function () { submitSection(section, auto, attempt + 1); },
          SUBMIT_RETRY_DELAYS[attempt]);
        return;
      }
      // Budget spent. Do NOT kill the page: the answers are already persisted
      // server-side (per-answer autosave for L/R, the Writing draft for W), so
      // the admin's sweep still collects this student. Keep polling — and
      // REMEMBER the submission, because polling alone never retried it: a
      // successful poll for the same active section only resynced the clock
      // while timerIv stayed null, so the student sat at 00:00 forever and the
      // submit endpoint (including Writing's auto-grading) never ran
      // (Codex review, PR #836).
      _submitting = false;
      _owedSubmit = section;
      setConn('submit_failed');
      startPolling();
      return;
    }
    _submitting = false;
    setConn(null);
    await loadState().catch(function () {});
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

  // The browser's own connectivity signal is faster and more reliable than
  // waiting for two polls to time out, so use it to raise and clear the banner
  // and to re-sync the moment the network returns.
  window.addEventListener('offline', function () {
    if (S.renderedSection) setConn('offline');
  });
  window.addEventListener('online', function () {
    _pollFails = 0;
    loadState().then(function () { setConn(null); retryOwedSubmit(); })
      .catch(function () {});
  });

  // Finish a submission whose retry ladder ran out, once the connection is
  // demonstrably back. Guarded so it only fires while that section is still
  // genuinely open and unsubmitted.
  function retryOwedSubmit() {
    if (!_owedSubmit || _submitting) return;
    var section = _owedSubmit;
    var sit = S.sitting || {};
    if (sit[section + '_submitted_at'] || S.activeSection !== section) {
      _owedSubmit = null;               // the sweep or the admin got there first
      setConn(null);
      return;
    }
    _owedSubmit = null;
    submitSection(section, true);
  }

  boot();
})();
