/**
 * frontend/js/admin-listening-content-list.js — Sprint 13.1
 * (DEBT-ADMIN-LISTENING-AUTHORING 1/N).
 *
 * Content browser for /pages/admin/listening/index.html. Replaces the
 * Sprint 11.5 card-grid landing — admins now see the listening_content
 * table directly with status filter, exercise count badges, and
 * one-click deep-links into each editor with ?content_id= pre-baked.
 *
 * Endpoints consumed:
 *   GET /admin/listening/content?status=&limit=&offset=    — list
 *   GET /admin/listening/exercises?content_id=             — per-row badges
 *
 * The exercise badge column issues one GET per content row. For ≤20
 * rows per page this is fast enough and lets us reuse the existing
 * Sprint 11.3+ endpoint without backend changes. If the list grows
 * past 100 rows, batch into a single content_ids=A,B,C GET (Phase B).
 */

const SUPABASE_URL  = 'https://huwsmtubwulikhlmcirx.supabase.co';
const SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();


const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 20;

const STATE = {
  status: 'all',
  offset: 0,
  total:  0,
  items:  [],
};


function fmtDateShort(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('vi-VN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch { return iso; }
}


function escapeHtml(s) {
  // C4: delegate to the shared escaper (window.WC.escapeHtml, api.js);
  // local fallback kept so this module is safe if window.WC hasn't loaded.
  return (typeof window !== 'undefined' && window.WC && window.WC.escapeHtml)
    ? window.WC.escapeHtml(s)
    : String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}


function showBanner(text) {
  showToast(text, 'info', { persist: true });
}


function exerciseBadges(exercises) {
  // Render badges in canonical order, dim out absent types.
  const TYPES = [
    { key: 'dictation',  label: 'dict' },
    { key: 'gist',       label: 'gist' },
    { key: 'true_false', label: 't/f'  },
    { key: 'mcq',        label: 'mcq'  },
  ];
  const have = new Set((exercises || []).map((e) => e.exercise_type));
  if (!have.size) return `<span class="lst-ex-empty">Chưa có</span>`;
  return `<span class="lst-ex-badges">${TYPES
    .filter((t) => have.has(t.key))
    .map((t) => `<span class="lst-ex-badge" data-ex-type="${t.key}">${t.label}</span>`)
    .join('')}</span>`;
}


function renderRow(row) {
  const status = row.status || 'draft';
  const statusChip = `<span class="lst-chip is-${status}">${status}</span>`;
  const idEsc = encodeURIComponent(row.id);
  const detailHref = `/pages/admin/listening/content-detail.html?id=${idEsc}`;
  const metaHref   = `/pages/admin/listening/content-meta.html?id=${idEsc}`;
  return `
    <tr data-content-id="${escapeHtml(row.id)}">
      <td class="lst-row-title">
        <a href="${detailHref}">${escapeHtml(row.title || '—')}</a>
        <div class="lst-mono">${escapeHtml(row.id || '')}</div>
      </td>
      <td>${escapeHtml(row.accent_tag || '—')}</td>
      <td>${escapeHtml(row.cefr_level || '—')}</td>
      <td>${row.ielts_section ?? '—'}</td>
      <td>${statusChip}</td>
      <td>${row.audio_duration_seconds ?? '—'}</td>
      <td data-ex-col="${escapeHtml(row.id)}">
        <span class="lst-ex-empty">…</span>
      </td>
      <td>${fmtDateShort(row.created_at)}</td>
      <td class="lst-actions">
        <a href="${detailHref}" data-action="detail">Chi tiết</a>
        <a href="${metaHref}"   data-action="edit-meta">Sửa meta</a>
        <a href="/pages/admin/listening/segments.html?content_id=${idEsc}" data-action="open-editor" data-ex-type="dictation">Dict</a>
        <a href="/pages/admin/listening/gist.html?content_id=${idEsc}"     data-action="open-editor" data-ex-type="gist">Gist</a>
        <a href="/pages/admin/listening/tf.html?content_id=${idEsc}"       data-action="open-editor" data-ex-type="true_false">T/F</a>
        <a href="/pages/admin/listening/mcq.html?content_id=${idEsc}"      data-action="open-editor" data-ex-type="mcq">MCQ</a>
      </td>
    </tr>
  `;
}


async function fetchExerciseBadges(items) {
  // One GET per content row. For PAGE_SIZE=20 that is 20 requests; the
  // backend serves these from cache cheaply. If we ever hit visible
  // latency, switch to a batch endpoint.
  await Promise.all(items.map(async (row) => {
    try {
      const res = await window.api.get(
        `/admin/listening/exercises?content_id=${encodeURIComponent(row.id)}`,
      );
      const cell = document.querySelector(`[data-ex-col="${row.id}"]`);
      if (cell) cell.innerHTML = exerciseBadges(res.exercises || []);
    } catch {
      const cell = document.querySelector(`[data-ex-col="${row.id}"]`);
      if (cell) cell.innerHTML = `<span class="lst-ex-empty">?</span>`;
    }
  }));
}


async function load() {
  $('lst-loading').hidden = false;
  $('lst-empty').hidden = true;
  $('lst-table-wrap').hidden = true;
  $('lst-pagination').hidden = true;

  try {
    const path =
      `/admin/listening/content?status=${encodeURIComponent(STATE.status)}`
      + `&limit=${PAGE_SIZE}&offset=${STATE.offset}`;
    const res = await window.api.get(path);
    STATE.items = res.items || [];
    STATE.total = res.total || 0;
  } catch (e) {
    showBanner(`Tải danh sách thất bại: ${e.message || e}`);
    $('lst-loading').hidden = true;
    return;
  }

  $('lst-loading').hidden = true;

  if (!STATE.items.length) {
    $('lst-empty').hidden = false;
    return;
  }

  $('lst-tbody').innerHTML = STATE.items.map(renderRow).join('');
  $('lst-table-wrap').hidden = false;

  // Pagination
  const info = $('lst-pagination-info');
  const from = STATE.offset + 1;
  const to   = STATE.offset + STATE.items.length;
  if (info) info.textContent = `${from}–${to} / ${STATE.total}`;
  $('lst-prev').disabled = STATE.offset === 0;
  $('lst-next').disabled = STATE.offset + STATE.items.length >= STATE.total;
  $('lst-pagination').hidden = false;

  // Lazy-load exercise badges per row (fire-and-forget).
  fetchExerciseBadges(STATE.items);
}


function wire() {
  $('lst-status').addEventListener('change', (e) => {
    STATE.status = e.target.value || 'all';
    STATE.offset = 0;
    load();
  });
  $('lst-prev').addEventListener('click', () => {
    STATE.offset = Math.max(0, STATE.offset - PAGE_SIZE);
    load();
  });
  $('lst-next').addEventListener('click', () => {
    STATE.offset += PAGE_SIZE;
    load();
  });
  // Defensive: only block cards that are still placeholders (aria-disabled).
  // Sprint 13.2 flipped the "upload" card to live; "render" stays blocked
  // until Sprint 13.3.
  document.querySelectorAll('[data-create][aria-disabled="true"]').forEach((el) => {
    el.addEventListener('click', (ev) => ev.preventDefault());
  });
}


if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    wire();
    load();
  });
}
