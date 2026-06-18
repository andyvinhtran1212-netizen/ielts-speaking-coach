/**
 * frontend/js/instructor-app.js — W-6b-1 instructor shell controller.
 *
 * Roster (read) + Lớp & Mã (cohort create/list + student-enroll code mint/list).
 * EVERY fetch goes to the instructor (owner-scoped) routes — never the admin
 * routes (a single admin-route call would be a cross-tenant leak; a CI grep-gate
 * enforces zero quoted admin-path literals here).
 *
 * Page self-gates on role (mirrors backend require_instructor): a non-instructor
 * is redirected out before any data loads.
 */

const api = window.api;
const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let _cohortNameById = {};

// ── boot + role gate ─────────────────────────────────────────────────

async function boot() {
  let me;
  try {
    me = await api.get('/auth/me');
  } catch (e) {
    me = null;
  }
  if (!me) return;                       // api.js already redirected (401)
  const role = me.role;
  if (role !== 'instructor' && role !== 'admin') {
    $('gate-msg').hidden = false;
    setTimeout(() => { window.location.href = '/pages/home.html'; }, 1200);
    return;
  }
  wireChrome();
  await loadClasses();                   // builds cohort-name map first
  await loadRoster();
}

function wireChrome() {
  // tabs
  document.querySelectorAll('.ins-tab[data-tab]').forEach((btn) => {
    if (btn.disabled) return;
    btn.addEventListener('click', () => selectTab(btn.dataset.tab));
  });
  // theme toggle
  $('theme-toggle').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', cur);
    try { localStorage.setItem('aver-theme', cur); } catch (e) { /* ignore */ }
  });
  // logout
  $('logout-btn').addEventListener('click', async () => {
    try {
      const sb = window.getSupabase && window.getSupabase();
      if (sb && sb.auth) await sb.auth.signOut();
    } catch (e) { /* ignore */ }
    window.location.href = '/index.html';
  });
  // drawer close
  $('drawer-close').addEventListener('click', closeDrawer);
  $('drawer-backdrop').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  // forms
  $('cohort-form').addEventListener('submit', onCreateCohort);
  $('code-form').addEventListener('submit', onMintCode);
}

function selectTab(tab) {
  document.querySelectorAll('.ins-tab[data-tab]').forEach((b) =>
    b.classList.toggle('is-active', b.dataset.tab === tab));
  $('section-roster').hidden = tab !== 'roster';
  $('section-classes').hidden = tab !== 'classes';
}

// ── Roster ───────────────────────────────────────────────────────────

async function loadRoster() {
  const body = $('roster-body');
  try {
    const rows = (await api.get('/instructor/students')) || [];
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="4" class="ins-muted">Chưa có học viên. Tạo mã ghi danh ở tab "Lớp &amp; Mã".</td></tr>';
      return;
    }
    body.innerHTML = rows.map((s) => {
      const cohort = s.cohort_id ? esc(_cohortNameById[s.cohort_id] || 'Lớp') : '—';
      const acct = s.user_id ? '<span class="ins-pill">Đã kích hoạt</span>'
                             : '<span class="ins-pill ins-muted">Chưa kích hoạt</span>';
      return `<tr class="is-click" data-id="${esc(s.id)}">
        <td>${esc(s.full_name)}</td><td>${esc(s.student_code)}</td>
        <td>${cohort}</td><td>${acct}</td></tr>`;
    }).join('');
    body.querySelectorAll('tr.is-click').forEach((tr) =>
      tr.addEventListener('click', () => openDrawer(tr.dataset.id)));
  } catch (e) {
    body.innerHTML = `<tr><td colspan="4" class="ins-banner--err">Lỗi tải: ${esc(e.message)}</td></tr>`;
  }
}

// ── Student Hub drawer ───────────────────────────────────────────────

