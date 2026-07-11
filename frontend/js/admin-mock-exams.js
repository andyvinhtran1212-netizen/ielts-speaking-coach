/*
 * admin-mock-exams.js — admin management for 4-skill full mock exams.
 *
 * Create an exam (pick Listening + Reading tests, Writing task1/task2 prompts,
 * total time), then LIVE open/close it so students can start. A test chosen for
 * a mock is reserved (hidden from the normal practice lists — enforced backend).
 */
(function () {
  'use strict';
  initSupabase('https://huwsmtubwulikhlmcirx.supabase.co', 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao');

  function el(id) { return document.getElementById(id); }
  function esc(s) { return (window.WC && window.WC.escapeHtml) ? window.WC.escapeHtml(s) : String(s == null ? '' : s); }
  function toast(m) { if (window.toast) window.toast(m); else console.log(m); }
  function asList(r) { return Array.isArray(r) ? r : (r && (r.items || r.tests || r.prompts || r.exams)) || []; }

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
      var reading = asList(await window.api.get('/api/reading/test?limit=100&test_type=full'));
      fillSelect(el('f-reading'), reading, 'id', function (t) { return (t.title || t.test_id) + ' (' + (t.test_id || '') + ')'; }, true);
    } catch (e) { console.warn('reading picker', e); }
    try {
      var listening = asList(await window.api.get('/admin/listening/tests?limit=100'));
      fillSelect(el('f-listening'), listening, 'id', function (t) { return (t.title || t.test_id || t.id); }, true);
    } catch (e) { console.warn('listening picker', e); }
    try {
      var prompts = asList(await window.api.get('/admin/writing/prompts'));
      var t1 = prompts.filter(function (p) { return (p.task_type || '').indexOf('task1') === 0; });
      var t2 = prompts.filter(function (p) { return (p.task_type || '') === 'task2'; });
      fillSelect(el('f-w1'), t1.length ? t1 : prompts, 'id', function (p) { return (p.title || p.id) + ' [' + (p.task_type || '') + ']'; }, true);
      fillSelect(el('f-w2'), t2.length ? t2 : prompts, 'id', function (p) { return (p.title || p.id) + ' [' + (p.task_type || '') + ']'; }, true);
    } catch (e) { console.warn('writing picker', e); }
  }

  async function loadExams() {
    var host = el('exam-list');
    host.innerHTML = '<p class="me-muted">Đang tải…</p>';
    try {
      var exams = asList(await window.api.get('/admin/mock-exams'));
      if (!exams.length) { host.innerHTML = '<p class="me-muted">Chưa có đề nào.</p>'; return; }
      host.innerHTML = '';
      exams.forEach(function (ex) { host.appendChild(examCard(ex)); });
    } catch (e) {
      host.innerHTML = '<p style="color:var(--av-error)">Lỗi tải danh sách: ' + esc(e && e.message) + '</p>';
    }
  }

  function examCard(ex) {
    var card = document.createElement('div');
    card.className = 'me-card';
    var openPill = ex.is_open ? '<span class="me-pill open">ĐANG MỞ</span>' : '<span class="me-pill">đóng</span>';
    card.innerHTML =
      '<div class="me-row" style="justify-content:space-between">' +
        '<div class="me-row">' +
          '<b style="color:var(--av-text-primary)">' + esc(ex.code) + '</b>' +
          '<span class="me-pill">' + esc(ex.status) + '</span>' + openPill +
          '<span class="me-muted">' + (ex.total_minutes || 150) + '\'</span>' +
        '</div>' +
      '</div>' +
      '<div class="me-muted" style="margin:6px 0">' + esc(ex.title || '') + '</div>' +
      '<div class="me-row" style="gap:6px">' +
        (ex.status === 'draft' ? '<button class="av-btn" data-act="publish">Publish</button>' : '') +
        '<button class="av-btn ' + (ex.is_open ? '' : 'av-btn--primary') + '" data-act="toggle">' + (ex.is_open ? 'Đóng kỳ' : 'Mở kỳ (live)') + '</button>' +
        '<a class="av-btn" href="/pages/admin/mock-reviews/index.html">Duyệt bài →</a>' +
      '</div>';
    var pub = card.querySelector('[data-act="publish"]');
    if (pub) pub.addEventListener('click', function () { publish(ex.id); });
    card.querySelector('[data-act="toggle"]').addEventListener('click', function () { toggleOpen(ex); });
    return card;
  }

  async function createExam() {
    var body = {
      code: el('f-code').value.trim(),
      title: el('f-title').value.trim(),
      total_minutes: parseInt(el('f-total').value, 10) || 150,
      listening_test_id: el('f-listening').value || null,
      reading_test_id: el('f-reading').value || null,
      writing_task1_prompt_id: el('f-w1').value || null,
      writing_task2_prompt_id: el('f-w2').value || null,
    };
    if (!body.code || !body.title) { toast('Nhập mã đề và tiêu đề.'); return; }
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
    if (next && !confirm('Mở kỳ "' + ex.code + '" cho học sinh bắt đầu?')) return;
    try { await window.api.post('/admin/mock-exams/' + encodeURIComponent(ex.id) + '/open', { is_open: next }); toast(next ? 'Đã mở kỳ.' : 'Đã đóng kỳ.'); loadExams(); }
    catch (e) { toast('Thất bại: ' + (e && e.message)); }
  }

  async function boot() {
    var sb = window.getSupabase && window.getSupabase();
    if (sb) { var s = await sb.auth.getSession(); if (!s.data.session) { location.href = '/index.html'; return; } }
    el('create-btn').addEventListener('click', createExam);
    await loadPickers();
    await loadExams();
  }
  boot();
})();
