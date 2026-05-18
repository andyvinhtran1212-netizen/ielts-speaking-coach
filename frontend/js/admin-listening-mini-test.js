/**
 * frontend/js/admin-listening-mini-test.js — Sprint 11.5
 * (DEBT-LISTENING-MODULE 5/5).
 *
 * Admin Mini Test builder. Fetches all published listening_exercises
 * across all content rows, lets admin click-to-add into the lineup,
 * reorder/remove, then POSTs to /admin/listening/sessions with
 * exercise_ids[] + ordered_position[].
 *
 * No URL param — fresh build each visit. Existing sessions listed at
 * the top for reference; click to clone-into-new-session pattern is
 * future scope.
 */

const SUPABASE_URL = 'https://nqhrtqspznepmveyurzm.supabase.co';
const SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

const $ = (id) => document.getElementById(id);

const STATE = {
  pool:    [],   // [{id, content_id, exercise_type, status, content_title}]
  lineup:  [],   // ordered list of exercise rows (subset of pool)
};


function showBanner(text, kind = 'info') {
  const b = $('status-banner');
  b.textContent = text;
  b.classList.remove('is-info', 'is-success', 'is-error');
  b.classList.add(`is-${kind}`);
  b.hidden = false;
}


async function load() {
  showBanner('Đang tải kho exercises và sessions đã có…', 'info');
  try {
    // Fetch all published content rows (admin endpoint).
    const cRes = await window.api.get('/admin/listening/content?status=published&limit=100');
    const contents = (cRes && cRes.items) || [];
    const cTitle = Object.fromEntries(contents.map((c) => [c.id, c.title]));

    // Fetch every exercise for every published content.
    const all = [];
    for (const c of contents) {
      try {
        const exRes = await window.api.get(
          `/admin/listening/exercises?content_id=${encodeURIComponent(c.id)}`,
        );
        for (const ex of (exRes && exRes.exercises) || []) {
          if (ex.status === 'published' && ex.exercise_type !== 'mini_test') {
            all.push({
              id:            ex.id,
              content_id:    ex.content_id,
              exercise_type: ex.exercise_type,
              order_num:     ex.order_num || 1,
              content_title: cTitle[ex.content_id] || '(unknown)',
            });
          }
        }
      } catch { /* skip failed content */ }
    }
    STATE.pool = all;
    renderPool();

    // List existing sessions.
    const sRes = await window.api.get('/admin/listening/sessions?limit=20');
    renderExistingSessions((sRes && sRes.items) || []);

    showBanner(`${all.length} exercises sẵn sàng. Click để thêm vào lineup.`, 'info');
  } catch (e) {
    showBanner(`Tải kho thất bại: ${e.message || e}`, 'error');
  }
}


function renderPool() {
  const list = $('pool-list');
  list.innerHTML = '';
  const inLineup = new Set(STATE.lineup.map((e) => e.id));
  STATE.pool.forEach((ex) => {
    const li = document.createElement('li');
    li.className = 'ex-card';
    const disabled = inLineup.has(ex.id);
    li.innerHTML = `
      <div style="flex: 1; min-width: 0;">
        <div class="ex-title">${escapeHtml(ex.content_title)}</div>
        <div class="ex-meta">${ex.exercise_type} · ${ex.id.slice(0, 8)}</div>
      </div>
      <span class="ex-type-pill">${ex.exercise_type}</span>
      <button class="btn-ghost" type="button" data-action="add" data-id="${ex.id}"
              ${disabled ? 'disabled' : ''}>
        ${disabled ? 'Đã thêm' : '+ Thêm'}
      </button>
    `;
    list.appendChild(li);
  });
}


