/**
 * frontend/js/admin-speaking-sessions.js — Sprint 12.5.
 *
 * Carved from `admin.html` panel-sessions (lines 396-470 markup +
 * 2514-2940 JS) into the new IA at /pages/admin/speaking/sessions.html.
 *
 * Wired backend endpoints (unchanged from monolith):
 *   GET  /admin/users                  — email→user_id resolution for filter
 *   GET  /admin/sessions?...           — paginated list with filters
 *   GET  /admin/sessions/{id}          — detail with questions + responses
 *   POST /admin/responses/{id}/regrade — regrade single response
 *   POST /admin/sessions/{id}/regrade  — regrade entire session
 *   POST /admin/sessions/{id}/rebuild-summary[?p2_id=&p3_id=] — band rebuild
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

const PAGE_LIMIT = 50;
let _offset = 0;
let _rows = [];
let _lastPage = [];

const ERR_LABELS = {
  stt_failed:     'STT Failed',
  grading_failed: 'Grading Failed',
  save_failed:    'Save Failed',
  pdf_failed:     'PDF Failed',
};

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('vi-VN', {
      hour: '2-digit', minute: '2-digit',
      day: '2-digit', month: '2-digit', year: '2-digit',
    });
  } catch { return iso; }
}

function bandClass(band) {
  if (band == null) return '';
  return band >= 7 ? 'is-good' : band >= 5.5 ? 'is-mid' : 'is-low';
}

function bandBadge(band) {
  if (band == null) return '<span class="ses-band">—</span>';
  return `<span class="ses-band ${bandClass(band)}">${escapeHtml(band)}</span>`;
}

function errorLabel(code) {
  if (!code) return '<span style="color:var(--av-text-muted)">—</span>';
  const lbl = ERR_LABELS[code] || code;
  return `<span class="ses-chip" style="color:#991B1B;border-color:#FECACA">${escapeHtml(lbl)}</span>`;
}

function showBanner(msg, kind) {
  const el = $('status-banner');
  el.textContent = msg;
  el.classList.remove('is-success', 'is-error');
  el.classList.add(kind === 'error' ? 'is-error' : 'is-success');
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 5000);
}


// ── Filter + list ───────────────────────────────────────────────────


function readFilters() {
  return {
    email:     ($('sf-email').value || '').trim(),
    mode:      $('sf-mode').value,
    status:    $('sf-status').value,
    error:     $('sf-error').value,
    date_from: $('sf-date-from').value,
    date_to:   $('sf-date-to').value,
  };
}

function resetFilters() {
  ['sf-email', 'sf-mode', 'sf-status', 'sf-error', 'sf-date-from', 'sf-date-to']
    .forEach((id) => { $(id).value = ''; });
  loadSessions(true);
}

async function resolveUserIdFromEmail(email) {
  // Mirrors monolith's email→user_id resolution. If a UUID is typed in,
  // pass it straight through; otherwise look up matching users.
  if (/^[0-9a-f-]{36}$/i.test(email)) return { user_id: email };
  try {
    const users = await api.get('/admin/users');
    const needle = email.toLowerCase();
    const all = (users || []).filter((u) => (u.email || '').toLowerCase().includes(needle));
    const exact = all.filter((u) => (u.email || '').toLowerCase() === needle);
    if (exact.length === 1) return { user_id: exact[0].id };
    if (all.length === 1) return { user_id: all[0].id };
    if (all.length > 1) {
      return { error: 'Nhiều user khớp email này. Nhập email đầy đủ hơn hoặc dùng User ID.' };
    }
    return { error: 'Không tìm thấy user nào khớp email đã nhập.' };
  } catch (e) {
    return { error: 'Không thể tra cứu user: ' + (e.message || e) };
  }
}

async function loadSessions(reset) {
  const loadEl  = $('logs-loading');
  const emptyEl = $('logs-empty');
  const tableEl = $('logs-table-wrap');
  const moreBtn = $('btn-more');

  if (reset) { _offset = 0; _rows = []; _lastPage = []; }
  loadEl.hidden = false;
  emptyEl.hidden = true;
  if (reset) tableEl.hidden = true;
  emptyEl.textContent = 'Không tìm thấy session nào.';

  const f = readFilters();
  const params = new URLSearchParams();
  params.set('limit', String(PAGE_LIMIT));
  params.set('offset', String(_offset));
  if (f.mode)   params.set('mode', f.mode);
  if (f.status) params.set('status', f.status);
  if (f.error === 'has_error') params.set('has_error', 'true');
  else if (f.error) params.set('error_code', f.error);
  if (f.date_from) params.set('date_from', f.date_from);
  if (f.date_to)   params.set('date_to', f.date_to);

  if (f.email) {
    const r = await resolveUserIdFromEmail(f.email);
    if (r.error) {
      loadEl.hidden = true;
      moreBtn.hidden = true;
      tableEl.hidden = true;
      emptyEl.textContent = r.error;
      emptyEl.hidden = false;
      return;
    }
    params.set('user_id', r.user_id);
  }

  try {
    const data = await api.get('/admin/sessions?' + params.toString());
    loadEl.hidden = true;
    if (!data || !data.length) {
      if (reset) emptyEl.hidden = false;
      moreBtn.hidden = true;
      return;
    }
    _lastPage = data;
    if (reset) {
      _rows = data.slice();
    } else {
      const seen = new Set(_rows.map((r) => r.id));
      data.forEach((r) => { if (!seen.has(r.id)) { _rows.push(r); seen.add(r.id); } });
    }
    _offset += data.length;
    moreBtn.hidden = data.length < PAGE_LIMIT;
    renderTable(reset);
  } catch (err) {
    loadEl.hidden = true;
    emptyEl.textContent = 'Lỗi tải sessions: ' + (err.message || err);
    emptyEl.hidden = false;
    moreBtn.hidden = true;
  }
}

function renderTable(reset) {
  const tbody = $('sessions-tbody');
  const tableEl = $('logs-table-wrap');
  const rows = reset ? _rows : _lastPage;
  let html = reset ? '' : tbody.innerHTML;
  rows.forEach((s) => {
    const shortId = s.id ? s.id.slice(0, 8) : '—';
    html += `<tr data-id="${escapeHtml(s.id)}">
      <td><code>${escapeHtml(shortId)}…</code></td>
      <td>${escapeHtml(s.user_email || s.user_id || '—')}</td>
      <td><span class="ses-chip">${escapeHtml(s.mode || '—')}</span></td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(s.topic || '—')}</td>
      <td>${bandBadge(s.overall_band)}</td>
      <td><span class="ses-chip">${escapeHtml(s.status || '—')}</span></td>
      <td>${errorLabel(s.error_code)}</td>
      <td><code style="font-size:11px;color:var(--av-text-muted)">${fmtDate(s.started_at)}</code></td>
      <td><button class="btn-ghost" data-action="view" data-id="${escapeHtml(s.id)}">Xem</button></td>
    </tr>`;
  });
  tbody.innerHTML = html;
  tableEl.hidden = false;
}


// ── Detail modal ────────────────────────────────────────────────────


function openModal() { $('modal-backdrop').hidden = false; }
function closeModal() { $('modal-backdrop').hidden = true; }

async function loadDetail(sessionId) {
  openModal();
  $('detail-loading').hidden = false;
  $('detail-content').hidden = true;
  $('detail-content').innerHTML = '';
  try {
    const s = await api.get('/admin/sessions/' + sessionId);
    renderDetail(s);
  } catch (err) {
    $('detail-loading').hidden = true;
    $('detail-content').innerHTML = `<p style="color:#991B1B">Lỗi: ${escapeHtml(err.message || err)}</p>`;
    $('detail-content').hidden = false;
  }
}

function renderDetail(s) {
  const qs = s.questions || [];
  const rs = s.responses || [];
  const respMap = {};
  rs.forEach((r) => { respMap[r.question_id] = r; });

  let html = '';
  html += `<div class="ses-meta">
    <div><span class="label">Session ID</span><code>${escapeHtml(s.id)}</code></div>
    <div><span class="label">User</span>${escapeHtml(s.user_email || s.user_id || '—')}</div>
    <div><span class="label">Mode / Part</span>${escapeHtml(s.mode || '')} / Part ${escapeHtml(String(s.part || ''))}</div>
    <div><span class="label">Status</span><span class="ses-chip">${escapeHtml(s.status || '—')}</span></div>
    <div><span class="label">Topic</span>${escapeHtml(s.topic || '—')}</div>
    <div><span class="label">Overall Band</span>${bandBadge(s.overall_band)}</div>
  </div>`;

  html += `<div style="display:flex;gap:8px;flex-wrap:wrap;">
    <button class="btn-secondary" data-action="regrade-session" data-id="${escapeHtml(s.id)}">Chấm lại session</button>
    <button class="btn-secondary" data-action="rebuild-summary"  data-id="${escapeHtml(s.id)}">Tổng hợp lại kết quả</button>`;
  if (s.mode === 'test_full') {
    const p2 = escapeHtml(s.p2_session_id || '');
    const p3 = escapeHtml(s.p3_session_id || '');
    html += `<button class="btn-secondary" data-action="rebuild-summary-full"
                     data-id="${escapeHtml(s.id)}" data-p2="${p2}" data-p3="${p3}">Tổng hợp lại full test</button>`;
  }
  html += `</div>`;

  if (s.band_fc != null || s.band_lr != null || s.band_gra != null || s.band_p != null) {
    html += `<div class="ses-bands-grid">
      <div class="ses-band-cell"><div class="label">FC</div>${bandBadge(s.band_fc)}</div>
      <div class="ses-band-cell"><div class="label">LR</div>${bandBadge(s.band_lr)}</div>
      <div class="ses-band-cell"><div class="label">GRA</div>${bandBadge(s.band_gra)}</div>
      <div class="ses-band-cell"><div class="label">P</div>${bandBadge(s.band_p)}</div>
    </div>`;
  }

  if (s.error_code) {
    html += `<div style="background:#FEE2E2;border:1px solid #FECACA;border-radius:8px;padding:12px;color:#991B1B">
      <strong>Lỗi: ${escapeHtml(s.error_code)} @ ${escapeHtml(s.failed_step || '')}</strong>
      <div style="font-size:var(--av-fs-xs);margin-top:4px">${escapeHtml(s.error_message || '')}</div>
      <div style="font-size:var(--av-fs-xs);margin-top:4px;color:#7F1D1D">${fmtDate(s.last_error_at)}</div>
    </div>`;
  }

  if (qs.length === 0) {
    html += `<p style="color:var(--av-text-muted);font-size:var(--av-fs-sm)">Không có câu hỏi.</p>`;
  } else {
    qs.forEach((q, idx) => {
      const r = respMap[q.id];
      html += `<div class="ses-qa">
        <span class="q-label">Q${idx + 1}</span>
        <div>${escapeHtml(q.question_text || '')}</div>`;
      if (r) {
        const gStatus = r.grading_status || 'completed';
        html += `<div style="font-size:var(--av-fs-xs);color:var(--av-text-muted)">
          Grading: <strong>${escapeHtml(gStatus)}</strong> · Band: ${bandBadge(r.overall_band)}
        </div>`;
        if (r.transcript) {
          html += `<div class="transcript">${escapeHtml(r.transcript)}</div>`;
        }
        if (r.audio_playback_url) {
          html += `<audio controls src="${escapeHtml(r.audio_playback_url)}"></audio>`;
        } else if (r.audio_storage_path || r.audio_url) {
          html += `<p style="font-size:var(--av-fs-xs);color:var(--av-text-muted)">Audio nằm trong storage; chưa có URL phát lại khả dụng.</p>`;
        }
        html += `<div><button class="btn-ghost" data-action="regrade-response"
                              data-rid="${escapeHtml(r.id)}" data-sid="${escapeHtml(s.id)}">Chấm lại câu này</button></div>`;
      } else {
        html += `<p style="font-size:var(--av-fs-xs);color:var(--av-text-muted)">Chưa có câu trả lời.</p>`;
      }
      html += `</div>`;
    });
  }

  $('detail-content').innerHTML = html;
  $('detail-loading').hidden = true;
  $('detail-content').hidden = false;
}


// ── Actions ─────────────────────────────────────────────────────────


async function regradeResponse(responseId, sessionId, btn) {
  if (!confirm('Chấm lại câu trả lời này? Kết quả cũ sẽ bị ghi đè.')) return;
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Đang chấm…'; }
  try {
    await api.post('/admin/responses/' + responseId + '/regrade', {});
    showBanner('Chấm lại thành công.', 'success');
    if (sessionId) loadDetail(sessionId);
  } catch (err) {
    showBanner('Lỗi: ' + (err.message || err), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = orig; }
  }
}

async function regradeSession(sessionId, btn) {
  if (!confirm('Chấm lại toàn bộ session này? Các câu bị lỗi sẽ được chấm lại.')) return;
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Đang chấm…'; }
  try {
    const result = await api.post('/admin/sessions/' + sessionId + '/regrade', {});
    let msg;
    if (result.partial_failure) {
      msg = `Regrade hoàn tất một phần: ${result.regraded || 0} thành công, ${result.failed || 0} lỗi.`;
    } else if (result.ok) {
      msg = `Regrade thành công: ${result.regraded || 0} câu chấm lại`
          + ((result.skipped || 0) ? `, ${result.skipped} giữ nguyên.` : '.');
    } else {
      msg = `Regrade không hoàn tất sạch: ${result.regraded || 0} thành công, ${result.failed || 0} lỗi.`;
    }
    if (result.failed_details && result.failed_details.length) {
      msg += '\n\nChi tiết lỗi:\n- ' + result.failed_details.join('\n- ');
    }
    alert(msg);
    loadDetail(sessionId);
  } catch (err) {
    showBanner('Lỗi: ' + (err.message || err), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = orig; }
  }
}

async function rebuildSummary(sessionId, p2Id, p3Id, btn) {
  if (!confirm('Tổng hợp lại band scores cho session này?')) return;
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Đang tổng hợp…'; }
  try {
    let url = '/admin/sessions/' + sessionId + '/rebuild-summary';
    const params = [];
    if (p2Id) params.push('p2_id=' + encodeURIComponent(p2Id));
    if (p3Id) params.push('p3_id=' + encodeURIComponent(p3Id));
    if (params.length) url += '?' + params.join('&');
    const result = await api.post(url, {});
    const sessions = Array.isArray(result.sessions) ? result.sessions : [];
    const ok = sessions.filter((it) => it.ok);
    const failed = sessions.filter((it) => !it.ok);
    let msg = failed.length
      ? `Tổng hợp hoàn tất một phần: ${ok.length}/${sessions.length} session thành công.`
      : `Tổng hợp thành công cho ${ok.length} session.`;
    if (ok.length) {
      msg += '\n\nKết quả:\n' + ok.map((it) => `${it.session_id}: overall ${it.overall_band == null ? '—' : it.overall_band}`).join('\n');
    }
    if (failed.length) {
      msg += '\n\nChưa tổng hợp được:\n- ' + failed.map((it) => `${it.session_id}: ${it.error || 'Lỗi không xác định'}`).join('\n- ');
    }
    alert(msg);
    loadDetail(sessionId);
  } catch (err) {
    showBanner('Lỗi: ' + (err.message || err), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = orig; }
  }
}


// ── Wire it up ──────────────────────────────────────────────────────


function bind() {
  $('btn-search').addEventListener('click', () => loadSessions(true));
  $('btn-reset').addEventListener('click', resetFilters);
  $('btn-more').addEventListener('click', () => loadSessions(false));
  $('btn-close').addEventListener('click', closeModal);
  $('modal-backdrop').addEventListener('click', (e) => {
    if (e.target === $('modal-backdrop')) closeModal();
  });
  $('sf-email').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadSessions(true);
  });

  $('sessions-tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'view') loadDetail(btn.dataset.id);
  });

  $('detail-content').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const a = btn.dataset.action;
    if (a === 'regrade-session') regradeSession(btn.dataset.id, btn);
    else if (a === 'rebuild-summary') rebuildSummary(btn.dataset.id, null, null, btn);
    else if (a === 'rebuild-summary-full') rebuildSummary(btn.dataset.id, btn.dataset.p2, btn.dataset.p3, btn);
    else if (a === 'regrade-response') regradeResponse(btn.dataset.rid, btn.dataset.sid, btn);
  });
}

async function main() {
  bind();
  await loadSessions(true);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
