'use client';

// SpeakingStats — cụm THỐNG KÊ của trang Speaking (PR 3/3).
//
// PHẠM VI: ô số liệu, bảng lịch sử (lọc + phân trang), cache SWR của dashboard,
// dashboard ngữ pháp, cập nhật từ vựng. Tách khỏi `speaking-behavior.tsx` vì hai
// cụm hỏng theo hai kiểu khác nhau: cụm kia làm người dùng KHÔNG BẮT ĐẦU LUYỆN
// ĐƯỢC, cụm này làm người dùng ĐỌC SỐ SAI — và số sai thì im lặng hơn nhiều.
//
// HAI BIỂU ĐỒ nằm ở `./speaking-charts` (PR 3b). Chúng vẽ vào `<canvas>` nên
// cổng parity G1 MÙ với chúng vĩnh viễn — lớp che của chúng là
// `lib/speaking-charts.mjs` + test, không phải cổng. Đừng đọc "cổng xanh" thành
// "biểu đồ đúng".
import { useEffect, useRef } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { destroyCharts, observeThemeFlip, renderCharts } from './speaking-charts';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';
import {
  MODE_BADGE, escHtml, fmtRelTime, historyHasActiveFilters, roundHalf,
} from '@/lib/speaking-stats.mjs';

const $ = (id: string) => document.getElementById(id);

const DASH_SWR_TTL_MS = 30 * 60 * 1000;
const dashKey = (uid: string) => 'swr:dash:' + uid;

type HistoryState = {
  search: string; sort: string; date_from: string; date_to: string;
  page: number; page_size: number;
};

// ── Ô số liệu ───────────────────────────────────────────────────────────────

/**
 * LUÔN giải quyết khung xương (P2.2), kể cả trên đường "không có dữ liệu" —
 * nếu không nó nhấp nháy mãi mãi với người dùng chưa có số liệu 30 ngày.
 */
function renderStats(summary: any) {
  const set = (id: string, v: string | number) => {
    const el = $(id);
    if (el) el.textContent = String(v);
  };
  set('stat-total', summary?.total_sessions ?? 0);

  if (summary?.avg_band_30d != null) {
    set('stat-band', roundHalf(summary.avg_band_30d).toFixed(1));
    set('stat-band-sub', '30 ngày gần nhất');
  } else {
    set('stat-band', '—');
  }

  if (summary?.last_session_at) {
    const d = new Date(summary.last_session_at);
    set('stat-last-date', d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }));
    set('stat-last-topic', summary.last_topic || '—');
  } else {
    set('stat-last-date', '—');
  }

  set('stat-streak', summary?.current_streak ?? 0);

  const none = (summary?.total_sessions ?? 0) === 0;
  $('dashboard-empty')?.classList.toggle('hidden', !none);
  $('charts-section')?.classList.toggle('hidden', none);
}

// ── Lịch sử ─────────────────────────────────────────────────────────────────

