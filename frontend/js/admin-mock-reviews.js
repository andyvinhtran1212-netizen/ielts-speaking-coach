/*
 * admin-mock-reviews.js — admin review console for 4-skill mock sittings.
 *
 * Drives /admin/mock-reviews (queue, claim, final-bands, release) + reads the
 * sitting for the 4-skill surfaces. Writing renders the native writing_submission
 * text (P1); when essay ids are present it deep-links to the admin_writing grade
 * page instead. Overall band is computed server-side (verified mean) — the client
 * only shows a live preview.
 */
(function () {
  'use strict';
  initSupabase('https://huwsmtubwulikhlmcirx.supabase.co', 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao');

  var SKILLS = ['listening', 'reading', 'writing', 'speaking'];
  var current = null; // {review, sitting, required_skills}

  // The skills the admin must band — from the exam config (Speaking optional for
  // LRW-only exams). Falls back to all four.
  function reqSkills() {
    return (current && current.required_skills && current.required_skills.length)
      ? current.required_skills : SKILLS;
  }

  function esc(s) { return (window.WC && window.WC.escapeHtml) ? window.WC.escapeHtml(s) : String(s == null ? '' : s); }
  function toast(msg) { if (window.toast) window.toast(msg); else console.log(msg); }
  function el(id) { return document.getElementById(id); }
  function ieltsRound(x) { return Math.max(0, Math.min(9, Math.floor(x * 2 + 0.5 + 1e-9) / 2)); }

  function fmtBand(v) { return (v == null || v === '') ? '—' : Number(v).toFixed(1); }

  // ── Queue ──────────────────────────────────────────────────────────
  async function loadQueue() {
    el('detail-view').classList.add('hidden');
    el('queue-view').classList.remove('hidden');
    var list = el('queue-list');
    list.innerHTML = '<p class="mr-muted">Đang tải…</p>';
    try {
      var res = await window.api.get('/admin/mock-reviews');
      var reviews = (res && res.reviews) || [];
      el('queue-count').textContent = reviews.length + ' hồ sơ trong hàng đợi';
      if (!reviews.length) { list.innerHTML = '<p class="mr-muted">Chưa có sitting nào cần duyệt.</p>'; return; }
      list.innerHTML = '';
      reviews.forEach(function (r) {
        var row = document.createElement('div');
        row.className = 'mr-row';
        row.innerHTML =
          '<span class="mr-pill">' + esc(r.status) + '</span>' +
          '<span style="flex:1;font-family:var(--av-font-mono,monospace);font-size:12px;color:var(--av-text-secondary)">sitting ' + esc(String(r.sitting_id).slice(0, 8)) + '…</span>' +
          '<span class="mr-muted">' + (r.claimed_by ? 'đã nhận' : 'chưa nhận') + '</span>';
        row.addEventListener('click', function () { openDetail(r.id); });
        list.appendChild(row);
      });
    } catch (e) {
      list.innerHTML = '<p style="color:var(--av-error,#dc2626)">Lỗi tải hàng đợi: ' + esc(e && e.message) + '</p>';
    }
  }

  // ── Detail ─────────────────────────────────────────────────────────
  async function openDetail(reviewId) {
    try {
      current = await window.api.get('/admin/mock-reviews/' + encodeURIComponent(reviewId));
    } catch (e) { toast('Không mở được hồ sơ: ' + (e && e.message)); return; }
    renderDetail();
  }

  function skillTabHtml(skill, sitting, draft) {
    if (skill === 'writing') {
      var ws = sitting.writing_submission || {};
      if (sitting.essay_task1_id || sitting.essay_task2_id) {
        var links = '';
        if (sitting.essay_task1_id) links += '<a class="av-btn" target="_blank" href="/pages/admin/writing/grade.html?essay_id=' + encodeURIComponent(sitting.essay_task1_id) + '">Chấm Task 1 ↗</a> ';
        if (sitting.essay_task2_id) links += '<a class="av-btn" target="_blank" href="/pages/admin/writing/grade.html?essay_id=' + encodeURIComponent(sitting.essay_task2_id) + '">Chấm Task 2 ↗</a>';
        return links || '<p class="mr-muted">Chưa có bài Writing.</p>';
      }
      var out = '';
      ['task1', 'task2'].forEach(function (t, i) {
        var d = ws[t];
        out += '<h4 style="margin:10px 0 4px;font-weight:700;color:var(--av-text-primary)">Task ' + (i + 1) + ' <span class="mr-muted">(' + (d ? d.word_count : 0) + ' từ)</span></h4>';
        out += '<div class="mr-essay">' + (d && d.text ? esc(d.text) : '<span class="mr-muted">— trống —</span>') + '</div>';
      });
      return out;
    }
    if (skill === 'speaking') {
      var ids = sitting.speaking_session_ids || [];
      if (!ids.length) return '<p class="mr-muted">Chưa có bài Speaking.</p>';
      return '<p class="mr-muted">' + ids.length + ' session:</p>' + ids.map(function (id) {
        return '<div style="margin:4px 0"><a target="_blank" href="/pages/full-test-result.html?session_id=' + encodeURIComponent(id) + '">Nghe & xem transcript ↗</a></div>';
      }).join('');
    }
    // listening / reading — show the AI draft band + raw
    var dd = (draft && draft[skill]) || {};
    return '<p class="mr-muted">Nháp AI (tham khảo):</p><p style="font-size:20px;font-weight:700;color:var(--av-text-primary)">Raw ' + fmtBand(dd.raw).replace('.0', '') + ' · Band ' + fmtBand(dd.band) + '</p>';
  }

  function renderDetail() {
    var review = current.review, sitting = current.sitting || {};
    var draft = review.ai_draft || {};
    var fb = review.final_bands || {};
    var claimedByMe = !!review.claimed_by; // server enforces owner; UI just needs "claimed"
    var v = el('detail-view');

    var tabs = SKILLS.map(function (s, i) {
      return '<div class="mr-tab' + (i === 0 ? ' active' : '') + '" data-tab="' + s + '">' +
        ({ listening: '🎧 Listening', reading: '📖 Reading', writing: '✍️ Writing', speaking: '🎙 Speaking' }[s]) + '</div>';
    }).join('');

    var panels = SKILLS.map(function (s, i) {
      return '<div class="mr-panel' + (i === 0 ? ' active' : '') + '" data-panel="' + s + '">' + skillTabHtml(s, sitting, draft) + '</div>';
    }).join('');

    var bandInputs = reqSkills().map(function (s) {
      return '<div><label>' + s + '</label><input type="number" step="0.5" min="0" max="9" data-band="' + s + '" value="' + (fb[s] != null ? fb[s] : '') + '"></div>';
    }).join('');

    v.innerHTML =
      '<button class="av-btn" id="back-btn">← Hàng đợi</button>' +
      '<div style="display:flex;align-items:center;gap:10px;margin:12px 0">' +
        '<span class="mr-pill">' + esc(review.status) + '</span>' +
        '<span class="mr-muted" style="font-family:monospace">sitting ' + esc(String(review.sitting_id).slice(0, 8)) + '…</span>' +
        (review.status === 'queued' ? '<button class="av-btn av-btn--primary" id="claim-btn">Nhận duyệt</button>' : '') +
      '</div>' +
      '<div class="mr-tabs">' + tabs + '</div>' +
      panels +
      '<div style="margin-top:20px;border-top:1px solid var(--av-border-default);padding-top:16px">' +
        '<h3 style="font-weight:700;color:var(--av-text-primary);margin-bottom:6px">Band cuối (giám khảo quyết)</h3>' +
        '<div class="mr-band-form">' + bandInputs + '</div>' +
        '<p class="mr-muted">Overall (xem trước): <b id="overall-preview">—</b> · Overall chính thức do server tính lại.</p>' +
        '<label class="mr-muted" style="display:block;margin-top:10px">Nhận xét tổng (student-facing)</label>' +
        '<textarea class="mr-input" id="examiner-comment">' + esc(review.examiner_comment_vi || '') + '</textarea>' +
        '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">' +
          '<button class="av-btn" id="save-btn">Lưu band nháp</button>' +
          '<select id="channel-select" class="av-btn"><option value="in_app">Kênh: In-app</option><option value="manual">Thủ công</option><option value="email">Email</option></select>' +
          '<button class="av-btn av-btn--primary" id="release-btn">CÔNG BỐ kết quả</button>' +
        '</div>' +
        '<p class="mr-muted" style="margin-top:8px">Công bố yêu cầu đã “Lưu band” (trạng thái reviewed) và mở khoá điểm cho học viên.</p>' +
      '</div>';

    el('queue-view').classList.add('hidden');
    v.classList.remove('hidden');

    v.querySelectorAll('.mr-tab').forEach(function (t) {
      t.addEventListener('click', function () {
        v.querySelectorAll('.mr-tab').forEach(function (x) { x.classList.remove('active'); });
        v.querySelectorAll('.mr-panel').forEach(function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        v.querySelector('.mr-panel[data-panel="' + t.dataset.tab + '"]').classList.add('active');
      });
    });

    function updateOverall() {
      var skills = reqSkills();
      var vals = skills.map(function (s) { return parseFloat(v.querySelector('[data-band="' + s + '"]').value); });
      if (vals.some(function (n) { return isNaN(n); })) { el('overall-preview').textContent = '—'; return; }
      el('overall-preview').textContent = ieltsRound(vals.reduce(function (a, b) { return a + b; }, 0) / vals.length).toFixed(1);
    }
    v.querySelectorAll('[data-band]').forEach(function (inp) { inp.addEventListener('input', updateOverall); });
    updateOverall();

    el('back-btn').addEventListener('click', loadQueue);
    var claimBtn = el('claim-btn');
    if (claimBtn) claimBtn.addEventListener('click', function () { doClaim(review.id); });
    el('save-btn').addEventListener('click', function () { doSave(review.id, v); });
    el('release-btn').addEventListener('click', function () { doRelease(review.id); });
  }

  async function doClaim(id) {
    try { await window.api.post('/admin/mock-reviews/' + encodeURIComponent(id) + '/claim', {}); toast('Đã nhận'); openDetail(id); }
    catch (e) { toast('Không nhận được: ' + (e && e.message)); }
  }

  function collectBands(v) {
    var fb = {};
    reqSkills().forEach(function (s) { fb[s] = parseFloat(v.querySelector('[data-band="' + s + '"]').value); });
    return fb;
  }

  async function doSave(id, v) {
    var fb = collectBands(v);
    var skills = reqSkills();
    if (skills.some(function (s) { return isNaN(fb[s]); })) {
      toast('Nhập đủ ' + skills.length + ' band trước khi lưu.'); return;
    }
    try {
      await window.api.post('/admin/mock-reviews/' + encodeURIComponent(id) + '/final-bands', {
        final_bands: fb,
        examiner_comment_vi: el('examiner-comment').value || null,
      });
      toast('Đã lưu band nháp (reviewed).');
      openDetail(id);
    } catch (e) { toast('Lưu thất bại: ' + (e && e.message)); }
  }

  async function doRelease(id) {
    var channel = el('channel-select').value;
    if (!confirm('Công bố kết quả cho học viên? Điểm sẽ được mở khoá và không thể giấu lại.')) return;
    try {
      await window.api.post('/admin/mock-reviews/' + encodeURIComponent(id) + '/release', { channel: channel });
      toast('Đã công bố kết quả.');
      loadQueue();
    } catch (e) { toast('Công bố thất bại: ' + (e && e.message)); }
  }

  async function boot() {
    var sb = window.getSupabase && window.getSupabase();
    if (sb) { var s = await sb.auth.getSession(); if (!s.data.session) { location.href = '/index.html'; return; } }
    var rb = el('refresh-btn'); if (rb) rb.addEventListener('click', loadQueue);
    loadQueue();
  }
  boot();
})();
