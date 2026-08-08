/**
 * frontend/js/listening-practice.js — Luyện nhanh.
 *
 * One library, three tabs. The three hold genuinely different material, which
 * is why they are tabs rather than one flat list:
 *
 *   trap     10 questions all drilling the SAME trap — pick a weakness and
 *            hammer it. This is the axis the site did not have: Full/Mini are
 *            organised by exam, Luyện kĩ năng by question type.
 *   section  short simulated Part 1/2/3 sections, traps scattered.
 *   curated  hand-written lectures, maps, flow-charts.
 *
 * Tabs are driven by GET /api/listening/overview `practice_groups`, so a tab
 * with nothing behind it never renders — same rule as the landing tiles.
 */

import { fetchAllPages } from './listening-list-paging.js';


// Module nay co the duoc NAP MUON: tren ban Next, `LegacyModule` chen the
// <script> trong useEffect, tuc SAU khi React hydrate — ma luc do
// `DOMContentLoaded` DA BAN. Mot listener dang ky sau do khong bao gio chay,
// nen trang KHONG BAO GIO boot. Do la loi cong G1 bat duoc o
// /listening/skills va /reading/vocab (PR #1004).
//
// Tren ban legacy the <script> van nam san trong HTML nen `readyState` con la
// 'loading' — nhanh cu chay y nguyen, khong doi hanh vi.
function __averOnReady(fn) {
  if (typeof document === 'undefined') return;
  // `readyState` LUON la chuoi trong trinh duyet that. Vang no nghia la ta dang
  // o mot `document` GIA (bo test dung stub toi gian) — khi do giu nguyen hanh
  // vi cu: chi dang ky listener, dung tu chay. Chay ngay o do se keo ca than
  // boot vao moi truong khong co DOM that; da lam 5 test chet o lan dau.
  if (typeof document.readyState !== 'string' || document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn, { once: true });
    return;
  }
  fn();
}

const SUPABASE_URL  = 'https://huwsmtubwulikhlmcirx.supabase.co';
const SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

/** Tab order is pedagogical, not alphabetical: start from the weakness you
 *  can name, then the exam-shaped practice, then the hand-written set. */
export const TABS = [
  { key: 'trap',    label: 'Theo bẫy',
    lede: 'Mỗi bài 10 câu cùng MỘT loại bẫy — chọn đúng chỗ mình hay sai và luyện dứt điểm.' },
  { key: 'section', label: 'Mô phỏng section',
    lede: 'Đoạn ngắn theo Part 1/2/3, bẫy rải rác như trong đề.' },
  { key: 'curated', label: 'Bài soạn riêng',
    lede: 'Bài giảng, bản đồ, sơ đồ quy trình — viết tay, chủ đề đa dạng.' },
];

const $ = (id) => document.getElementById(id);

const STATE = { active: null, cache: new Map(), counts: {} };

function showState(name) {
  ['state-loading', 'state-empty', 'state-error', 'practice-body'].forEach((id) => {
    const el = $(id);
    if (el) el.hidden = id !== name;
  });
}
function showError(msg) {
  const el = $('state-error');
  if (el) el.textContent = msg;
  showState('state-error');
}

export function esc(s) {
  return (typeof window !== 'undefined' && window.WC && window.WC.escapeHtml)
    ? window.WC.escapeHtml(s)
    : String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Group a tab's tests by trap so the trap tab reads as eleven short courses
 *  rather than 55 undifferentiated cards. Other tabs keep one flat group. */
export function groupTests(groupKey, items) {
  if (groupKey !== 'trap') return [{ title: null, items }];
  const by = new Map();
  items.forEach((t) => {
    const k = t.trap || 'Khác';
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(t);
  });
  return [...by.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([title, list]) => ({ title, items: list }));
}

export function renderCard(t) {
  const attempted = (t.user_attempt_count || 0) > 0;
  const best = t.user_best_score;
  const bits = [];
  if (best != null) bits.push(`Tốt nhất <strong>${esc(best)}</strong>`);
  bits.push(attempted ? `đã làm ${esc(t.user_attempt_count)} lần` : 'chưa làm');
  return `
    <article class="lt-card" data-test-id="${esc(t.id)}">
      <div class="lt-card-title">${esc(t.title || t.test_id || 'Bài luyện')}</div>
      <div class="lt-card-stats">${bits.join(' · ')}</div>
      <a class="${attempted ? 'lt-card-cta secondary' : 'lt-card-cta'}"
         href="/pages/listening-practice-run.html?id=${encodeURIComponent(t.id)}"
        >${attempted ? 'Làm lại' : 'Bắt đầu'}</a>
    </article>`;
}

export function renderTab(groupKey, items) {
  const tab = TABS.find((t) => t.key === groupKey);
  const groups = groupTests(groupKey, items);
  const head = tab ? `<p class="lp-lede">${esc(tab.lede)}</p>` : '';
  return head + groups.map((g) => `
    <section class="lp-group">
      ${g.title ? `<h3 class="lp-group-title">${esc(g.title)}
         <span class="lp-group-count">${g.items.length} bài</span></h3>` : ''}
      <div class="lt-grid">${g.items.map(renderCard).join('')}</div>
    </section>`).join('');
}

function renderTabBar() {
  const bar = $('practice-tabs');
  if (!bar) return;
  bar.innerHTML = TABS
    .filter((t) => STATE.counts[t.key] > 0)
    .map((t) => `<button class="lp-tab${t.key === STATE.active ? ' is-active' : ''}"
                    data-group="${t.key}" type="button">${esc(t.label)}
                    <span class="lp-tab-count">${STATE.counts[t.key]}</span></button>`)
    .join('');
  bar.querySelectorAll('.lp-tab').forEach((b) => {
    b.addEventListener('click', () => selectTab(b.getAttribute('data-group')));
  });
}

async function selectTab(key) {
  if (!key || key === STATE.active) return;
  STATE.active = key;
  renderTabBar();
  if (typeof history !== 'undefined' && history.replaceState) {
    history.replaceState(null, '', `#${key}`);
  }
  const panel = $('practice-panel');
  if (!STATE.cache.has(key)) {
    if (panel) panel.innerHTML = '<p class="lp-lede">Đang tải…</p>';
    try {
      const items = await fetchAllPages(
        (limit, offset) =>
          `/api/listening/tests?test_type=practice&practice_group=${encodeURIComponent(key)}`
          + `&limit=${limit}&offset=${offset}`,
        (p) => window.api.get(p));
      STATE.cache.set(key, items);
    } catch (e) {
      showError(`Không tải được danh sách: ${(e && e.message) || e}`);
      return;
    }
  }
  if (panel) panel.innerHTML = renderTab(key, STATE.cache.get(key));
  showState('practice-body');
}

async function load() {
  showState('state-loading');
  try {
    const ov = await window.api.get('/api/listening/overview');
    STATE.counts = (ov && ov.practice_groups) || {};
    const available = TABS.filter((t) => STATE.counts[t.key] > 0);
    if (!available.length) { showState('state-empty'); return; }
    const wanted = (location.hash || '').replace('#', '');
    const start = available.find((t) => t.key === wanted) || available[0];
    STATE.active = null;
    renderTabBar();
    await selectTab(start.key);
  } catch (e) {
    showError(`Không tải được Luyện nhanh: ${(e && e.message) || e}`);
  }
}

if (typeof document !== 'undefined') {
  __averOnReady(load);
}
