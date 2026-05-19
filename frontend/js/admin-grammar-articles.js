/**
 * frontend/js/admin-grammar-articles.js — Sprint 12.7.
 *
 * Read-only browser for Grammar Wiki articles. Per Andy lock 2(c) —
 * hybrid file-based pattern — articles are authored as `.md` files in
 * `backend/content/<category>/<slug>.md`. Admin previews the rendered
 * output + sees view/save counts; edits happen in repo + git.
 *
 * Wired endpoints (new in Sprint 12.7):
 *   GET /admin/grammar/articles?category=&search=
 *   GET /admin/grammar/articles/{slug}/preview
 */

const SUPABASE_URL = 'https://nqhrtqspznepmveyurzm.supabase.co';
const SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

const api = window.api;
const $ = (id) => document.getElementById(id);

let _rows = [];
let _expandedSlug = null;
let _previewCache = new Map();

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function loadList() {
  $('gra-loading').hidden = false;
  $('gra-empty').hidden = true;
  $('gra-table-wrap').hidden = true;
  try {
    const params = new URLSearchParams();
    const cat = $('gra-category').value;
    const search = ($('gra-search').value || '').trim();
    if (cat) params.set('category', cat);
    if (search) params.set('search', search);
    const res = await api.get('/admin/grammar/articles' + (params.toString() ? '?' + params : ''));
    _rows = res.items || [];
    populateCategoryDropdown(res.categories || []);
    renderTable();
    $('gra-empty').hidden = _rows.length !== 0;
    $('gra-table-wrap').hidden = _rows.length === 0;
  } catch (e) {
    $('gra-empty').textContent = 'Không tải được danh sách: ' + (e && e.message || 'lỗi');
    $('gra-empty').hidden = false;
  } finally {
    $('gra-loading').hidden = true;
  }
}

function populateCategoryDropdown(categories) {
  const sel = $('gra-category');
  // Preserve current selection
  const current = sel.value;
  // Only repopulate when the option list differs (avoid blowing away the selection on every call).
  const existing = Array.from(sel.options).map((o) => o.value);
  const wanted = [''].concat(categories);
  if (existing.length === wanted.length && existing.every((v, i) => v === wanted[i])) return;
  sel.innerHTML = '<option value="">Tất cả</option>' +
    categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  sel.value = current;
}

function renderTable() {
  const tbody = $('gra-tbody');
  tbody.innerHTML = _rows.map(rowHtml).join('');
  tbody.querySelectorAll('tr.gra-row').forEach((tr) => {
    tr.addEventListener('click', () => togglePreview(tr.getAttribute('data-slug')));
  });
}

function rowHtml(r) {
  const expanded = _expandedSlug === r.slug;
  const base = `
    <tr class="gra-row${expanded ? ' is-expanded' : ''}" data-slug="${escapeHtml(r.slug)}">
      <td>${escapeHtml(r.title || '—')}</td>
      <td><code>${escapeHtml(r.slug)}</code></td>
      <td><span class="gra-chip">${escapeHtml(r.category || '—')}</span></td>
      <td>${escapeHtml(String(r.band || '—'))}</td>
      <td class="gra-num">${r.view_count || 0}</td>
      <td class="gra-num">${r.save_count || 0}</td>
      <td style="font-size: var(--av-fs-xs); color: var(--av-text-muted); font-family: var(--av-font-mono);">${escapeHtml(r.source_path || '')}</td>
    </tr>
  `;
  if (!expanded) return base;
  const cached = _previewCache.get(r.slug);
  return base + `
    <tr class="gra-preview-row" data-preview-for="${escapeHtml(r.slug)}">
      <td colspan="7">
        <div class="gra-preview-frame" id="preview-${escapeHtml(r.slug)}">
          ${cached ? cached : '<div class="gra-loading">Đang tải preview…</div>'}
        </div>
        <div class="gra-preview-actions">
          <a class="btn-secondary" href="/pages/grammar-article.html?slug=${encodeURIComponent(r.slug)}" target="_blank" rel="noopener">
            Mở trên student view ↗
          </a>
        </div>
      </td>
    </tr>
  `;
}

async function togglePreview(slug) {
  if (_expandedSlug === slug) {
    _expandedSlug = null;
    renderTable();
    return;
  }
  _expandedSlug = slug;
  renderTable();
  if (_previewCache.has(slug)) return;
  try {
    const res = await api.get('/admin/grammar/articles/' + encodeURIComponent(slug) + '/preview');
    const html = res && res.html ? res.html : '<em>Preview trống.</em>';
    _previewCache.set(slug, html);
    const frame = $('preview-' + slug);
    if (frame) frame.innerHTML = html;
  } catch (e) {
    const frame = $('preview-' + slug);
    if (frame) frame.innerHTML = '<em style="color: #991B1B;">Không tải được preview: ' + escapeHtml(e && e.message || 'lỗi') + '</em>';
  }
}

function wire() {
  $('btn-search').addEventListener('click', () => loadList());
  $('btn-reset').addEventListener('click', () => {
    $('gra-category').value = '';
    $('gra-search').value = '';
    _expandedSlug = null;
    loadList();
  });
  $('gra-search').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') loadList(); });
  $('gra-category').addEventListener('change', () => loadList());
  loadList();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wire);
} else {
  wire();
}