function renderHistory(sessions: any[], total: number | undefined, st: HistoryState) {
  // `sessions` gồm completed / submitted / analysis_failed — lọc bỏ in_progress trần.
  const visible = (sessions || []).filter((s) => s.status !== 'in_progress');
  // Lượt tải đã PHÂN TRANG, nên `visible` chỉ là trang hiện tại. Hiện `total`
  // của cả bộ, không phải độ dài trang này — nếu không, người có >20 session
  // sẽ thấy mãi con số "20 sessions".
  const count = typeof total === 'number' ? total : visible.length;
  const cnt = $('history-count');
  if (cnt) cnt.textContent = `${count} sessions`;
  $('history-skeleton')?.classList.add('hidden');
  $('history-error')?.classList.add('hidden');

  const RW = (window as any).RetentionWarning;
  const banner = $('history-retention-banner');
  if (banner) banner.innerHTML = RW ? RW.bannerHtml(RW.countSoonHidden(visible)) : '';

  const emptyEl = $('history-empty');
  const tableEl = $('history-table-wrap');
  if (visible.length === 0) {
    tableEl?.classList.add('hidden');
    // Lọc ra 0 kết quả KHÁC với chưa có session nào: khối "chưa có gì" chỉ
    // đúng ở ca thứ hai.
    if (historyHasActiveFilters(st)) emptyEl?.classList.add('hidden');
    else emptyEl?.classList.remove('hidden');
    return;
  }
  emptyEl?.classList.add('hidden');
  tableEl?.classList.remove('hidden');

  const tbody = $('history-tbody');
  if (!tbody) return;
  tbody.innerHTML = visible
    .slice()
    .sort((a, b) => +new Date(b.started_at) - +new Date(a.started_at))
    .map((s) => {
      const date = new Date(s.started_at)
        .toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const retentionChip = RW ? RW.chipHtml(s.retention) : '';
      const isPending = s.status === 'submitted'
        || (s.status === 'completed' && s.overall_band == null && s.mode === 'test_full');
      const isFailed = s.status === 'analysis_failed';
      const band = s.overall_band != null
        ? `<span style="color:var(--av-primary);font-weight:700;">${roundHalf(s.overall_band).toFixed(1)}</span>`
        : isPending
          ? '<span style="font-size:10px;padding:2px 8px;border-radius:999px;background:var(--av-warning-soft);color:var(--av-warning);font-weight:600;white-space:nowrap;">Đang phân tích</span>'
          : isFailed
            ? '<span style="font-size:10px;padding:2px 8px;border-radius:999px;background:var(--av-error-soft);color:var(--av-error);font-weight:600;white-space:nowrap;">Lỗi phân tích</span>'
            : '<span style="color:var(--av-text-faint);">—</span>';
      // Bản legacy gắn `onmouseover`/`onmouseout` nội tuyến ở nút "Xem lại".
      // Bỏ: hiệu ứng hover thuộc về CSS, và vỏ Next không mang handler nội tuyến.
      const viewBtn = s.id
        ? (isPending || isFailed)
          ? `<span class="text-xs px-3 py-1.5 rounded-lg font-medium" style="color:var(--av-text-muted);border:1px solid var(--av-border-subtle);cursor:default;">${isFailed ? 'Xem lại' : 'Chờ kết quả'}</span>`
          : `<a href="/result?id=${encodeURIComponent(s.id)}" class="text-xs px-3 py-1.5 rounded-lg transition font-medium" style="color:var(--av-primary);border:1px solid var(--av-primary-border);">Xem lại</a>`
        : '—';
      const mode = s.mode || 'practice';
      const badge = (MODE_BADGE as any)[mode] || (MODE_BADGE as any).practice;
      const modeBadge = `<span style="font-size:11px;padding:2px 8px;border-radius:999px;background:${badge.bg};color:${badge.fg};font-weight:600;">${badge.label || mode}</span>`;
      return `
            <tr class="session-row" style="border-bottom:1px solid var(--av-border-subtle);">
              <td class="px-5 py-3.5 text-xs" style="color:var(--av-text-secondary);">${date}${retentionChip ? '<br>' + retentionChip : ''}</td>
              <td class="px-5 py-3.5 text-xs font-semibold" style="color:var(--av-primary);">Part ${s.part || '?'}</td>
              <td class="px-5 py-3.5 text-xs">${modeBadge}</td>
              <td class="px-5 py-3.5 text-xs max-w-[200px] truncate" style="color:var(--av-text-secondary);">${escHtml(s.topic || '—')}</td>
              <td class="px-5 py-3.5 text-center">${band}</td>
              <td class="px-5 py-3.5 text-center">${viewBtn}</td>
            </tr>`;
    })
    .join('');
}

/**
 * Phân trang.
 *
 * Bản legacy nhúng `onclick="window._dashboard.goToHistoryPage(N)"` vào HTML.
 * Ở đây nút mang `data-page` và một listener uỷ quyền trên container xử lý —
 * cùng lý do vỏ không mang handler nội tuyến, và tránh phải phơi hàm ra window.
 */
function renderHistoryPagination(page: number, totalPages: number) {
  const el = $('history-pagination') as HTMLElement | null;
  if (!el) return;
  if (!totalPages || totalPages <= 1) {
    el.innerHTML = '';
    el.style.display = 'none';
    return;
  }
  const btn = 'background:var(--av-surface-card); border:1px solid var(--av-border-default); color:var(--av-text-primary); padding:5px 12px; border-radius:8px; font-size:12px; cursor:pointer;';
  const dis = 'background:var(--av-surface-sunken); border:1px solid var(--av-border-subtle); color:var(--av-text-faint); padding:5px 12px; border-radius:8px; font-size:12px; cursor:not-allowed;';
  const prev = page > 1
    ? `<button data-page="${page - 1}" style="${btn}">← Trước</button>`
    : `<button disabled style="${dis}">← Trước</button>`;
  const next = page < totalPages
    ? `<button data-page="${page + 1}" style="${btn}">Sau →</button>`
    : `<button disabled style="${dis}">Sau →</button>`;
  el.innerHTML = prev
    + `<span style="margin:0 12px; color:var(--av-primary); font-weight:600;">Trang ${page} / ${totalPages}</span>`
    + next;
  el.style.display = 'flex';
}

