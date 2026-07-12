/*
 * admin-mock-exams.js — admin management for 4-skill full mock exams.
 *
 * Create an exam (pick Listening + Reading tests — PUBLISHED ones only — Writing
 * task1/task2 prompts, a cohort, and per-section time budgets), publish it, then
 * LIVE open/close it so assigned students can start. Once open, the admin walks
 * the seated block forward ONE SECTION AT A TIME via "Mở phần tiếp theo" —
 * Listening → Reading → Writing — watching the live "đã nộp X/Y" counts. A test
 * chosen for a mock is hidden from the normal student practice lists — but NOT
 * exclusive to one mock exam; the same reading/listening test may be reused
 * across several mock exams, so the pickers below list ALL published tests
 * (backend/services/mock_exam_service.py:admin_available_reading_tests).
 */
(function () {
  'use strict';
  initSupabase('https://huwsmtubwulikhlmcirx.supabase.co', 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao');

  var SECTION_LABEL = { not_started: 'Chưa bắt đầu', listening: 'Listening',
                        reading: 'Reading', writing: 'Writing', done: 'Đã xong' };
  var REFRESH_MS = 15000;

  function el(id) { return document.getElementById(id); }
  function esc(s) { return (window.WC && window.WC.escapeHtml) ? window.WC.escapeHtml(s) : String(s == null ? '' : s); }
  function toast(m) { if (window.toast) window.toast(m); else console.log(m); }
  function asList(r) { return Array.isArray(r) ? r : (r && (r.items || r.tests || r.prompts || r.exams || r.cohorts)) || []; }

  function fillSelect(sel, rows, valueKey, labelFn, allowEmpty) {
    sel.innerHTML = (allowEmpty ? '<option value="">— (không) —</option>' : '');
    rows.forEach(function (r) {
      var o = document.createElement('option');
      o.value = r[valueKey];
      o.textContent = labelFn(r);
      sel.appendChild(o);
    });
  }

  async function loadPickers() {
    try {
      // Admin-only picker: published tests, but NOT filtered by mock-exam
      // reservation — a reading test may be reused across several mock exams.
      var reading = asList(await window.api.get('/admin/mock-exams/reading-tests'));
      fillSelect(el('f-reading'), reading, 'id', function (t) { return (t.title || t.test_id) + ' (' + (t.test_id || '') + ')'; }, true);
    } catch (e) { console.warn('reading picker', e); }
    try {
      var listening = asList(await window.api.get('/admin/listening/tests?limit=100&status=published'));
      fillSelect(el('f-listening'), listening, 'id', function (t) { return (t.title || t.test_id || t.id); }, true);
    } catch (e) { console.warn('listening picker', e); }
    try {
      var prompts = asList(await window.api.get('/admin/writing/prompts'));
      var t1 = prompts.filter(function (p) { return (p.task_type || '').indexOf('task1') === 0; });
      var t2 = prompts.filter(function (p) { return (p.task_type || '') === 'task2'; });
      fillSelect(el('f-w1'), t1.length ? t1 : prompts, 'id', function (p) { return (p.title || p.id) + ' [' + (p.task_type || '') + ']'; }, true);
      fillSelect(el('f-w2'), t2.length ? t2 : prompts, 'id', function (p) { return (p.title || p.id) + ' [' + (p.task_type || '') + ']'; }, true);
    } catch (e) { console.warn('writing picker', e); }
    try {
      var cohorts = asList(await window.api.get('/admin/cohorts?is_active=true'));
      fillSelect(el('f-cohort'), cohorts, 'id', function (c) { return c.name || c.id; }, true);
    } catch (e) { console.warn('cohort picker', e); }
  }

  async function loadExams() {
    var host = el('exam-list');
    var exams;
    try {
      exams = asList(await window.api.get('/admin/mock-exams'));
    } catch (e) {
      host.innerHTML = '<p style="color:var(--av-error)">Lỗi tải danh sách: ' + esc(e && e.message) + '</p>';
      return;
    }
    if (!exams.length) { host.innerHTML = '<p class="me-muted">Chưa có đề nào.</p>'; return; }

    // Progress is only meaningful once an exam is published — fetch in
    // parallel so a slow/failed lookup on one exam doesn't block the rest.
    var progress = {};
    await Promise.all(exams.filter(function (ex) { return ex.status === 'published'; }).map(function (ex) {
      return window.api.get('/admin/mock-exams/' + encodeURIComponent(ex.id) + '/section-progress')
        .then(function (p) { progress[ex.id] = p; })
        .catch(function () {});
    }));

    host.innerHTML = '';
    exams.forEach(function (ex) { host.appendChild(examCard(ex, progress[ex.id])); });
  }

  function progressPills(ex, progress) {
    if (!progress) return '';
    var order = ['listening', 'reading', 'writing'];
    return '<div class="me-row" style="gap:6px;margin-top:8px">' +
      order.filter(function (s) {
        // only show a pill for a section this exam actually configures
        return s === 'writing' || (s === 'listening' ? ex.listening_test_id : ex.reading_test_id);
      }).map(function (s) {
        var sec = progress.sections[s] || { submitted: 0, total: 0 };
        var isActive = progress.active_section === s;
        // "Đang làm" only means something for the currently-open section —
        // sequential gating means every other section is either all-submitted
        // (already passed) or not yet opened (nobody there yet).
        var inProgress = isActive ? Math.max(0, sec.total - sec.submitted) : 0;
        return '<span class="me-pill' + (isActive ? ' open' : '') + '">' +
          esc(SECTION_LABEL[s]) + ': ' + sec.submitted + '/' + sec.total + ' đã nộp' +
          (isActive && inProgress > 0 ? ' · ' + inProgress + ' đang làm' : '') +
          '</span>';
      }).join('') +
      '</div>';
  }

  function examCard(ex, progress) {
    var card = document.createElement('div');
    card.className = 'me-card';
    var openPill = ex.is_open ? '<span class="me-pill open">ĐANG MỞ</span>' : '<span class="me-pill">đóng</span>';
    var activeSection = (progress && progress.active_section) || ex.active_section || 'not_started';
    var canAdvance = ex.status === 'published' && activeSection !== 'done';
    card.innerHTML =
      '<div class="me-row" style="justify-content:space-between">' +
        '<div class="me-row">' +
          '<b style="color:var(--av-text-primary)">' + esc(ex.code) + '</b>' +
          '<span class="me-pill">' + esc(ex.status) + '</span>' + openPill +
          '<span class="me-pill">' + esc(SECTION_LABEL[activeSection] || activeSection) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="me-muted" style="margin:6px 0">' + esc(ex.title || '') + '</div>' +
      progressPills(ex, progress) +
      '<div class="me-row" style="gap:6px;margin-top:10px">' +
        (ex.status === 'draft' ? '<button class="av-btn" data-act="publish">Publish</button>' : '') +
        '<button class="av-btn ' + (ex.is_open ? '' : 'av-btn--primary') + '" data-act="toggle">' + (ex.is_open ? 'Đóng kỳ' : 'Mở kỳ (live)') + '</button>' +
        (canAdvance ? '<button class="av-btn av-btn--primary" data-act="advance">Mở phần tiếp theo →</button>' : '') +
        '<a class="av-btn" href="/pages/admin/mock-reviews/index.html?mock_exam_id=' + encodeURIComponent(ex.id) + '">Duyệt bài →</a>' +
      '</div>';
    var pub = card.querySelector('[data-act="publish"]');
    if (pub) pub.addEventListener('click', function () { publish(ex.id); });
    card.querySelector('[data-act="toggle"]').addEventListener('click', function () { toggleOpen(ex); });
    var adv = card.querySelector('[data-act="advance"]');
    if (adv) adv.addEventListener('click', function () { advance(ex, activeSection, progress); });
    return card;
  }

  async function createExam() {
    var body = {
      code: el('f-code').value.trim(),
      title: el('f-title').value.trim(),
      total_minutes: parseInt(el('f-total').value, 10) || 150,
      reading_minutes: parseInt(el('f-reading-min').value, 10) || 60,
      writing_minutes: parseInt(el('f-writing-min').value, 10) || 60,
      listening_test_id: el('f-listening').value || null,
      reading_test_id: el('f-reading').value || null,
      writing_task1_prompt_id: el('f-w1').value || null,
      writing_task2_prompt_id: el('f-w2').value || null,
      cohort_id: el('f-cohort').value || null,
    };
    if (!body.code || !body.title) { toast('Nhập mã đề và tiêu đề.'); return; }
    if (!body.cohort_id) { toast('Chọn lớp tham gia — chỉ học viên trong lớp này mới thấy đề.'); return; }
    try {
      await window.api.post('/admin/mock-exams', body);
      toast('Đã tạo đề (draft). Publish rồi Mở kỳ để học sinh vào thi.');
      el('f-code').value = ''; el('f-title').value = '';
      loadExams(); loadPickers();
    } catch (e) { toast('Tạo thất bại: ' + (e && e.message)); }
  }

  async function publish(id) {
    try { await window.api.patch('/admin/mock-exams/' + encodeURIComponent(id), { status: 'published' }); toast('Đã publish.'); loadExams(); }
    catch (e) { toast('Publish thất bại: ' + (e && e.message)); }
  }

  async function toggleOpen(ex) {
    if (ex.status !== 'published' && !ex.is_open) { toast('Publish đề trước khi mở kỳ.'); return; }
    var next = !ex.is_open;
    if (next && !confirm('Mở kỳ "' + ex.code + '" cho học sinh trong lớp bắt đầu?')) return;
    try { await window.api.post('/admin/mock-exams/' + encodeURIComponent(ex.id) + '/open', { is_open: next }); toast(next ? 'Đã mở kỳ.' : 'Đã đóng kỳ.'); loadExams(); }
    catch (e) { toast('Thất bại: ' + (e && e.message)); }
  }

  async function advance(ex, activeSection, progress) {
    var seq = ['not_started', 'listening', 'reading', 'writing', 'done'].filter(function (s) {
      return s === 'not_started' || s === 'done' || s === 'writing' ||
        (s === 'listening' ? ex.listening_test_id : ex.reading_test_id);
    });
    var idx = seq.indexOf(activeSection);
    var next = idx >= 0 && idx + 1 < seq.length ? seq[idx + 1] : null;
    var label = next ? (SECTION_LABEL[next] || next) : 'phần tiếp theo';
    var sec = progress && progress.sections && progress.sections[activeSection];
    var stillWorking = sec ? Math.max(0, sec.total - sec.submitted) : null;
    var collectNote = stillWorking
      ? stillWorking + ' học viên chưa nộp (' + sec.submitted + '/' + sec.total + ') sẽ được thu tự động'
      : 'học viên chưa nộp sẽ được thu tự động';
    var msg = activeSection === 'not_started'
      ? 'Bắt đầu kỳ thi — mở phần ' + label + ' cho toàn bộ học viên?'
      : 'Thu bài phần ' + (SECTION_LABEL[activeSection] || activeSection) + ' (' + collectNote + ') và mở phần ' + label + '?';
    if (!confirm(msg)) return;
    try {
      await window.api.post('/admin/mock-exams/' + encodeURIComponent(ex.id) + '/advance', {});
      toast('Đã mở phần ' + label + '.');
      loadExams();
    } catch (e) { toast('Thất bại: ' + (e && e.message)); }
  }

  async function boot() {
    var sb = window.getSupabase && window.getSupabase();
    if (sb) { var s = await sb.auth.getSession(); if (!s.data.session) { location.href = '/index.html'; return; } }
    el('create-btn').addEventListener('click', createExam);
    await loadPickers();
    await loadExams();
    setInterval(loadExams, REFRESH_MS);
  }
  boot();
})();
