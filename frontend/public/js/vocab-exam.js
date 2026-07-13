// js/vocab-exam.js — Exam-prep vocabulary browse (AWL / TOEIC / THPT).
//
// The exam-prep area is kept SEPARATE from the self-curated topic vocab: those
// imported exam words (cards with a non-empty `lists`) are excluded from the
// topic browse / flashcards / counts and surfaced here instead.
//
// Data: GET /api/vocabulary/exam → [{ family, title, lists:[{slug,title,
//   description,exam_source,count}] }] (families ordered awl→toeic→thpt).
// Each non-empty list links to the shared flashcard player:
//   flashcard-study.html?stack=examlist:<list-slug>
//
// No auth / no server SRS — same public model as the wiki topic stacks.

(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Family → emoji badge (purely decorative; families come from the API).
  var FAMILY_ICON = { awl: '🎓', toeic: '💼', thpt: '🏫' };

  function listCard(l) {
    var href = '/pages/flashcard-study.html?stack=examlist:' + encodeURIComponent(l.slug);
    return '<a class="mode-card" href="' + href + '">'
      + '<div class="head"><div class="icon">🗂️</div><span class="arrow">→</span></div>'
      + '<h3>' + esc(l.title || l.slug) + '</h3>'
      + '<p class="lede vx-meta">'
      + '<span class="vx-count">' + (l.count || 0) + ' từ</span>'
      + (l.description ? ' · ' + esc(l.description) : '')
      + '</p>'
      + '</a>';
  }

  // Render families → their non-empty lists. Families with no non-empty list are
  // dropped so a target set that hasn't been imported yet doesn't show as noise.
  function renderFamilies(families) {
    var html = '';
    (families || []).forEach(function (f) {
      var lists = (f.lists || []).filter(function (l) { return (l.count || 0) > 0; });
      if (!lists.length) return;
      var icon = FAMILY_ICON[f.family] || '📚';
      html += '<section class="vx-family">'
        + '<h2 class="vx-family-title">' + icon + ' ' + esc(f.title || f.family) + '</h2>'
        + '<div class="modes-grid">' + lists.map(listCard).join('') + '</div>'
        + '</section>';
    });
    return html;
  }

  async function boot() {
    var loading = $('vx-loading');
    var list = $('vx-list');
    var empty = $('vx-empty');
    var error = $('vx-error');

    var families;
    try {
      families = await window.api.get('/api/vocabulary/exam');
    } catch (e) {
      if (loading) loading.classList.add('hidden');
      if (error) { error.textContent = 'Không tải được danh sách luyện thi: ' + e.message; error.classList.remove('hidden'); }
      return;
    }
    if (loading) loading.classList.add('hidden');

    var html = renderFamilies(families);
    if (!html) { if (empty) empty.classList.remove('hidden'); return; }
    if (list) { list.innerHTML = html; list.classList.remove('hidden'); }
  }

  // Browser boot; Node tests import renderFamilies via the module.exports guard.
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { renderFamilies, listCard };
  }
})();
