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
    var isRetake = ex.exam_mode === 'retake';
    var modePill = '<span class="me-pill">' + (isRetake ? 'Retake' : 'Sequential') + '</span>';

    if (isRetake) {
      // Retake exams have no shared clock / advance / open-kỳ — access is per
      // student via assignment. Show publish + "Gán test lại" + duyệt.
      card.innerHTML =
        '<div class="me-row" style="justify-content:space-between">' +
          '<div class="me-row">' +
            '<b style="color:var(--av-text-primary)">' + esc(ex.code) + '</b>' +
            '<span class="me-pill">' + esc(ex.status) + '</span>' + modePill +
          '</div>' +
        '</div>' +
        '<div class="me-muted" style="margin:6px 0">' + esc(ex.title || '') + '</div>' +
        '<div class="me-row" style="gap:6px;margin-top:10px">' +
          (ex.status === 'draft' ? '<button class="av-btn" data-act="publish">Publish</button>' : '') +
          '<button class="av-btn av-btn--primary" data-act="assign">Gán test lại</button>' +
          '<a class="av-btn" href="/pages/admin/mock-reviews/index.html?mock_exam_id=' + encodeURIComponent(ex.id) + '">Duyệt bài →</a>' +
        '</div>';
      var pubR = card.querySelector('[data-act="publish"]');
      if (pubR) pubR.addEventListener('click', function () { publish(ex.id); });
      card.querySelector('[data-act="assign"]').addEventListener('click', function () { openAssign(ex); });
      return card;
    }

    var openPill = ex.is_open ? '<span class="me-pill open">ĐANG MỞ</span>' : '<span class="me-pill">đóng</span>';
    var activeSection = (progress && progress.active_section) || ex.active_section || 'not_started';
    var canAdvance = ex.status === 'published' && activeSection !== 'done';
    card.innerHTML =
      '<div class="me-row" style="justify-content:space-between">' +
        '<div class="me-row">' +
          '<b style="color:var(--av-text-primary)">' + esc(ex.code) + '</b>' +
          '<span class="me-pill">' + esc(ex.status) + '</span>' + openPill + modePill +
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
    var mode = el('f-mode') ? el('f-mode').value : 'sequential';
    var body = {
      code: el('f-code').value.trim(),
      title: el('f-title').value.trim(),
      exam_mode: mode,
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
    // Retake exams grant access via per-student assignment, not a cohort.
    if (mode === 'sequential' && !body.cohort_id) {
      toast('Chọn lớp tham gia — chỉ học viên trong lớp này mới thấy đề.'); return;
    }
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

  // ── Retake: gán đề cho từng học viên ────────────────────────────────
  var RETAKE_SKILLS = [
    { key: 'listening', label: 'Listening' },
    { key: 'reading', label: 'Reading' },
    { key: 'writing', label: 'Writing' },
  ];

  function closeAssign() {
    var m = el('assign-modal'); if (m) m.remove();
  }

  async function openAssign(ex) {
    closeAssign();
    var overlay = document.createElement('div');
    overlay.id = 'assign-modal';
    overlay.className = 'me-modal';
    overlay.innerHTML =
      '<div class="me-modal__box">' +
        '<div class="me-row" style="justify-content:space-between;margin-bottom:8px">' +
          '<b style="color:var(--av-text-primary)">Gán test lại — ' + esc(ex.code) + '</b>' +
          '<button class="av-btn" data-x>Đóng</button>' +
        '</div>' +
        '<div class="me-grid">' +
          '<div><label>Đề gốc (lấy danh sách cần test lại)</label><select id="a-source"></select></div>' +
          '<div><label>Mở từ</label><input id="a-from" type="datetime-local"></div>' +
          '<div><label>Đóng lúc</label><input id="a-until" type="datetime-local"></div>' +
        '</div>' +
        '<div id="a-students" class="me-muted" style="margin-top:10px">Chọn đề gốc để hiện học viên cần test lại.</div>' +
        '<div class="me-row" style="gap:6px;margin-top:12px">' +
          '<button class="av-btn av-btn--primary" id="a-assign" disabled>Gán cho học viên đã tick</button>' +
        '</div>' +
        '<h3 style="margin-top:16px;color:var(--av-text-primary)">Đã gán</h3>' +
        '<div id="a-current" class="me-muted">Đang tải…</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('[data-x]').addEventListener('click', closeAssign);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeAssign(); });

    // Source picker = published exams (any mode) whose review produced flags.
    try {
      var exams = asList(await window.api.get('/admin/mock-exams'))
        .filter(function (e) { return e.id !== ex.id && e.status === 'published'; });
      fillSelect(el('a-source'), exams, 'id', function (e) { return (e.code || '') + ' — ' + (e.title || ''); }, true);
    } catch (e) { /* leave empty */ }
    el('a-source').addEventListener('change', function () { loadRetestStudents(el('a-source').value); });
    el('a-assign').addEventListener('click', function () { doAssign(ex.id, el('a-source').value); });
    loadCurrentAssignments(ex.id);
  }

  async function loadRetestStudents(sourceId) {
    var host = el('a-students');
    el('a-assign').disabled = true;
    if (!sourceId) { host.textContent = 'Chọn đề gốc để hiện học viên cần test lại.'; return; }
    host.textContent = 'Đang tải…';
    try {
      var s = await window.api.get('/admin/mock-exams/' + encodeURIComponent(sourceId) + '/retest-summary');
      var studs = (s.students || []).filter(function (st) { return st.user_id; });
      if (!studs.length) { host.textContent = 'Đề gốc chưa có học viên nào cần test lại.'; return; }
      host.innerHTML = '<table class="adm-table"><thead><tr><th></th><th>Học viên</th>' +
        RETAKE_SKILLS.map(function (sk) { return '<th>' + sk.label + '</th>'; }).join('') +
        '</tr></thead><tbody>' +
        studs.map(function (st) {
          var flagged = st.skills || [];
          return '<tr data-uid="' + esc(st.user_id) + '">' +
            '<td><input type="checkbox" class="a-pick" checked></td>' +
            '<td>' + esc(st.student_name) + '</td>' +
            RETAKE_SKILLS.map(function (sk) {
              return '<td><input type="checkbox" class="a-skill" data-skill="' + sk.key + '"' +
                (flagged.indexOf(sk.key) !== -1 ? ' checked' : '') + '></td>';
            }).join('') +
            '</tr>';
        }).join('') + '</tbody></table>';
      el('a-assign').disabled = false;
    } catch (e) { host.innerHTML = '<span style="color:var(--av-error)">Lỗi: ' + esc(e && e.message) + '</span>'; }
  }

  function toIso(localVal) {
    // datetime-local → ISO (browser local time). Empty → null.
    return localVal ? new Date(localVal).toISOString() : null;
  }

  async function doAssign(examId, sourceId) {
    var from = toIso(el('a-from').value), until = toIso(el('a-until').value);
    var rows = [];
    el('a-students').querySelectorAll('tr[data-uid]').forEach(function (tr) {
      if (!tr.querySelector('.a-pick').checked) return;
      var skills = [];
      tr.querySelectorAll('.a-skill').forEach(function (c) { if (c.checked) skills.push(c.getAttribute('data-skill')); });
      if (skills.length) rows.push({ user_id: tr.getAttribute('data-uid'), skills: skills, open_from: from, open_until: until });
    });
    if (!rows.length) { toast('Chọn ít nhất 1 học viên + kĩ năng.'); return; }
    try {
      var res = await window.api.post('/admin/mock-exams/' + encodeURIComponent(examId) + '/assignments',
        { assignments: rows, source_exam_id: sourceId || null });
      toast('Đã gán ' + (res.assigned || []).length + ' học viên' +
        ((res.skipped || []).length ? ' · bỏ qua ' + res.skipped.length : '') + '.');
      loadCurrentAssignments(examId);
    } catch (e) { toast('Gán thất bại: ' + (e && e.message)); }
  }

  async function loadCurrentAssignments(examId) {
    var host = el('a-current');
    try {
      var res = await window.api.get('/admin/mock-exams/' + encodeURIComponent(examId) + '/assignments');
      var rows = (res && res.assignments) || [];
      if (!rows.length) { host.textContent = 'Chưa gán học viên nào.'; return; }
      host.innerHTML = rows.map(function (r) {
        return '<div class="me-row" style="gap:8px;margin-top:4px"><span style="color:var(--av-text-primary)">' +
          esc(r.student_name) + '</span><span class="me-pill">' + (r.skills || []).join(', ') + '</span>' +
          '<button class="av-btn" data-unassign="' + esc(r.user_id) + '">Gỡ</button></div>';
      }).join('');
      host.querySelectorAll('[data-unassign]').forEach(function (b) {
        b.addEventListener('click', function () { doUnassign(examId, b.getAttribute('data-unassign')); });
      });
    } catch (e) { host.innerHTML = '<span style="color:var(--av-error)">Lỗi: ' + esc(e && e.message) + '</span>'; }
  }

  async function doUnassign(examId, userId) {
    try {
      await window.api.delete('/admin/mock-exams/' + encodeURIComponent(examId) + '/assignments/' + encodeURIComponent(userId));
      loadCurrentAssignments(examId);
    } catch (e) { toast('Gỡ thất bại: ' + (e && e.message)); }
  }

  async function boot() {
    var sb = window.getSupabase && window.getSupabase();
    if (sb) { var s = await sb.auth.getSession(); if (!s.data.session) { location.href = '/index.html'; return; } }
    el('create-btn').addEventListener('click', createExam);
    var modeSel = el('f-mode');
    if (modeSel) modeSel.addEventListener('change', function () {
      var hint = el('cohort-hint');
      if (hint) hint.textContent = modeSel.value === 'retake' ? '(không cần — gán từng HV)' : '(bắt buộc — sequential)';
    });
    await loadPickers();
    await loadExams();
    setInterval(loadExams, REFRESH_MS);
  }
  boot();
})();
