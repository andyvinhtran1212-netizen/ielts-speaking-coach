/**
 * frontend/js/listening-analytics.js — Sprint 11.5
 * (DEBT-LISTENING-MODULE 5/5).
 *
 * User listening analytics dashboard. Fetches GET /api/listening/analytics
 * with range=7d|30d|all, renders summary cards + per-mode table +
 * 14-day bar chart + recent activity list.
 *
 * Honors the CLAUDE.md non-misleading-feedback rule: modes with <3
 * attempts show "—" (server-side mark; no fabricated band).
 */

const SUPABASE_URL = 'https://nqhrtqspznepmveyurzm.supabase.co';
const SUPABASE_ANON = 'sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

const $ = (id) => document.getElementById(id);

const MODE_LABELS = {
  dictation:  'Chép chính tả',
  gist:       'Nghe ý chính',
  true_false: 'Đúng / Sai',
  mcq:        'Trắc nghiệm',
};

const STATE = {
  range: '30d',
};

const VIEWS = {
  loading: $('state-loading'),
  empty:   $('state-empty'),
  error:   $('state-error'),
  surface: $('analytics-surface'),
};


function showState(name) {
  VIEWS.loading.hidden = name !== 'loading';
  VIEWS.empty.hidden   = name !== 'empty';
  VIEWS.error.hidden   = name !== 'error';
  VIEWS.surface.hidden = name !== 'ready';
}
function showError(msg) { VIEWS.error.textContent = msg; showState('error'); }


async function load() {
  showState('loading');
  try {
    const res = await window.api.get(
      `/api/listening/analytics?range=${encodeURIComponent(STATE.range)}`,
    );
    if (!res || res.total_attempts === 0) { showState('empty'); return; }
    render(res);
    showState('ready');
  } catch (e) {
    showError('Không tải được thống kê. ' + (e && e.message ? e.message : ''));
  }
}


function render(data) {
  $('stat-total').textContent = String(data.total_attempts);

  // Overall average score = mean of by_mode.avg_score weighted by count.
  const modes = ['dictation', 'gist', 'true_false', 'mcq'];
  let weightedScore = 0;
  let weightedAcc = 0;
  let count = 0;
  modes.forEach((m) => {
    const r = (data.by_mode || {})[m];
    if (!r || !r.count) return;
    weightedScore += (r.avg_score || 0) * r.count;
    weightedAcc   += (r.accuracy  || 0) * r.count;
    count += r.count;
  });
  const avg = count ? (weightedScore / count) : null;
  const acc = count ? (weightedAcc / count) : null;
  $('stat-avg').textContent = avg == null ? '—' : `${Math.round(avg * 100)}%`;
  $('stat-avg-sub').textContent = avg == null ? '' : `trong ${count} lượt`;
  $('stat-acc').textContent = acc == null ? '—' : `${Math.round(acc * 100)}%`;

  // Weakest mode banner.
  const wm = data.weakest_mode;
  if (wm && MODE_LABELS[wm]) {
    $('weakest-banner').textContent =
      `Dạng cần luyện thêm: ${MODE_LABELS[wm]} (điểm thấp nhất trong khoảng này).`;
    $('weakest-banner').hidden = false;
  } else {
    $('weakest-banner').hidden = true;
  }

  // Mode table.
  const tbody = $('mode-table-body');
  tbody.innerHTML = '';
  modes.forEach((m) => {
    const r = (data.by_mode || {})[m] || { count: 0, avg_score: null, accuracy: null };
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(MODE_LABELS[m] || m)}</td>
      <td class="num">${r.count || 0}</td>
      <td class="num">${r.avg_score == null ? '—' : `${Math.round(r.avg_score * 100)}%`}</td>
      <td class="num">${r.accuracy  == null ? '—' : `${Math.round(r.accuracy * 100)}%`}</td>
    `;
    tbody.appendChild(tr);
  });

  // Day chart.
  const chart = $('day-chart');
  const labels = $('day-labels');
  chart.innerHTML = '';
  labels.innerHTML = '';
  const days = data.by_day || [];
  const maxCount = Math.max(1, ...days.map((d) => d.count || 0));
  days.forEach((d) => {
    const h = Math.max(4, Math.round(((d.count || 0) / maxCount) * 100));
    const bar = document.createElement('div');
    bar.className = 'day-bar';
    bar.style.height = `${h}px`;
    bar.dataset.hasData = d.count > 0 ? '1' : '0';
    bar.title = `${d.date} — ${d.count} lượt${
      d.avg_score == null ? '' : `, TB ${Math.round(d.avg_score * 100)}%`
    }`;
    chart.appendChild(bar);

    const lbl = document.createElement('div');
    lbl.textContent = (d.date || '').slice(5);  // MM-DD
    labels.appendChild(lbl);
  });

  // Recent activity.
  const list = $('recent-list');
  list.innerHTML = '';
  (data.recent_attempts || []).forEach((r) => {
    const li = document.createElement('li');
    const pct = Math.round((r.score || 0) * 100);
    const isPerfect = r.is_correct ? 'is-perfect' : '';
    const dt = (r.created_at || '').slice(0, 10);
    li.innerHTML = `
      <span class="recent-mode">${escapeHtml(MODE_LABELS[r.exercise_type] || r.exercise_type)}</span>
      <span style="color: var(--av-text-muted); font-family: var(--av-font-mono); font-size: var(--av-fs-xs);">${dt}</span>
      <span class="recent-score ${isPerfect}">${pct}%</span>
    `;
    list.appendChild(li);
  });
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


if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    load();
    document.querySelectorAll('.range-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        STATE.range = btn.dataset.range;
        document.querySelectorAll('.range-tab').forEach((b) => {
          b.classList.toggle('is-active', b === btn);
        });
        load();
      });
    });
  });
}
