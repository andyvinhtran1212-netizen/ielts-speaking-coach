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

  // Where the frame ACTUALLY is — which is not what its src attribute says. The
  // embedded queue navigates itself (row click → grade.html) and the attribute
  // stays behind on queue.html. Comparing the attribute therefore made "click
  // the tab you are already on" a no-op, stranding the teacher on the grade page
  // with no way back to the list. None of the embedded pages rewrite their URL
  // (no pushState/replaceState), so the live location is a faithful comparison.
  function frameAt(frame) {
    try {
      var l = frame.contentWindow.location;
      if (l.protocol === 'about:') return frame.getAttribute('src');   // still blank/loading
      return l.pathname + l.search;
    } catch (e) {
      return frame.getAttribute('src');   // cross-origin — not expected, stay safe
    }
  }

  // Drive the frame's own location: re-assigning an unchanged src attribute is
  // not a dependable renavigation. replace() also keeps the tab rail out of the
  // browser's history (tabs are not pages).
  function loadFrame(frame, src) {
    if (frame.getAttribute('src') && frame.contentWindow) {
      try { frame.contentWindow.location.replace(src); return; } catch (e) { /* first load */ }
    }
    frame.setAttribute('src', src);
  }

  function renderFrame() {
    var frame = $('mt-frame'), need = $('mt-need-exam');
    var src = state.tab === 'review' ? FRAME.review(state.selectedId) : FRAME[state.tab]();
    if (!src) { frame.classList.add('hidden'); need.classList.remove('hidden'); return; }
    need.classList.add('hidden');
    frame.classList.remove('hidden');
    if (frameAt(frame) !== src) loadFrame(frame, src);
  }

  // The embedded page resolves the theme ONCE, in its own anti-flash IIFE, and
  // applyTheme only touches the document it runs in — it emits no event and the
  // iframe is a separate document. So toggling the cockpit left the panel on the
  // old theme (a dark review tab under a light page). Mirror the attribute across
  // on every change; same-origin, so this is a plain attribute write.
  function syncFrameTheme() {
    var frame = $('mt-frame');
    try {
      var doc = frame && frame.contentDocument;
      if (!doc) return;
      doc.documentElement.setAttribute(
        'data-theme', document.documentElement.getAttribute('data-theme') || 'light');
    } catch (e) { /* cross-origin can't happen for our own pages */ }
  }

  // …but the mirroring only holds while the cockpit KNOWS the current theme, and
  // one embedded page can change it behind the cockpit's back: the writing grade
  // page carries its own .av-theme-toggle, which sets its own data-theme and
  // writes localStorage without telling the parent. The cockpit's attribute then
  // went stale, and the next frame navigation had syncFrameTheme() write that
  // stale value over the theme the user had just picked — flipping it back until
  // the parent was reloaded or toggled (Codex P2, PR #785).
  //
  // localStorage is what both sides already agree on, and `storage` fires on every
  // same-origin document EXCEPT the one that wrote — measured: the cockpit does
  // receive the frame's write. So the child's toggle becomes the cockpit's toggle,
  // and the MutationObserver above then mirrors it back to the frame as a no-op.
  // (It also follows a theme change made in another tab, which is the same
  // preference the anti-flash IIFE would have read on a fresh load anyway.)
  function adoptStoredTheme(e) {
    if (e && e.key !== 'av-theme') return;    // storage fires for every key
    var t;
    try { t = localStorage.getItem('av-theme'); } catch (err) { return; }
    if (t !== 'light' && t !== 'dark') return;
    if (document.documentElement.getAttribute('data-theme') !== t) {
      document.documentElement.setAttribute('data-theme', t);   // → observer → frame
    }
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

    // Follow the toggle, and re-apply after every navigation: a fresh frame
    // document re-runs its own IIFE, which is right today (it reads the same
    // localStorage) but would drift the moment the two disagree.
    new MutationObserver(syncFrameTheme).observe(document.documentElement, {
      attributes: true, attributeFilter: ['data-theme'],
    });
    // Adopt an embedded page's own toggle BEFORE the frame's load handler can
    // mirror a stale attribute back over it.
    window.addEventListener('storage', adoptStoredTheme);
    var frame = $('mt-frame');
    if (frame) frame.addEventListener('load', syncFrameTheme);

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
