/**
 * frontend/js/admin-instructors.js — W-8-core admin oversight.
 *
 * Lists per-instructor metrics from GET /admin/instructors (admin-only direct
 * aggregate). "Xem như GV" drills into the instructor area via the single audited
 * impersonation override (?as_instructor=X) — no separate unscoped read endpoint.
 */

const api = window.api;
const $ = (id) => document.getElementById(id);
const esc = (window.WC && window.WC.escapeHtml)
  ? window.WC.escapeHtml
  : (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function boot() {
  const body = $('ai-body');
  let rows;
  try {
    rows = (await api.get('/admin/instructors')) || [];
  } catch (e) {
    if (e.status === 403) { window.location.href = '/pages/home.html'; return; }
    $('ai-banner').innerHTML = `<div class="ai-banner ai-banner--err">Lỗi tải: ${esc(e.message)}</div>`;
    body.innerHTML = '';
    return;
  }
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7" class="ai-muted">Chưa có giảng viên.</td></tr>';
    return;
  }
  body.innerHTML = rows.map((r) => {
    const name = r.display_name || r.email || r.instructor_id;
    const drill = '/pages/instructor/index.html?as_instructor=' + encodeURIComponent(r.instructor_id);
    return `<tr>
      <td>${esc(name)}</td>
      <td class="ai-num">${esc(r.students)}</td>
      <td class="ai-num">${esc(r.graded)}</td>
      <td class="ai-num">${esc(r.regraded)}</td>
      <td class="ai-num">${esc(r.tokens)}</td>
      <td class="ai-num">${esc(r.cost_usd)}</td>
      <td><a class="ai-link" href="${drill}">Xem như GV →</a></td>
    </tr>`;
  }).join('');
}

boot();
