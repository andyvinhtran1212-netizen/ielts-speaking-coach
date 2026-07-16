/*
 * admin-mock-report.js — phiếu báo điểm (score report), 2026-07-12.
 *
 * Only reachable for a sitting whose review has ZERO retest_flags set — the
 * gate is enforced client-side here (the data itself, final_bands +
 * retest_flags + required_skills, already comes from the admin-only
 * GET /admin/mock-reviews/{id} endpoint, same as the review console).
 *
 * Overall is shown ONLY when speaking is among the sitting's required
 * skills (an LRW-only exam reports per-skill bands with no combined figure —
 * mirrors mock_review_workflow.compute_overall's same skill-set rule).
 */
(function () {
  'use strict';
  initSupabase('https://huwsmtubwulikhlmcirx.supabase.co', 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao');

  var SKILL_VI = { listening: 'Listening', reading: 'Reading', writing: 'Writing', speaking: 'Speaking' };

  function el(id) { return document.getElementById(id); }
  function esc(s) { return (window.WC && window.WC.escapeHtml) ? window.WC.escapeHtml(s) : String(s == null ? '' : s); }
  function showState(name) {
    el('state-loading').classList.toggle('hidden', name !== 'loading');
    el('state-blocked').classList.toggle('hidden', name !== 'blocked');
    el('state-report').classList.toggle('hidden', name !== 'report');
  }
  function reviewIdFromUrl() {
    return (new URLSearchParams(location.search).get('review_id') || '').trim() || null;
  }

  // ── Back target ──────────────────────────────────────────────────
  // The queue REFUSES to load without ?mock_exam_id= (it shows a "chọn đề"
  // prompt instead), so a bare link to index.html would not return the admin to
  // the exam they came from. The opener stamps the id; replay it here. Only ever
  // used as a query VALUE on a fixed path — never as the path itself.
  function wireBack() {
    var examId = (new URLSearchParams(location.search).get('mock_exam_id') || '').trim();
    var el2 = el('rp-back');
    if (el2 && examId) el2.href = '/pages/admin/mock-reviews/index.html?mock_exam_id=' + encodeURIComponent(examId);
  }

  function render(data) {
    var review = data.review, sitting = data.sitting || {};
    var skills = data.required_skills || [];
    var fb = review.final_bands || {};

    el('rp-title').textContent = 'Phiếu báo điểm — ' + (sitting.student_name || '—');
    el('rp-sub').textContent = 'Kết quả các kỹ năng đã thi';

    el('rp-skills').innerHTML = skills.map(function (s) {
      return '<div class="rp-skill"><div class="rp-skill__label">' + esc(SKILL_VI[s] || s) + '</div>' +
        '<div class="rp-skill__band">' + (fb[s] != null ? Number(fb[s]).toFixed(1) : '—') + '</div></div>';
    }).join('');

    el('rp-overall-wrap').innerHTML = skills.indexOf('speaking') !== -1
      ? '<div class="rp-overall"><div class="rp-overall__label">Overall</div>' +
        '<div class="rp-overall__band">' + (fb.overall != null ? Number(fb.overall).toFixed(1) : '—') + '</div></div>'
      : '';

    el('rp-comment').textContent = review.examiner_comment_vi || '';
    showState('report');
  }

  async function boot() {
    wireBack();                 // before any early return — the blocked state is
                                // exactly when a working way out matters most
    var sb = window.getSupabase && window.getSupabase();
    if (sb) { var s = await sb.auth.getSession(); if (!s.data.session) { location.href = '/index.html'; return; } }
    var id = reviewIdFromUrl();
    if (!id) { showState('blocked'); el('state-blocked').textContent = 'Thiếu review_id.'; return; }
    try {
      var data = await window.api.get('/admin/mock-reviews/' + encodeURIComponent(id));
      var flags = (data.review && data.review.retest_flags) || {};
      var needsRetest = Object.keys(flags).some(function (k) { return flags[k]; });
      if (needsRetest) {
        showState('blocked');
        el('state-blocked').textContent = 'Học viên còn kỹ năng cần test lại — chưa thể tạo phiếu báo điểm.';
        return;
      }
      if (data.review.status !== 'reviewed' && data.review.status !== 'released') {
        showState('blocked');
        el('state-blocked').textContent = 'Chưa nhập band cuối — chưa thể tạo phiếu báo điểm.';
        return;
      }
      render(data);
    } catch (e) {
      showState('blocked');
      el('state-blocked').textContent = 'Không tải được: ' + (e && e.message);
    }
  }
  boot();
})();
