/*
 * admin-mock-tests.js — the consolidated Mock Test cockpit.
 *
 * One admin page for the whole 4-skill mock lifecycle: an exam rail (filter by
 * stage, select to scope the review tab) + three tabs that host the existing
 * design-system surfaces embedded (?embed=1 hides their chrome):
 *   - Quản lý đề  → mock-exams (create / configure / advance)
 *   - Duyệt bài thi → mock-reviews scoped to the selected exam
 *   - Chấm Writing → the writing queue's Mock lane
 * Each tab will be ported to native cockpit content in a later pass.
 */
(function () {
  'use strict';
  // Init the Supabase client so window.api carries the admin Bearer token — the
  // rail's GET /admin/mock-exams is require_admin-gated and 401s without it.
  // (The embedded iframes init their own auth; the parent cockpit needs its own.)
  if (window.initSupabase) {
    initSupabase('https://huwsmtubwulikhlmcirx.supabase.co',
                 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao');
  }
  var $ = function (id) { return document.getElementById(id); };
  var api = window.api;

  var state = { exams: [], stage: 'all', selectedId: null, tab: 'manage' };

  // Frame source per tab. `review` needs a selected exam; the others don't.
  var FRAME = {
    manage:  function () { return '/pages/admin/mock-exams/index.html?embed=1'; },
    review:  function (id) { return id ? '/pages/admin/mock-reviews/index.html?mock_exam_id=' + encodeURIComponent(id) + '&embed=1' : null; },
    writing: function () { return '/pages/admin/writing/queue.html?embed=1&mocklane=1'; },
  };

  function stageOf(ex) {
    if (!ex || ex.status !== 'published') return 'draft';
    return ex.is_open ? 'live' : 'closed';
  }
  var STAGE_LABEL = { draft: 'Nháp', live: 'Đang thi', closed: 'Đã đóng' };

  function esc(s) {
    return (window.WC && window.WC.escapeHtml) ? window.WC.escapeHtml(s)
      : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
          return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
        });
  }

  function renderRail() {
    var list = $('mt-list');
    var shown = state.exams.filter(function (ex) {
      return state.stage === 'all' || stageOf(ex) === state.stage;
    });
    $('mt-count').textContent = shown.length + '/' + state.exams.length;
    if (!state.exams.length) { $('mt-empty').classList.remove('hidden'); list.classList.add('hidden'); return; }
    $('mt-empty').classList.add('hidden');
    list.classList.remove('hidden');
    list.innerHTML = shown.map(function (ex) {
      var st = stageOf(ex);
      return '<li><button type="button" class="mt-exam' + (ex.id === state.selectedId ? ' is-active' : '')
        + '" data-id="' + esc(ex.id) + '">'
        + '<span class="mt-exam__code">' + esc(ex.code || '') + '</span>'
        + '<div class="mt-exam__title">' + esc(ex.title || '') + '</div>'
        + '<div class="mt-exam__meta"><span class="mt-stage mt-stage--' + st + '">' + STAGE_LABEL[st] + '</span></div>'
        + '</button></li>';
    }).join('');
    list.querySelectorAll('[data-id]').forEach(function (b) {
      b.addEventListener('click', function () { selectExam(b.getAttribute('data-id')); });
    });
  }

  function selectExam(id) {
    state.selectedId = id;
    renderRail();
    if (state.tab === 'review') renderFrame();
  }

  function renderFrame() {
    var frame = $('mt-frame'), need = $('mt-need-exam');
    var src = state.tab === 'review' ? FRAME.review(state.selectedId) : FRAME[state.tab]();
    if (!src) { frame.classList.add('hidden'); need.classList.remove('hidden'); return; }
    need.classList.add('hidden');
    frame.classList.remove('hidden');
    if (frame.getAttribute('src') !== src) frame.setAttribute('src', src);
  }

  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.mt-tab').forEach(function (t) {
      t.classList.toggle('is-active', t.getAttribute('data-tab') === tab);
    });
    renderFrame();
  }

  function boot() {
    try {
      var t = new URLSearchParams(location.search).get('tab');
      if (t && FRAME[t]) state.tab = t;
    } catch (e) { /* default tab */ }

    document.querySelectorAll('.mt-tab').forEach(function (t) {
      t.addEventListener('click', function () { setTab(t.getAttribute('data-tab')); });
    });
    document.querySelectorAll('.mt-chip').forEach(function (c) {
      c.addEventListener('click', function () {
        state.stage = c.getAttribute('data-stage');
        document.querySelectorAll('.mt-chip').forEach(function (x) { x.classList.toggle('is-active', x === c); });
        renderRail();
      });
    });
    setTab(state.tab);

    api.get('/admin/mock-exams').then(function (res) {
      state.exams = (res && res.exams) || (Array.isArray(res) ? res : []);
      $('mt-loading').classList.add('hidden');
      if (state.exams.length && !state.selectedId) state.selectedId = state.exams[0].id;
      renderRail();
      renderFrame();   // review tab can now target the auto-selected exam
    }).catch(function (e) {
      $('mt-loading').textContent = 'Không tải được danh sách đề: ' + (e && e.message || 'lỗi');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
