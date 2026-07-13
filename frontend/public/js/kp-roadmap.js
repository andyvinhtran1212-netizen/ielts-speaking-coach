/* kp-roadmap.js — personal Knowledge-Point roadmap (Phase 2 frontend).
 *
 * Renders GET /api/me/roadmap into the grammar-roadmap page shell when the page
 * is opened WITHOUT a ?slug= (the per-article roadmap still owns the slug case,
 * in grammar.js). The backend returns:
 *   { mode: 'personal', weak_count, nodes:[{slug,category,title,status,is_weak}] }
 *     — the learner's weak KPs + their not-yet-strong prerequisites, prereq-first.
 *   { mode: 'static' } — no evidence yet → show an empty-state CTA.
 *
 * All colours/spacing come from --av-* tokens, so it theme-flips automatically.
 */
(function () {
  'use strict';

  function esc(s) {
    if (window.WC && typeof window.WC.escapeHtml === 'function') return window.WC.escapeHtml(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function _el(id) { return document.getElementById(id); }
  function _show(id) { var e = _el(id); if (e) e.classList.remove('hidden'); }
  function _hide(id) { var e = _el(id); if (e) e.classList.add('hidden'); }

  // status → { label, colour token, soft-bg token }. 'unseen' = no evidence row.
  var STATUS = {
    weak:     { label: 'Điểm yếu', color: 'var(--av-error)',      soft: 'var(--av-error-soft)' },
    learning: { label: 'Đang học', color: 'var(--av-warning)',    soft: 'var(--av-warning-soft)' },
    unseen:   { label: 'Chưa học', color: 'var(--av-text-muted)', soft: 'var(--av-surface-sunken)' },
    strong:   { label: 'Đã vững',  color: 'var(--av-success)',    soft: 'var(--av-success-soft)' },
  };

  function nodeHtml(n) {
    var st = STATUS[n.status] || STATUS.unseen;
    var url = '/grammar/' + encodeURIComponent(n.category || '') + '/' + encodeURIComponent(n.slug || '');
    var tag = n.is_weak ? 'Điểm yếu cần luyện' : 'Nền tảng cần củng cố trước';
    return '' +
      '<a href="' + esc(url) + '" class="kp-node" style="' +
        'display:flex;align-items:center;gap:var(--av-space-4);' +
        'padding:var(--av-space-4);margin-bottom:var(--av-space-3);' +
        'border:1px solid var(--av-border-default);border-left:3px solid ' + st.color + ';' +
        'border-radius:var(--av-radius-lg);background:var(--av-surface-card);' +
        'text-decoration:none;transition:border-color .15s;">' +
        '<span aria-hidden="true" style="flex:none;width:10px;height:10px;border-radius:999px;background:' + st.color + ';"></span>' +
        '<span style="flex:1;min-width:0;">' +
          '<span style="display:block;font-weight:600;color:var(--av-text-primary);">' + esc(n.title || n.slug) + '</span>' +
          '<span style="display:block;font-size:var(--av-fs-xs);color:var(--av-text-muted);margin-top:2px;">' + esc(tag) + '</span>' +
        '</span>' +
        '<span style="flex:none;font-size:var(--av-fs-xs);font-weight:600;padding:2px 10px;' +
          'border-radius:999px;color:' + st.color + ';background:' + st.soft + ';">' + esc(st.label) + '</span>' +
      '</a>';
  }

  function renderPersonal(data) {
    var nodes = data.nodes || [];
    var titleEl = _el('roadmap-title');
    var subEl = _el('roadmap-subtitle');
    if (titleEl) titleEl.textContent = 'Lộ trình của bạn';
    if (subEl) {
      subEl.textContent = nodes.length
        ? (data.weak_count || 0) + ' điểm cần luyện — củng cố nền tảng trước, rồi tới điểm yếu.'
        : '';
    }
    var steps = _el('roadmap-steps');
    if (steps) steps.innerHTML = nodes.map(nodeHtml).join('');
    var cta = _el('roadmap-cat-link');
    if (cta) { cta.textContent = 'Xem toàn bộ Grammar Wiki →'; cta.setAttribute('href', '/grammar.html'); }
  }

  function renderEmpty() {
    var titleEl = _el('roadmap-title');
    var subEl = _el('roadmap-subtitle');
    if (titleEl) titleEl.textContent = 'Lộ trình của bạn';
    if (subEl) subEl.textContent = '';
    var steps = _el('roadmap-steps');
    if (steps) {
      steps.innerHTML = '' +
        '<div style="padding:var(--av-space-8);text-align:center;border:1px dashed var(--av-border-default);' +
          'border-radius:var(--av-radius-lg);background:var(--av-surface-card);">' +
          '<p style="color:var(--av-text-primary);font-weight:600;margin-bottom:var(--av-space-2);">Chưa có lộ trình cá nhân</p>' +
          '<p style="color:var(--av-text-muted);font-size:var(--av-fs-sm);margin-bottom:var(--av-space-6);">' +
            'Làm bài luyện tập để hệ thống phát hiện điểm ngữ pháp cần củng cố — lộ trình sẽ tự dựng theo điểm yếu của bạn.' +
          '</p>' +
          '<a href="/pages/speaking.html" class="btn-primary">Bắt đầu luyện tập</a>' +
        '</div>';
    }
    var cta = _el('roadmap-cat-link');
    if (cta) { cta.textContent = 'Xem toàn bộ Grammar Wiki →'; cta.setAttribute('href', '/grammar.html'); }
  }

  function renderError() {
    var titleEl = _el('roadmap-title');
    var subEl = _el('roadmap-subtitle');
    if (titleEl) titleEl.textContent = 'Lộ trình của bạn';
    if (subEl) subEl.textContent = '';
    var steps = _el('roadmap-steps');
    if (steps) {
      steps.innerHTML = '' +
        '<div style="padding:var(--av-space-8);text-align:center;border:1px solid var(--av-border-default);' +
          'border-radius:var(--av-radius-lg);background:var(--av-surface-card);">' +
          '<p style="color:var(--av-error);font-weight:600;margin-bottom:var(--av-space-2);">Không tải được lộ trình</p>' +
          '<p style="color:var(--av-text-muted);font-size:var(--av-fs-sm);margin-bottom:var(--av-space-6);">' +
            'Đã có lỗi khi tải lộ trình của bạn. Vui lòng thử lại sau ít phút.</p>' +
          '<button type="button" onclick="location.reload()" class="btn-primary">Thử lại</button>' +
        '</div>';
    }
  }

  async function loadPersonalRoadmap() {
    try {
      var data = await window.api.get('/api/me/roadmap');
      if (data == null) return;   // 401 → api.js already redirected to /login
      if (data.mode === 'personal' && (data.nodes || []).length) renderPersonal(data);
      else if (data.mode === 'static' || data.mode === 'personal') renderEmpty();
      else renderError();   // unexpected shape → treat as failure, not "no data"
    } catch (err) {
      // A real API/schema failure must NOT masquerade as an empty roadmap — a
      // learner with real weak KPs would otherwise be told there's nothing.
      renderError();
    } finally {
      _hide('roadmap-skeleton');
      _show('roadmap-container');
    }
  }

  window.kpRoadmap = { loadPersonalRoadmap: loadPersonalRoadmap, _nodeHtml: nodeHtml };
})();