function renderHistoryFilterInfo(total: number, filtered: boolean) {
  const el = $('history-filter-info');
  if (!el) return;
  if (filtered) {
    el.textContent = 'Tìm thấy ' + total + ' session';
    el.classList.remove('hidden');
  } else {
    el.textContent = '';
    el.classList.add('hidden');
  }
}

async function loadHistory(api: any, st: HistoryState, dead: () => boolean) {
  const params = new URLSearchParams();
  const filtered = historyHasActiveFilters(st);
  if (filtered) {
    if (st.search) params.set('search', st.search);
    if (st.sort) params.set('sort', st.sort);
    if (st.date_from) params.set('date_from', st.date_from);
    if (st.date_to) params.set('date_to', st.date_to);
  }
  params.set('page', String(st.page));
  params.set('page_size', String(st.page_size));

  let data: any;
  try {
    data = await api.get('/sessions?' + params.toString());
  } catch (err: any) {
    console.warn('Could not load sessions:', err && err.message);
    // Lỗi tải KHÔNG đồng nghĩa “chưa có session”. Hiện trạng thái lỗi riêng để
    // người học không hiểu nhầm lịch sử của mình đã bị mất.
    $('history-skeleton')?.classList.add('hidden');
    $('history-table-wrap')?.classList.add('hidden');
    $('history-empty')?.classList.add('hidden');
    $('history-error')?.classList.remove('hidden');
    const count = $('history-count');
    if (count) count.textContent = '— sessions';
    renderHistoryPagination(0, 0);
    renderHistoryFilterInfo(0, filtered);
    return;
  }
  if (dead()) return;
  const sessions = Array.isArray(data) ? data : (data.sessions || []);
  const total = Array.isArray(data) ? sessions.length : (data.total || 0);
  const totalPages = Array.isArray(data) ? 0 : (data.total_pages || 0);
  const currentPage = Array.isArray(data) ? 1 : (data.page || 1);
  renderHistory(sessions, total, st);
  renderHistoryPagination(currentPage, totalPages);
  renderHistoryFilterInfo(total, filtered);
}

// ── Dashboard ngữ pháp ──────────────────────────────────────────────────────

const grammarUrl = (slug?: string, category?: string) =>
  (!category || !slug) ? null
    : '/grammar/' + encodeURIComponent(category) + '/' + encodeURIComponent(slug);

/**
 * Khu dashboard ngữ pháp — BỐN mục, không phải một.
 *
 * Codex bắt ở PR #937: bản đầu của tôi chỉ vẽ `grammar_focus_this_week` nhưng
 * `hasAny` bật khi CÓ BẤT KỲ mục nào trong bốn. Người có "điểm yếu"/"đã lưu"/
 * "xem gần đây" mà không có pill sẽ thấy các TIÊU ĐỀ RỖNG — tức lộ khung mà
 * không có nội dung.
 *
 * Khuôn mỗi mục giống hệt nhau ở bản legacy nên gom thành `fillSection`:
 * đổ vào danh sách, rồi ẩn khung nếu không đổ được gì. Lưu ý ẩn khung là
 * THÊM `hidden`, không bao giờ gỡ — khung mặc định đã hiện trong vỏ (bản đầu
 * của tôi gỡ `hidden` khỏi `grammar-focus-wrap`, sai chiều).
 */
function fillSection(listId: string, wrapId: string, items: any[] | undefined,
                     make: (item: any) => HTMLElement | null) {
  const list = $(listId);
  const wrap = $(wrapId);
  if (!list || !wrap) return;
  if (items?.length) {
    items.forEach((it) => {
      const el = make(it);
      if (el) list.appendChild(el);
    });
    if (!list.children.length) wrap.classList.add('hidden');
  } else {
    wrap.classList.add('hidden');
  }
}

const anchor = (cls: string, href: string, html: string) => {
  const a = document.createElement('a');
  a.className = cls;
  a.href = href;
  a.innerHTML = html;
  return a;
};