async function openDrawer(id) {
  $('drawer-backdrop').hidden = false;
  $('student-drawer').hidden = false;
  const c = $('drawer-content');
  c.innerHTML = '<p class="ins-muted">Đang tải…</p>';
  try {
    // both /instructor/* — scoped to me (404 if not my student)
    const summary = await api.get('/instructor/students/' + encodeURIComponent(id) + '/summary');
    const st = summary.student || {};
    const stats = summary.stats || {};
    const essays = summary.recent_essays || [];
    c.innerHTML = `
      <h3 class="ins-h2" style="font-size:1.1rem;">${esc(st.full_name || 'Học viên')}</h3>
      <p class="ins-muted" style="margin-top:0;">${esc(st.student_code || '')}
        ${st.target_band ? '· mục tiêu ' + esc(st.target_band) : ''}</p>
      <div class="ins-card">
        <div>Tổng bài: <b>${esc(stats.total_essays || 0)}</b> ·
             Đã chấm: <b>${esc(stats.graded_count || 0)}</b> ·
             Cờ: <b>${esc(stats.flagged_count || 0)}</b></div>
        <div style="margin-top:var(--av-space-2);">Band TB (5 bài gần nhất):
             <b>${stats.average_band_last5 != null ? esc(stats.average_band_last5) : '—'}</b></div>
      </div>
      <h4 class="ins-h2" style="font-size:.95rem;">Bài gần đây</h4>
      <table class="ins-table"><thead><tr><th>Dạng</th><th>Trạng thái</th></tr></thead><tbody>
        ${essays.length
          ? essays.map((e) => `<tr><td>${esc(e.task_type || '')}</td><td>${esc(e.status || '')}</td></tr>`).join('')
          : '<tr><td colspan="2" class="ins-muted">Chưa có bài.</td></tr>'}
      </tbody></table>`;
  } catch (e) {
    c.innerHTML = `<p class="ins-banner--err">Lỗi tải hồ sơ: ${esc(e.message)}</p>`;
  }
}

function closeDrawer() {
  $('drawer-backdrop').hidden = true;
  $('student-drawer').hidden = true;
}

// ── Lớp & Mã ─────────────────────────────────────────────────────────

function classesBanner(msg, kind) {
  $('classes-banner').innerHTML = msg ? `<div class="ins-banner ins-banner--${kind}">${esc(msg)}</div>` : '';
}

async function loadClasses() {
  // cohorts (also builds the id→name map used by the roster)
  try {
    const cohorts = (await api.get('/instructor/cohorts')) || [];
    _cohortNameById = {};
    cohorts.forEach((c) => { _cohortNameById[c.id] = c.name; });
    $('cohort-body').innerHTML = cohorts.length
      ? cohorts.map((c) => `<tr><td>${esc(c.name)}</td><td class="ins-muted">${esc((c.created_at || '').slice(0, 10))}</td></tr>`).join('')
      : '<tr><td colspan="2" class="ins-muted">Chưa có lớp.</td></tr>';
    const sel = $('code-cohort');
    sel.innerHTML = '<option value="">— Không gắn lớp —</option>'
      + cohorts.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  } catch (e) {
    $('cohort-body').innerHTML = `<tr><td colspan="2" class="ins-banner--err">Lỗi: ${esc(e.message)}</td></tr>`;
  }
  await loadCodes();
}

async function loadCodes() {
  try {
    const codes = (await api.get('/instructor/codes')) || [];
    $('code-body').innerHTML = codes.length
      ? codes.map((c) => {
          const status = c.is_used ? '<span class="ins-pill">Đã dùng</span>'
                                   : '<span class="ins-pill">Chưa dùng</span>';
          const cohort = c.cohort_id ? esc(_cohortNameById[c.cohort_id] || 'Lớp') : '—';
          return `<tr><td class="ins-code">${esc(c.code)}</td><td>${status}</td><td>${cohort}</td></tr>`;
        }).join('')
      : '<tr><td colspan="3" class="ins-muted">Chưa có mã.</td></tr>';
  } catch (e) {
    $('code-body').innerHTML = `<tr><td colspan="3" class="ins-banner--err">Lỗi: ${esc(e.message)}</td></tr>`;
  }
}

async function onCreateCohort(ev) {
  ev.preventDefault();
  const name = $('cohort-name').value.trim();
  if (!name) return;
  classesBanner('', 'ok');
  try {
    await api.post('/instructor/cohorts', { name });
    $('cohort-name').value = '';
    classesBanner('Đã tạo lớp.', 'ok');
    await loadClasses();
  } catch (e) {
    classesBanner('Lỗi tạo lớp: ' + e.message, 'err');
  }
}

async function onMintCode(ev) {
  ev.preventDefault();
  const cohort_id = $('code-cohort').value || null;
  const count = Math.max(1, Math.min(50, parseInt($('code-count').value, 10) || 1));
  classesBanner('', 'ok');
  try {
    const body = { count };
    if (cohort_id) body.cohort_id = cohort_id;
    const res = await api.post('/instructor/codes', body);
    classesBanner('Đã tạo mã: ' + (res.codes || []).join(', '), 'ok');
    await loadCodes();
  } catch (e) {
    classesBanner('Lỗi tạo mã: ' + e.message, 'err');
  }
}

boot();