function renderLineup() {
  const list = $('lineup-list');
  list.innerHTML = '';
  STATE.lineup.forEach((ex, i) => {
    const li = document.createElement('li');
    li.className = 'ex-card';
    li.innerHTML = `
      <span class="ex-meta">#${i + 1}</span>
      <div style="flex: 1; min-width: 0;">
        <div class="ex-title">${escapeHtml(ex.content_title)}</div>
        <div class="ex-meta">${ex.exercise_type}</div>
      </div>
      <button class="btn-ghost" type="button" data-action="up"     data-i="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button class="btn-ghost" type="button" data-action="down"   data-i="${i}" ${i === STATE.lineup.length - 1 ? 'disabled' : ''}>↓</button>
      <button class="btn-ghost" type="button" data-action="remove" data-i="${i}">Xóa</button>
    `;
    list.appendChild(li);
  });
  $('lineup-count').textContent = String(STATE.lineup.length);
}


function renderExistingSessions(items) {
  const list = $('existing-sessions');
  list.innerHTML = '';
  if (!items.length) {
    const li = document.createElement('li');
    li.style.color = 'var(--av-text-muted)';
    li.style.fontSize = 'var(--av-fs-sm)';
    li.textContent = 'Chưa có Mini Test nào.';
    list.appendChild(li);
    return;
  }
  items.forEach((s) => {
    const li = document.createElement('li');
    li.className = 'ex-card';
    const n = (s.exercise_ids || []).length;
    li.innerHTML = `
      <div style="flex: 1; min-width: 0;">
        <div class="ex-title">${escapeHtml(s.title || s.id.slice(0, 8))}</div>
        <div class="ex-meta">${n} câu · ${s.id.slice(0, 8)}</div>
      </div>
      <a class="btn-ghost" href="/pages/listening-mini-test.html?session_id=${encodeURIComponent(s.id)}">Mở</a>
    `;
    list.appendChild(li);
  });
}


function wirePoolEvents() {
  $('pool-list').addEventListener('click', (e) => {
    if (e.target.dataset.action !== 'add') return;
    const id = e.target.dataset.id;
    const ex = STATE.pool.find((p) => p.id === id);
    if (!ex) return;
    if (STATE.lineup.find((p) => p.id === id)) return;
    if (STATE.lineup.length >= 50) {
      showBanner('Tối đa 50 câu trong một Mini Test.', 'error');
      return;
    }
    STATE.lineup.push(ex);
    renderPool();
    renderLineup();
  });

  $('lineup-list').addEventListener('click', (e) => {
    const a = e.target.dataset.action;
    const i = Number(e.target.dataset.i);
    if (!Number.isFinite(i)) return;
    if (a === 'up' && i > 0) {
      [STATE.lineup[i - 1], STATE.lineup[i]] = [STATE.lineup[i], STATE.lineup[i - 1]];
    } else if (a === 'down' && i < STATE.lineup.length - 1) {
      [STATE.lineup[i + 1], STATE.lineup[i]] = [STATE.lineup[i], STATE.lineup[i + 1]];
    } else if (a === 'remove') {
      STATE.lineup.splice(i, 1);
    } else {
      return;
    }
    renderPool();
    renderLineup();
  });
}


async function save() {
  const title = ($('title-input').value || '').trim();
  if (!title) { showBanner('Cần đặt tên cho Mini Test.', 'error'); return; }
  if (!STATE.lineup.length) { showBanner('Lineup đang trống.', 'error'); return; }

  $('btn-save').disabled = true;
  try {
    const body = {
      title,
      status:           'draft',
      exercise_ids:     STATE.lineup.map((e) => e.id),
      ordered_position: STATE.lineup.map((e, i) => ({
        exercise_id: e.id,
        section:     Math.min(4, Math.floor(i / Math.ceil(STATE.lineup.length / 4)) + 1),
        label:       e.content_title,
      })),
    };
    const out = await window.api.post('/admin/listening/sessions', body);
    showBanner(
      `Đã tạo Mini Test ${out.session_id}. Truy cập tại `
      + `/pages/listening-mini-test.html?session_id=${out.session_id}`,
      'success',
    );
  } catch (e) {
    showBanner(`Lưu thất bại: ${e.message || e}`, 'error');
  } finally {
    $('btn-save').disabled = false;
  }
}


function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}


if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    load();
    wirePoolEvents();
    $('btn-save').addEventListener('click', save);
  });
}