async function loadGrammarDashboard(api: any, dead: () => boolean) {
  const loading = $('grammar-loading');
  const content = $('grammar-content');
  const empty = $('grammar-empty');
  let data: any;
  try {
    data = await api.get('/api/grammar/dashboard-data');
  } catch (err: any) {
    // Khu ngữ pháp là PHỤ — hỏng thì ẩn cả khu, đúng như legacy. Ẩn mỗi spinner
    // sẽ để lại một khung rỗng không bao giờ có nội dung.
    loading?.classList.add('hidden');
    $('grammar-dashboard-section')?.classList.add('hidden');
    console.warn('Grammar dashboard unavailable:', err?.message);
    return;
  }
  if (dead()) return;
  loading?.classList.add('hidden');

  const hasAny = (data?.grammar_focus_this_week?.length > 0)
    || (data?.weak_areas?.length > 0)
    || (data?.recently_viewed?.length > 0)
    || (data?.saved_articles?.length > 0);
  if (!hasAny) {
    empty?.classList.remove('hidden');
    return;
  }
  content?.classList.remove('hidden');

  // Mục "tập trung tuần này" phẳng hoá trước: mỗi item có thể mang nhiều bài,
  // và khi không có bài nào thì chính cái tag trở thành một pill.
  const focusItems = (data.grammar_focus_this_week || []).flatMap((item: any) => {
    const arts = item.articles || [];
    return arts.length
      ? arts.map((a: any) => ({ slug: a.slug, category: a.category, title: a.title }))
      : [{ slug: item.tag, category: item.category, title: item.tag }];
  });
  fillSection('grammar-focus-pills', 'grammar-focus-wrap', focusItems, (it) => {
    const url = grammarUrl(it.slug, it.category);
    return url ? anchor('grammar-pill', url,
      `<span>📖</span><span>${escHtml(it.title)}</span>`) : null;
  });

  // Điểm yếu: legacy giới hạn 5 mục.
  fillSection('grammar-weak-list', 'grammar-weak-wrap', (data.weak_areas || []).slice(0, 5), (it) => {
    const url = grammarUrl(it.tag, it.category);
    return url ? anchor('grammar-weak-item', url, `
                <span class="grammar-weak-dot"></span>
                <span class="text-sm font-medium flex-1" style="color:var(--av-text-primary);">${escHtml(it.label_vi || it.tag)}</span>
                <span class="text-xs" style="color:var(--av-text-muted);">${it.occurrence_count}× lỗi</span>`) : null;
  });

  fillSection('grammar-recent-list', 'grammar-recent-wrap', data.recently_viewed, (it) => {
    const url = grammarUrl(it.slug, it.category);
    return url ? anchor('grammar-recent-item', url, `
                <span class="text-sm" style="color:var(--av-text-secondary);">↗</span>
                <span class="text-sm flex-1" style="color:var(--av-text-secondary);">${escHtml(it.title || it.slug)}</span>
                <span class="text-xs" style="color:var(--av-text-faint);">${fmtRelTime(it.last_viewed_at)}</span>`) : null;
  });

  // "Đã lưu" là <div> bọc <a>, không phải <a> — giữ nguyên hình dạng legacy.
  fillSection('grammar-saved-list', 'grammar-saved-wrap', data.saved_articles, (it) => {
    const url = grammarUrl(it.slug, it.category);
    if (!url) return null;
    const div = document.createElement('div');
    div.className = 'grammar-saved-item';
    div.innerHTML = `
                <a href="${url}" class="text-sm flex-1" style="color:var(--av-text-primary);text-decoration:none;">
                  🔖 ${escHtml(it.title || it.slug)}
                </a>
                <span class="text-xs" style="color:var(--av-text-faint);">${fmtRelTime(it.saved_at)}</span>`;
    return div;
  });
}

// ── Cache SWR (CHỈ dữ liệu hiển thị) ────────────────────────────────────────
//
// `/api/dashboard/init` trả `{ summary, sessions, … }` — thuần dữ liệu hiển
// thị, KHÔNG có quyền/vai trò/is_active. Vì vậy được phép cache và vẽ ngay bản
// thấy-lần-trước rồi làm mới nền. Cố ý giới hạn ở dữ liệu hiển thị: quyền từ
// `/auth/me` KHÔNG BAO GIỜ được cache (quy tắc canonical-truth) — một người
// vừa bị thu quyền không được gác bằng trạng thái cũ trên máy họ.

