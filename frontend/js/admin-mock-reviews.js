/*
 * admin-mock-reviews.js — admin review console for 4-skill mock sittings.
 *
 * Duyệt theo từng đề (2026-07-12): the page requires ?mock_exam_id= — there is
 * no cross-exam flat queue anymore. The landing view is a class ROSTER GRID
 * (rows = students, columns = 4 skills + claim status) from
 * GET /admin/mock-exams/{id}/roster; clicking a submitted row opens the review
 * detail. Drives /admin/mock-reviews (claim, final-bands, release) + reads the
 * sitting for the 4-skill surfaces. Writing
 * renders the native writing_submission text (P1); when essay ids are present
 * it deep-links to the admin_writing grade page instead. Listening/Reading
 * show a compact RESULTS summary (score/band/breakdown) fetched from the same
 * admin-bypassed review endpoint — NOT the full per-question chữa-bài (that
 * has no value for an admin deciding a band; chữa bài only unlocks for the
 * STUDENT after CÔNG BỐ, linked from mock-result.html, 2026-07-12).
 * Overall band is computed server-side (verified mean) — the client only
 * shows a live preview.
 */
(function () {
  'use strict';
  initSupabase('https://huwsmtubwulikhlmcirx.supabase.co', 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao');

  var SKILLS = ['listening', 'reading', 'writing', 'speaking'];
  var current = null; // {review, sitting, required_skills}
  // duyệt theo từng đề, không duyệt hàng loạt — mock_exam_id is required to
  // load any queue; the page shows a "chọn đề" prompt without it.
  var examId = new URLSearchParams(location.search).get('mock_exam_id');

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

  // ── Roster (bảng lớp: học viên × 4 kỹ năng + trạng thái) ─────────────
  function hasWritingEssays(r) {
    var w = r.writing || {};
    return !!(w.task1_essay_id || w.task2_essay_id);
  }

  async function loadRoster() {
    el('detail-view').classList.add('hidden');
    el('queue-view').classList.remove('hidden');
    var list = el('queue-list');
    list.innerHTML = '<p class="mr-muted">Đang tải…</p>';
    try {
      var res = await window.api.get('/admin/mock-exams/' + encodeURIComponent(examId) + '/roster');
      var rows = (res && res.roster) || [];
      var submitted = rows.filter(function (r) { return r.review_id; }).length;
      el('queue-count').textContent = rows.length + ' học viên · ' + submitted + ' đã nộp đủ';
      if (!rows.length) { list.innerHTML = '<p class="mr-muted">Chưa có học viên nào trong đề này.</p>'; return; }
      var gradable = rows.some(hasWritingEssays);
      list.innerHTML = (gradable ? bulkBarHtml() : '') + renderRosterTable(rows);
      list.querySelectorAll('[data-review-id]').forEach(function (tr) {
        tr.addEventListener('click', function (ev) {
          if (ev.target && ev.target.closest('.mr-check')) return;   // checkbox click ≠ open
          openDetail(tr.getAttribute('data-review-id'));
        });
      list.innerHTML = renderRosterTable(rows);
      list.querySelectorAll('[data-review-id]').forEach(function (tr) {
        tr.addEventListener('click', function () { openDetail(tr.getAttribute('data-review-id')); });
      });
      if (gradable) wireBulkBar(list);
    } catch (e) {
      list.innerHTML = '<p style="color:var(--av-error,#dc2626)">Lỗi tải bảng lớp: ' + esc(e && e.message) + '</p>';
    }
  }

  function bulkBarHtml() {
    return '<div class="mr-bulkbar">' +
      '<label class="mr-check"><input type="checkbox" id="bulk-all"> Chọn tất cả</label>' +
      '<span style="flex:1"></span>' +
      '<span class="mr-muted">Chấm Writing hàng loạt:</span>' +
      '<select id="bulk-tier"><option value="standard">Standard</option><option value="instructor">Instructor</option></select>' +
      '<button class="av-btn av-btn--primary" id="bulk-grade-btn" disabled>Đưa vào hàng chấm</button>' +
      '</div>';
  }

  function wireBulkBar(list) {
    var boxes = Array.prototype.slice.call(list.querySelectorAll('.mr-check-row'));
    var btn = el('bulk-grade-btn');
    var all = el('bulk-all');
    function refresh() {
      var n = boxes.filter(function (b) { return b.checked; }).length;
      btn.disabled = !n;
      btn.textContent = n ? ('Đưa vào hàng chấm (' + n + ')') : 'Đưa vào hàng chấm';
    }
    boxes.forEach(function (b) { b.addEventListener('change', refresh); });
    if (all) all.addEventListener('change', function () {
      boxes.forEach(function (b) { b.checked = all.checked; });
      refresh();
    });
    btn.addEventListener('click', function () {
      var ids = boxes.filter(function (b) { return b.checked; })
        .map(function (b) { return b.getAttribute('data-sitting-id'); });
      if (ids.length) bulkGrade(ids, el('bulk-tier').value);
    });
    refresh();
  }

  async function bulkGrade(sittingIds, tier) {
    try {
      var res = await window.api.post(
        '/admin/mock-exams/' + encodeURIComponent(examId) + '/writing/bulk-grade',
        { sitting_ids: sittingIds, grading_tier: tier });
      var q = (res.queued || []).length, sk = (res.skipped || []).length;
      toast('Đã đưa ' + q + ' bài vào hàng chấm' + (sk ? ' · bỏ qua ' + sk + ' (đã chấm)' : '') + '.');
      loadRoster();
    } catch (e) { toast('Chấm hàng loạt thất bại: ' + (e && e.message)); }
  }

  function lrCell(o) {
    if (!o || o.score == null) return '<span class="mr-muted">—</span>';
    return '<b>' + o.score + '</b>/' + (o.max || '?') + (o.band != null ? ' · B' + Number(o.band).toFixed(1) : '');
  }
  function wCell(w) {
    if (!w || (w.task1_wc == null && w.task2_wc == null)) return '<span class="mr-muted">—</span>';
    return 'T1 ' + (w.task1_wc != null ? w.task1_wc : '—') + ' · T2 ' + (w.task2_wc != null ? w.task2_wc : '—') + ' từ';
  }
  function spkCell(s) {
    return (s && s.count) ? (s.count + ' session') : '<span class="mr-muted">—</span>';
  }
  function claimCell(r) {
    if (!r.review_id) return '<span class="mr-pill">đang làm</span>';
    return '<span class="mr-pill">' + (r.claimed ? 'đã nhận' : 'chưa nhận') + '</span>';
  }

  function renderRosterTable(rows) {
    var head = '<thead><tr>' +
      ['', 'Học viên', 'Listening', 'Reading', 'Writing', 'Speaking', 'Trạng thái']
        .map(function (h) { return '<th>' + h + '</th>'; }).join('') +
      '</tr></thead>';
    var body = rows.map(function (r) {
      var attrs = r.review_id
        ? ' class="mr-trow" data-review-id="' + esc(r.review_id) + '"'
        : ' class="mr-trow mr-trow--wip"';
      var check = hasWritingEssays(r)
        ? '<label class="mr-check"><input type="checkbox" class="mr-check-row" data-sitting-id="' + esc(r.sitting_id) + '"></label>'
        : '';
      return '<tr' + attrs + '>' +
        '<td>' + check + '</td>' +
        '<td>' + esc(r.student_name) + '</td>' +
        '<td>' + lrCell(r.listening) + '</td>' +
        '<td>' + lrCell(r.reading) + '</td>' +
        '<td>' + wCell(r.writing) + '</td>' +
        '<td>' + spkCell(r.speaking) + '</td>' +
        '<td>' + claimCell(r) + '</td>' +
        '</tr>';
    }).join('');
    return '<div class="adm-table-wrap"><table class="adm-table mr-roster">' + head + '<tbody>' + body + '</tbody></table></div>';
  }

  function lrCell(o) {
    if (!o || o.score == null) return '<span class="mr-muted">—</span>';
    return '<b>' + o.score + '</b>/' + (o.max || '?') + (o.band != null ? ' · B' + Number(o.band).toFixed(1) : '');
  }
  function wCell(w) {
    if (!w || (w.task1_wc == null && w.task2_wc == null)) return '<span class="mr-muted">—</span>';
    return 'T1 ' + (w.task1_wc != null ? w.task1_wc : '—') + ' · T2 ' + (w.task2_wc != null ? w.task2_wc : '—') + ' từ';
  }
  function spkCell(s) {
    return (s && s.count) ? (s.count + ' session') : '<span class="mr-muted">—</span>';
  }
  function claimCell(r) {
    if (!r.review_id) return '<span class="mr-pill">đang làm</span>';
    return '<span class="mr-pill">' + (r.claimed ? 'đã nhận' : 'chưa nhận') + '</span>';
  }

  function renderRosterTable(rows) {
    var head = '<thead><tr>' +
      ['Học viên', 'Listening', 'Reading', 'Writing', 'Speaking', 'Trạng thái']
        .map(function (h) { return '<th>' + h + '</th>'; }).join('') +
      '</tr></thead>';
    var body = rows.map(function (r) {
      var attrs = r.review_id
        ? ' class="mr-trow" data-review-id="' + esc(r.review_id) + '"'
        : ' class="mr-trow mr-trow--wip"';
      return '<tr' + attrs + '>' +
        '<td>' + esc(r.student_name) + '</td>' +
        '<td>' + lrCell(r.listening) + '</td>' +
        '<td>' + lrCell(r.reading) + '</td>' +
        '<td>' + wCell(r.writing) + '</td>' +
        '<td>' + spkCell(r.speaking) + '</td>' +
        '<td>' + claimCell(r) + '</td>' +
        '</tr>';
    }).join('');
    return '<div class="adm-table-wrap"><table class="adm-table mr-roster">' + head + '<tbody>' + body + '</tbody></table></div>';
  }

  // ── Detail ─────────────────────────────────────────────────────────
  var ESSAY_STATUS_LABEL = { pending: 'Chưa chấm', grading: 'Đang chấm', graded: 'Đã chấm (AI)',
                             reviewed: 'Đã duyệt', delivered: 'Đã trả bài', failed: 'Lỗi chấm' };

  async function openDetail(reviewId) {
    try {
      current = await window.api.get('/admin/mock-reviews/' + encodeURIComponent(reviewId));
    } catch (e) { toast('Không mở được hồ sơ: ' + (e && e.message)); return; }
    // Writing essays promoted from the mock sitting (2026-07-12) start life
    // 'pending' — fetch their status so the writing tab knows whether to show
    // the tier-picker or the existing "Chấm ↗" deep-link.
    var sitting = current.sitting || {};
    current.essayStatus = {};
    await Promise.all(['task1', 'task2'].map(function (t) {
      var id = sitting['essay_' + t + '_id'];
      if (!id) return Promise.resolve();
      return window.api.get('/admin/writing/essays/' + encodeURIComponent(id) + '/status')
        .then(function (s) { current.essayStatus[t] = s; })
        .catch(function () {});
    }));
    // Results summary (score/band) for Listening/Reading — same endpoint the
    // student's chữa-bài page calls (admin bypass), but we only render the
    // top-level summary fields here, not the per-question solutions.
    current.skillResult = {};
    await Promise.all(['listening', 'reading'].map(function (skill) {
      var attemptId = sitting[skill + '_attempt_id'];
      if (!attemptId) return Promise.resolve();
      var url = skill === 'reading'
        ? '/api/reading/test/attempts/' + encodeURIComponent(attemptId) + '/review'
        : '/api/listening/tests/attempts/' + encodeURIComponent(attemptId) + '/review';
      return window.api.get(url)
        .then(function (r) { current.skillResult[skill] = r; })
        .catch(function () {});
    }));
    renderDetail();
  }

  function writingTaskHtml(t, i, sitting, ws) {
    var essayId = sitting['essay_' + t + '_id'];
    if (!essayId) {
      // Pre-promotion sitting (predates 2026-07-12) — fall back to the raw
      // JSON capture inline.
      var d = ws[t];
      return '<h4 style="margin:10px 0 4px;font-weight:700;color:var(--av-text-primary)">Task ' + (i + 1) + ' <span class="mr-muted">(' + (d ? d.word_count : 0) + ' từ)</span></h4>' +
        '<div class="mr-essay">' + (d && d.text ? esc(d.text) : '<span class="mr-muted">— trống —</span>') + '</div>';
    }
    var st = (current.essayStatus && current.essayStatus[t] && current.essayStatus[t].status) || 'pending';
    var label = '<span class="mr-pill">' + esc(ESSAY_STATUS_LABEL[st] || st) + '</span>';
    if (st === 'pending') {
      return '<div style="display:flex;align-items:center;gap:8px;margin:8px 0">' +
        '<span style="font-weight:700;color:var(--av-text-primary)">Task ' + (i + 1) + '</span>' + label +
        '<select data-tier-for="' + t + '"><option value="standard">Standard</option><option value="instructor">Instructor</option></select>' +
        '<button class="av-btn av-btn--primary" data-start-grade="' + t + '" data-essay-id="' + esc(essayId) + '">Bắt đầu chấm</button>' +
      '</div>';
    }
    return '<div style="display:flex;align-items:center;gap:8px;margin:8px 0">' +
      '<span style="font-weight:700;color:var(--av-text-primary)">Task ' + (i + 1) + '</span>' + label +
      '<a class="av-btn" target="_blank" href="/pages/admin/writing/grade.html?essay_id=' + encodeURIComponent(essayId) + '">Chấm Task ' + (i + 1) + ' ↗</a>' +
    '</div>';
  }

  function skillTabHtml(skill, sitting, draft) {
    if (skill === 'writing') {
      var ws = sitting.writing_submission || {};
      return ['task1', 'task2'].map(function (t, i) { return writingTaskHtml(t, i, sitting, ws); }).join('');
    }
    if (skill === 'speaking') {
      var ids = sitting.speaking_session_ids || [];
      if (!ids.length) return '<p class="mr-muted">Chưa có bài Speaking.</p>';
      return '<p class="mr-muted">' + ids.length + ' session:</p>' + ids.map(function (id) {
        return '<div style="margin:4px 0"><a target="_blank" href="/pages/full-test-result.html?session_id=' + encodeURIComponent(id) + '">Nghe & xem transcript ↗</a></div>';
      }).join('');
    }
    // listening / reading — RESULTS view: per-Q answer vs đáp án, tổng đúng/sai,
    // band ước tính, phân tích kỹ năng. NOT the deep chữa-bài (solution/giải
    // thích) — that stays student-only, unlocked after CÔNG BỐ.
    var attemptId = sitting[skill + '_attempt_id'];
    if (!attemptId) return '<p class="mr-muted">Chưa có bài ' + skill + '.</p>';
    var res = current.skillResult && current.skillResult[skill];
    if (!res) return '<p class="mr-muted">Không tải được kết quả ' + skill + '.</p>';
    return resultDetailHtml(skill, res);
  }

  function resultDetailHtml(skill, res) {
    var total = '<div class="mr-total">Kết quả: <b>' +
      (res.score != null ? res.score : '—') + '/' + (res.max_score != null ? res.max_score : '—') +
      '</b> câu đúng · Band ước tính <b>' + fmtBand(res.band_estimate) + '</b></div>';
    var analysis = skill === 'reading'
      ? skillBreakdownHtml(res.skill_breakdown)
      : trapAnalyticsHtml(res.trap_analytics);
    return total + analysis + perQuestionTableHtml(res.review || []);
  }

  function skillBreakdownHtml(sb) {
    if (!sb || !Object.keys(sb).length) return '';
    var pills = Object.keys(sb).map(function (tag) {
      var v = sb[tag] || {};
      return '<span class="mr-pill">' + esc(tag) + ': ' + (v.correct || 0) + '/' + (v.total || 0) + '</span>';
    }).join(' ');
    return '<div class="mr-analysis"><div class="mr-analysis__label">Phân tích kỹ năng</div>' + pills + '</div>';
  }

  function trapAnalyticsHtml(ta) {
    if (!ta || !Object.keys(ta).length) return '';
    var pills = Object.keys(ta).map(function (k) {
      var v = ta[k] || {};
      return '<span class="mr-pill">' + esc(k) + ': bắt ' + (v.caught || 0) + ' · trượt ' + (v.missed || 0) + '</span>';
    }).join(' ');
    return '<div class="mr-analysis"><div class="mr-analysis__label">Phân tích bẫy nghe</div>' + pills + '</div>';
  }

  function perQuestionTableHtml(review) {
    if (!review.length) return '';
    var body = review.map(function (q) {
      var ok = !!q.correct;
      return '<tr>' +
        '<td>' + (q.q_num != null ? q.q_num : '') + '</td>' +
        '<td>' + esc(q.user_answer || '—') + '</td>' +
        '<td>' + esc(q.expected || '—') + '</td>' +
        '<td class="mr-perq__mark ' + (ok ? 'is-ok' : 'is-bad') + '">' + (ok ? '✓' : '✗') + '</td>' +
        '</tr>';
    }).join('');
    return '<div class="adm-table-wrap" style="margin-top:10px"><table class="adm-table mr-perq">' +
      '<thead><tr><th>Câu</th><th>Trả lời</th><th>Đáp án</th><th>KQ</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></div>';
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

    var rf = review.retest_flags || {};
    var bandInputs = reqSkills().map(function (s) {
      return '<div><label>' + s + '</label>' +
        '<input type="number" step="0.5" min="0" max="9" data-band="' + s + '" value="' + (fb[s] != null ? fb[s] : '') + '">' +
        '<label style="display:flex;align-items:center;gap:4px;font-size:11px;font-weight:400;margin-top:4px;color:var(--av-text-secondary)">' +
          '<input type="checkbox" data-retest="' + s + '"' + (rf[s] ? ' checked' : '') + '> Cần test lại' +
        '</label></div>';
    }).join('');

    v.innerHTML =
      '<button class="av-btn" id="back-btn">← Hàng đợi</button>' +
      '<div style="display:flex;align-items:center;gap:10px;margin:12px 0">' +
        '<span class="mr-pill">' + esc(review.status) + '</span>' +
        '<span style="font-weight:700;color:var(--av-text-primary)">' + esc(sitting.student_name || '—') + '</span>' +
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
          ((review.status === 'reviewed' || review.status === 'released')
            ? '<a class="av-btn" target="_blank" href="/pages/admin/mock-reviews/report.html?review_id=' + encodeURIComponent(review.id) + '">Xem phiếu báo điểm ↗</a>'
            : '') +
        '</div>' +
        '<p class="mr-muted" style="margin-top:8px">Công bố yêu cầu đã “Lưu band” (trạng thái reviewed) và mở khoá điểm cho học viên. Phiếu báo điểm chỉ tạo được khi không còn kỹ năng nào bị đánh dấu "cần test lại".</p>' +
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

    el('back-btn').addEventListener('click', loadRoster);
    var claimBtn = el('claim-btn');
    if (claimBtn) claimBtn.addEventListener('click', function () { doClaim(review.id); });
    el('save-btn').addEventListener('click', function () { doSave(review.id, v); });
    el('release-btn').addEventListener('click', function () { doRelease(review.id); });
    v.querySelectorAll('[data-start-grade]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var t = btn.getAttribute('data-start-grade');
        var essayId = btn.getAttribute('data-essay-id');
        var tier = v.querySelector('[data-tier-for="' + t + '"]').value;
        doStartGrading(essayId, tier, review.id);
      });
    });
  }

  async function doStartGrading(essayId, tier, reviewId) {
    try {
      await window.api.post('/admin/writing/essays/' + encodeURIComponent(essayId) + '/start-grading', {
        grading_tier: tier,
      });
      toast('Đã đưa vào hàng chấm (' + tier + ').');
      openDetail(reviewId);
    } catch (e) { toast('Không đưa vào hàng chấm được: ' + (e && e.message)); }
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

  function collectRetestFlags(v) {
    var rf = {};
    reqSkills().forEach(function (s) {
      var box = v.querySelector('[data-retest="' + s + '"]');
      rf[s] = !!(box && box.checked);
    });
    return rf;
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
        retest_flags: collectRetestFlags(v),
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
      loadRoster();
      loadRetestSummary();
    } catch (e) { toast('Công bố thất bại: ' + (e && e.message)); }
  }

  async function loadExamHeader() {
    try {
      var res = await window.api.get('/admin/mock-exams');
      var exams = (res && res.exams) || [];
      var ex = exams.filter(function (e) { return e.id === examId; })[0];
      el('exam-header').textContent = ex ? (ex.code + ' — ' + (ex.title || '')) : 'Đề ' + examId;
    } catch (e) { el('exam-header').textContent = 'Đề ' + examId; }
  }

  var SKILL_VI = { listening: 'Listening', reading: 'Reading', writing: 'Writing', speaking: 'Speaking' };

  async function loadRetestSummary() {
    var host = el('retest-summary');
    try {
      var s = await window.api.get('/admin/mock-exams/' + encodeURIComponent(examId) + '/retest-summary');
      if (!s.reviewed_sittings) {
        host.innerHTML = '<span class="mr-muted">Tổng kết lớp: chưa có bài nào được duyệt.</span>';
        return;
      }
      var pills = Object.keys(s.per_skill).filter(function (k) { return s.per_skill[k] > 0; })
        .map(function (k) { return '<span class="mr-pill">' + esc(SKILL_VI[k] || k) + ': ' + s.per_skill[k] + '</span>'; })
        .join(' ');
      var roster = s.students.map(function (st) {
        return '<div class="mr-muted" style="margin-top:4px">' + esc(st.student_name) + ' — cần test lại: ' +
          st.skills.map(function (k) { return SKILL_VI[k] || k; }).join(', ') + '</div>';
      }).join('');
      host.innerHTML =
        '<b style="color:var(--av-text-primary)">Tổng kết lớp</b> ' +
        '<span class="mr-muted">(' + s.reviewed_sittings + '/' + s.total_sittings + ' đã duyệt)</span><br>' +
        (s.needs_retest_count
          ? '<div style="margin-top:6px">' + pills + '</div>' + roster
          : '<span class="mr-muted">Không có học viên nào cần test lại.</span>');
    } catch (e) { host.innerHTML = ''; }
  }

  async function boot() {
    var sb = window.getSupabase && window.getSupabase();
    if (sb) { var s = await sb.auth.getSession(); if (!s.data.session) { location.href = '/index.html'; return; } }
    if (!examId) {
      el('no-exam-view').classList.remove('hidden');
      el('queue-view').classList.add('hidden');
      return;
    }
    var rb = el('refresh-btn'); if (rb) rb.addEventListener('click', function () { loadRoster(); loadRetestSummary(); });
    loadRetestSummary();
    loadExamHeader();
    loadRoster();
  }
  boot();
})();