function readDashCache(uid?: string) {
  if (!uid) return null;
  try {
    const raw = sessionStorage.getItem(dashKey(uid));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj.at !== 'number') return null;
    if (Date.now() - obj.at > DASH_SWR_TTL_MS) return null;
    return obj.data || null;
  } catch { return null; }
}

function writeDashCache(uid: string | undefined, data: any) {
  if (!uid || !data) return;
  try {
    sessionStorage.setItem(dashKey(uid), JSON.stringify({ at: Date.now(), data }));
  } catch { /* riêng tư / đầy — bỏ qua, cache là tuỳ chọn */ }
}

// ── Component ───────────────────────────────────────────────────────────────

export function SpeakingStats() {
  const { status, user } = useAuth();
  const ranRef = useRef(false);

  useEffect(() => {
    if (status !== 'signed-in' || ranRef.current) return;
    ranRef.current = true;

    let dead = false;
    const isDead = () => dead;
    const cleanups: Array<() => void> = [];
    const on = (el: Element | Document | null, ev: string, fn: any) => {
      if (!el) return;
      el.addEventListener(ev, fn);
      cleanups.push(() => el.removeEventListener(ev, fn));
    };

    const st: HistoryState = {
      search: '', sort: 'newest', date_from: '', date_to: '', page: 1, page_size: 20,
    };

    (async () => {
      const ok = await whenGlobalReady(
        () => typeof (window as any).api?.get === 'function',
        'window.api (speaking stats)',
      );
      if (dead || !ok) return;
      const api = (window as any).api;
      const uid = (user as any)?.id;

      // Vẽ NGAY bản cache (nếu còn hạn), rồi làm mới nền.
      const cached = readDashCache(uid);
      if (cached?.summary) {
        renderStats(cached.summary);
        renderCharts(cached.sessions || []);
      }
      // Đổi theme phải VẼ LẠI: màu đã tính thành chuỗi lúc vẽ, không lật theo
      // token được — nếu không, trục/lưới giữ màu cũ và có thể thành chữ đen
      // trên nền đen.
      cleanups.push(observeThemeFlip());
      cleanups.push(destroyCharts);

      // Khu ngữ pháp fetch riêng — hỏng nó không được kéo sập số liệu.
      loadGrammarDashboard(api, isDead);

      try {
        const agg = await api.get('/api/dashboard/init');
        if (dead) return;
        if (agg?.summary) {
          renderStats(agg.summary);
          renderCharts(agg.sessions || []);
          writeDashCache(uid, agg);
        }
      } catch {
        // Không có số liệu ⇒ vẫn phải giải quyết khung xương, nếu không nó
        // nhấp nháy mãi. `{}` cho mọi ô về '—'/0 và mở khối "chưa có gì".
        if (!dead) renderStats({});
      }

      await loadHistory(api, st, isDead);

      // ── Lọc + phân trang ────────────────────────────────────────────────
      on($('hf-apply'), 'click', () => {
        st.search = (($('hf-search') as HTMLInputElement | null)?.value || '').trim();
        st.sort = ($('hf-sort') as HTMLSelectElement | null)?.value || 'newest';
        st.date_from = ($('hf-date-from') as HTMLInputElement | null)?.value || '';
        st.date_to = ($('hf-date-to') as HTMLInputElement | null)?.value || '';
        st.page = 1;
        loadHistory(api, st, isDead);
      });
      on($('hf-clear'), 'click', () => {
        for (const id of ['hf-search', 'hf-date-from', 'hf-date-to']) {
          const el = $(id) as HTMLInputElement | null;
          if (el) el.value = '';
        }
        const sort = $('hf-sort') as HTMLSelectElement | null;
        if (sort) sort.value = 'newest';
        Object.assign(st, { search: '', sort: 'newest', date_from: '', date_to: '', page: 1 });
        loadHistory(api, st, isDead);
      });
      on($('history-pagination'), 'click', (e: any) => {
        const btn = e.target?.closest?.('button[data-page]');
        if (!btn) return;
        st.page = Number(btn.dataset.page) || 1;
        loadHistory(api, st, isDead);
      });
    })();

    return () => {
      dead = true;
      cleanups.forEach((fn) => fn());
    };
  }, [status, user]);

  return null;
}
