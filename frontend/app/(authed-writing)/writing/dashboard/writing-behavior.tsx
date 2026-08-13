'use client';

// WritingBehavior — PHẦN LÕI của tầng hành vi trang Writing Dashboard.
//
// PHẠM VI: quản lý toàn bộ hành vi học viên ở dashboard (Assignment + Essay +
// Tips + Prompt Bank tabs), modal nộp bài, timer countdown, autosave draft,
// anti-paste thresholds, spell check, file upload. Mỗi feature là hợp đồng
// chặn chẽ với backend endpoint và dữ liệu frontend.
//
// VÌ SAO VÁ THẲNG VÀO DOM: cùng lý do ở home-behavior.tsx — vỏ shell là Server
// Component tĩnh (PPR), dữ liệu riêng tư chỉ tới phía client qua `window.api`,
// và DOM là cổng parity G1. Hành vi cũng vậy — học viên bấm nút, modals mở,
// timers tick. Lớp này gắn listener vào các id từ page-shell.tsx.
//
// ANTI-PASTE CONTRACT (CI-gated):
//   < 50 ký tự    → silent, không ghi log
//   50–200 ký tự  → allow + POST /paste-log với blocked:false
//   > 200 ký tự   → preventDefault() + alert + POST /paste-log với blocked:true
// Thresholds là cổng đánh giá: thay đổi chúng phá test.
//
// SUBMIT PHẢI GỬI essay_text TƯỜNG MINH (requirement 3). Backend coi essay_text
// là tuỳ chọn và quay về draft cuối cùng nếu thiếu. Vì draft được lưu TRƯỚC
// sửa/paste của người dùng, nếu omit → nộp text cũ âm thầm, lỗi im lặng.
//
// LISTENER TRƯỚC AWAIT (requirement 4): tất cả addEventListener() phải chạy
// ĐỒNG BỘ trước khi `await` lần đầu. Nếu `await api.get()` trước khi gắn click
// listener, người dùng bấm trong khoảng đó rơi vào hư không. Đã xảy ra trên
// `/speaking`.
//
// GLOBALS: window.api, window.getSupabase(), window.renderMarkdown,
// window.WC?.escapeHtml, window.lucide được cung cấp bởi các script mà layout
// nạp. Không import, không gọi initSupabase() — AuthedShell đã làm rồi.

import { useEffect } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

/** Trạng thái toàn trang — giữ trong object để cleanup dứt điểm. */
type ModalState = {
  assignmentId: string | null;
  accountId: string | null;
  autoSaveTimer: NodeJS.Timeout | null;
  countdownInterval: NodeJS.Timeout | null;
  allowSoftCheck: boolean;
  returnFocus: HTMLElement | null;
  dead: boolean;
};

type PageState = {
  allEssays: any[];
  currentFilter: string;
  allTips: any[];
  tipsLoaded: boolean;
  tipFilter: string;
  tipTypeFilter: string;
  allPrompts: any[];
  pbRendered: boolean;
  pbFilter: string;
  writingPermitted: boolean;
  dead: boolean;
  generation: number;
};

type ListenerRegistrar = (el: Element | Document | null, ev: string, fn: any) => void;

// MỘT thực thể duy nhất cho mỗi loại trạng thái, đặt ở phạm vi module — y như
// bản legacy (`modalState` là biến toàn cục của trang).
//
// VÌ SAO KHÔNG TẠO TRONG effect: bản đầu của bản port này tạo `ms` lúc mount
// (listener đóng gói nó) NHƯNG `openSubmitModal()` lại tự tạo một `ms` MỚI mang
// `assignmentId`. Hai object khác nhau ⇒ nút Lưu/Nộp, tự lưu và nhật ký dán đều
// dừng ngay ở `if (!ms.assignmentId) return` — học viên không lưu và không nộp
// được gì. `loadEssays()` dính y hệt với `ps`: nó ghi danh sách bài vào một `ps`
// vứt đi, nên bấm bộ lọc là màn hình nhảy về trạng thái rỗng.
//
// Codex bắt cả hai ở #950. Cổng ghi cũng bắt được — nhưng CHỈ SAU KHI tôi phát
// hiện phép đo trước đó chạy nhầm vào một `next-server` cũ còn sót trên cổng
// 3011, tức nó đang đo chính trang legacy và báo xanh.
const modalState: ModalState = {
  assignmentId: null,
  accountId: null,
  autoSaveTimer: null,
  countdownInterval: null,
  allowSoftCheck: false,
  returnFocus: null,
  dead: false,
};

const pageState: PageState = {
  allEssays: [],
  currentFilter: 'all',
  allTips: [],
  tipsLoaded: false,
  tipFilter: 'all',
  tipTypeFilter: 'all',
  allPrompts: [],
  pbRendered: false,
  pbFilter: 'all',
  writingPermitted: true,
  dead: false,
  generation: 0,
};

/** Status mapping (Sprint 19.1A): 6 backend states → 4 UI states. */
const STATUS_CONFIG: Record<string, { text: string; pill: string; clickable: boolean }> = {
  pending:   { text: '⏳ Chờ chấm', pill: 'pill-wait',  clickable: false },
  submitted: { text: '⏳ Chờ chấm', pill: 'pill-wait',  clickable: false },
  grading:   { text: '⏳ Chờ chấm', pill: 'pill-wait',  clickable: false },
  graded:    { text: '⏳ Chờ chấm', pill: 'pill-wait',  clickable: false },
  reviewed:  { text: '⏳ Chờ chấm', pill: 'pill-wait',  clickable: false },
  delivered: { text: '✓ Đã chấm',  pill: 'pill-green', clickable: true  },
  failed:    { text: '⚠ Lỗi, liên hệ giảng viên', pill: 'pill-red', clickable: false },
  flagged:   { text: '⚠ Bị đánh dấu', pill: 'pill-amber', clickable: false },
};

const TASK_LABELS: Record<string, string> = {
  task1_academic: 'Task 1 (Academic)',
  task1_general:  'Task 1 (General)',
  task2:          'Task 2',
};

const ASSIGNMENT_STATUS: Record<string, { text: string; pill: string }> = {
  pending:     { text: '⏳ Chờ làm',       pill: 'pill-gray'   },
  in_progress: { text: '📝 Đang làm',      pill: 'pill-blue'   },
  submitted:   { text: '📥 Đã nộp',        pill: 'pill-amber'  },
  graded:      { text: '✓ Đã chấm',       pill: 'pill-purple' },
  delivered:   { text: '📨 Đã nhận xét',   pill: 'pill-green'  },
};

const ACTIVE_ASSIGNMENT_STATES = ['pending', 'in_progress'];

const PASTE_BLOCK_THRESHOLD = 200;
const PASTE_LOG_THRESHOLD = 50;

const TIP_TASK_LABELS: Record<string, string> = {
  task_1: 'Task 1', task_2: 'Task 2', both: 'Cả hai',
};

const TIP_TYPE_LABELS: Record<string, string> = {
  tip: '💡 Mẹo', knowledge: '📖 Kiến thức', sample: '✍️ Bài mẫu', outline: '🗂️ Dàn bài',
};

const PB_TASK_LABELS: Record<string, string> = {
  task1_academic: 'Task 1 Academic', task1_general: 'Task 1 General', task2: 'Task 2',
};

const $ = (id: string) => document.getElementById(id);
const val = (id: string) => ($(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? '';

function escapeHtml(s: any): string {
  if (typeof window !== 'undefined' && window.WC?.escapeHtml) {
    return window.WC.escapeHtml(s);
  }
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => {
    const chars: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return chars[c];
  });
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatRelativeTime(iso: string): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diffSec < 30) return 'vừa xong';
  if (diffSec < 60) return diffSec + ' giây trước';
  if (diffSec < 3600) return Math.floor(diffSec / 60) + ' phút trước';
  if (diffSec < 86400) return Math.floor(diffSec / 3600) + ' giờ trước';
  return formatDate(iso);
}

function countWords(text: string): number {
  const trimmed = (text || '').trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function formatTimer(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds <= 0) return 'Hết giờ';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
}

function show(id: string) {
  const el = $(id);
  if (el) el.classList.remove('hidden');
}

function hide(id: string) {
  const el = $(id);
  if (el) el.classList.add('hidden');
}

function showTimerToast(message: string) {
  const toast = document.createElement('div');
  toast.className = 'fixed top-4 right-4 z-[60] px-4 py-3 rounded shadow-lg font-medium';
  toast.style.background = '#f59e0b';
  toast.style.color = '#0a1628';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => { toast.remove(); }, 5000);
}

function showSubmissionNotice(kind: 'success' | 'warning' | 'error', message: string) {
  const notice = $('writing-submit-notice');
  if (!notice) return;
  notice.className = 'wd-submit-notice is-' + kind;
  notice.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  notice.textContent = message;
  notice.classList.remove('hidden');
}

function hideSubmissionNotice() {
  const notice = $('writing-submit-notice');
  if (notice) notice.classList.add('hidden');
}

function statusCode(err: any): number | null {
  const value = Number(err && err.status);
  return Number.isFinite(value) ? value : null;
}

function isDefinitiveSubmitRejection(err: any): boolean {
  const status = statusCode(err);
  return status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

async function reconcileSubmission(receipt: any, api: any): Promise<any | null> {
  const helper = (window as any).WritingSubmitReceipt;
  try {
    const raw = await api.get(
      '/api/writing/my-assignments/' + encodeURIComponent(receipt.assignmentId) +
      '/submission?request_id=' + encodeURIComponent(receipt.requestId)
    );
    const ack = helper?.normalizeAck(raw, receipt.assignmentId);
    if (!ack) throw new Error('Biên nhận nộp bài không khớp assignment.');
    helper.remove(receipt.account, receipt.assignmentId);
    return ack;
  } catch (err: any) {
    if (statusCode(err) === 404) return null;
    throw err;
  }
}

async function reconcilePendingSubmissions(accountId: string, api: any) {
  const helper = (window as any).WritingSubmitReceipt;
  const pending = helper?.list(accountId) || [];
  let confirmed = 0;
  let superseded = 0;
  for (const receipt of pending) {
    try {
      if (await reconcileSubmission(receipt, api)) confirmed += 1;
    } catch (err) {
      if (statusCode(err) === 409) {
        helper.remove(accountId, receipt.assignmentId);
        superseded += 1;
      }
      // Preserve ambiguous receipts and surface one truthful warning below.
    }
  }
  if (modalState.accountId !== accountId) return;
  if (confirmed > 0 || superseded > 0) {
    showSubmissionNotice(
      confirmed > 0 ? 'success' : 'warning',
      confirmed > 0
        ? 'Đã đối chiếu: bài viết của em đã được nộp thành công.'
        : 'Bài đã được nộp ở một tab khác. Danh sách đã được đồng bộ lại.'
    );
    await Promise.all([loadAssignments(api), loadEssays(api)]);
  } else if (pending.length > 0) {
    showSubmissionNotice(
      'warning',
      'Có một bài nộp chưa nhận được xác nhận. Mở lại bài để đối chiếu hoặc gửi lại an toàn với cùng mã yêu cầu.'
    );
  }
}

function renderStudent(student: any) {
  const s = student || {};
  const greetingEl = $('greeting-name');
  if (greetingEl) greetingEl.textContent = s.full_name || 'em';
  const codeEl = $('student-code');
  if (codeEl) codeEl.textContent = s.student_code || '—';
  if (s.target_band != null) {
    const bandEl = $('target-band');
    if (bandEl) bandEl.textContent = s.target_band;
    show('target-band-section');
  }
}

function _bandClass(band: any): string {
  const n = parseFloat(band);
  if (isNaN(n)) return 'mid';
  if (n < 5) return 'low';
  if (n < 6) return 'mid';
  if (n < 7) return 'good';
  return 'high';
}

function _filterEssays(essays: any[], filter: string): any[] {
  if (filter === 'delivered') return essays.filter((e) => e.status === 'delivered');
  if (filter === 'pending') {
    return essays.filter((e) => ['grading', 'graded', 'reviewed', 'submitted', 'pending'].includes(e.status));
  }
  if (filter === 'flagged') return essays.filter((e) => !!e.is_flagged);
  return essays;
}

function _updateFilterCounts(essays: any[]) {
  const counts: Record<string, number> = {
    all: essays.length,
    delivered: _filterEssays(essays, 'delivered').length,
    pending: _filterEssays(essays, 'pending').length,
    flagged: _filterEssays(essays, 'flagged').length,
  };
  Object.keys(counts).forEach((k) => {
    const el = $('filter-count-' + k);
    if (el) el.textContent = String(counts[k]);
  });
}

function _tipPreview(md: string): string {
  const t = String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > 140 ? t.slice(0, 140).trim() + '…' : t;
}

function _tipSnippet(t: any): string {
  const td = t.type_data || {};
  if (t.content_type === 'sample') {
    const bits = [];
    if (td.target_band != null) bits.push('Band mục tiêu: ' + td.target_band);
    if (td.word_count != null) bits.push(td.word_count + ' từ');
    return bits.join(' · ') || _tipPreview(t.body_markdown);
  }
  if (t.content_type === 'outline') {
    const s = Array.isArray(td.structure) ? td.structure : [];
    if (s.length && s[0] && s[0].heading) {
      return 'Dàn bài: ' + s.map((i: any) => i.heading).filter(Boolean).slice(0, 4).join(' → ');
    }
    return _tipPreview(t.body_markdown);
  }
  return _tipPreview(t.body_markdown);
}

function renderEssays(essays: any[], ps: PageState) {
  const list = $('essays-list');
  if (!list) return;

  essays = essays || [];
  ps.allEssays = essays;
  _updateFilterCounts(essays);

  if (essays.length === 0) {
    show('empty-state');
    hide('filter-empty-state');
    list.innerHTML = '';
    return;
  }
  hide('empty-state');

  const filtered = _filterEssays(essays, ps.currentFilter);
  if (filtered.length === 0) {
    show('filter-empty-state');
    list.innerHTML = '';
    return;
  }
  hide('filter-empty-state');

  list.innerHTML = filtered.map((e: any) => {
    const status = e.is_flagged ? STATUS_CONFIG.flagged : (STATUS_CONFIG[e.status] || STATUS_CONFIG.pending);
    const task = TASK_LABELS[e.task_type] || 'Bài viết';
    const date = formatDate(e.created_at);
    const clickable = status.clickable;
    const cardClass = 'essay-card' + (clickable ? ' clickable' : '');
    const openAttrs = clickable ? ' role="link" tabindex="0"' : '';
    const arrow = clickable ? '<span class="essay-card__view">Xem →</span>' : '';
    const essayIdAttr = ' data-essay-id="' + escapeHtml(e.id) + '"';

    const isGraded = !e.is_flagged && e.status === 'delivered';
    let bandPill = '';
    if (e.overall_band_score != null && isGraded) {
      const bc = _bandClass(e.overall_band_score);
      bandPill = '<span class="essay-band-pill band-' + bc + '">Band ' + escapeHtml(String(e.overall_band_score)) + '</span>';
    }

    const dlBtn = isGraded
      ? '<button type="button" class="essay-dl-btn"' + essayIdAttr + ' aria-label="Tải bài đã chấm định dạng Word">⬇ .docx</button>'
      : '';

    const newBadge = e.has_new_feedback
      ? '<span class="essay-new-badge" title="Bạn có nhận xét mới chưa xem">Mới</span>'
      : '';

    const footerLeft = bandPill;
    const hasFooter = footerLeft || dlBtn || arrow;

    return (
      '<div class="' + cardClass + '"' + essayIdAttr + openAttrs + '>' +
        '<div class="flex items-center justify-between gap-3 mb-2">' +
          '<span class="text-xs text-gray-300 font-medium">' + escapeHtml(task) + ' · ' + escapeHtml(date) + '</span>' +
          '<div class="flex items-center gap-1">' +
            newBadge +
            '<span class="pill ' + status.pill + '">' + escapeHtml(status.text) + '</span>' +
          '</div>' +
        '</div>' +
        '<p class="text-sm text-gray-200 mb-2 line-clamp-2">' + escapeHtml(e.prompt_preview || '') + '</p>' +
        (hasFooter
          ? '<div class="flex items-center justify-between gap-2 mt-1">' +
              footerLeft +
              '<div class="essay-card__actions">' + dlBtn + arrow + '</div>' +
            '</div>'
          : '') +
      '</div>'
    );
  }).join('');

  attachEssayCardClickListeners();
  attachEssayDownloadListeners();
}

function attachEssayCardClickListeners() {
  const cards = document.querySelectorAll<HTMLElement>('.essay-card.clickable');
  cards.forEach((card) => {
    const goToDetail = () => {
      const essayId = card.getAttribute('data-essay-id');
      if (!essayId) return;
      try {
        if (window.api && window.api.post) {
          window.api.post('/api/analytics/events', {
            event_name: 'prompt_view',
            event_data: { essay_id: essayId, source: 'writing-dashboard' },
          }).catch(() => {});
        }
      } catch {}
      window.location.href = '/writing/result?essay_id=' + encodeURIComponent(essayId);
    };
    card.addEventListener('click', goToDetail);
    card.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        goToDetail();
      }
    });
  });
}

async function downloadEssayDocx(essayId: string, btn: HTMLElement | null) {
  if (!essayId) return;
  const orig = btn ? btn.innerHTML : '';
  if (btn) { (btn as any).disabled = true; btn.innerHTML = '⏳'; }
  try {
    const sb = (window as any).getSupabase?.();
    const session = (await sb.auth.getSession()).data.session;
    if (!session) { window.location.href = '/login.html'; return; }
    const url = (window as any).api.base + '/api/writing/my-essays/' +
      encodeURIComponent(essayId) + '/export.docx';
    const res = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + session.access_token },
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).detail || ''; } catch {}
      throw new Error('HTTP ' + res.status + (detail ? ': ' + detail : ''));
    }
    const cd = res.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename="([^"]+)"/);
    const filename = m ? m[1] : ('essay_' + essayId + '.docx');
    const blob = await res.blob();
    const dl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = dl; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(dl);
  } catch (err: any) {
    alert('Lỗi tải file: ' + ((err && err.message) || 'không xác định'));
  } finally {
    if (btn) { (btn as any).disabled = false; btn.innerHTML = orig; }
  }
}

function attachEssayDownloadListeners() {
  document.querySelectorAll<HTMLElement>('.essay-dl-btn').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      downloadEssayDocx(btn.getAttribute('data-essay-id') || '', btn);
    });
    btn.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.stopPropagation(); }
    });
  });
}

function wireEssayFilterTabs(ps: PageState, on: ListenerRegistrar) {
  const btns = document.querySelectorAll<HTMLElement>('.essay-filter-btn');
  btns.forEach((btn) => {
    on(btn, 'click', () => {
      const f = btn.getAttribute('data-filter');
      if (f) ps.currentFilter = f;
      btns.forEach((b) => b.classList.toggle('is-active', b === btn));
      renderEssays(ps.allEssays, ps);
    });
  });
}

async function loadTips(api: any, ps: PageState) {
  const generation = ps.generation;
  hide('tips-empty'); hide('tips-error'); hide('tips-list');
  const loadingEl = $('tips-loading');
  if (loadingEl) loadingEl.classList.remove('hidden');
  try {
    const data = await api.get('/api/writing/tips');
    if (ps.dead || ps.generation !== generation) return;
    ps.allTips = (data && data.tips) || [];
    ps.tipsLoaded = true;
    hide('tips-loading');
    renderTips(ps);
  } catch (err: any) {
    if (ps.dead || ps.generation !== generation) return;
    hide('tips-loading');
    const errMsg = $('tips-error-msg');
    if (errMsg) errMsg.textContent = 'Không tải được mẹo viết: ' + ((err && err.message) || 'lỗi không xác định');
    show('tips-error');
  }
}

function renderTips(ps: PageState) {
  const list = $('tips-list');
  if (!list) return;
  hide('tips-loading'); hide('tips-error');

  if (ps.allTips.length === 0) {
    list.innerHTML = '';
    hide('tips-list');
    show('tips-empty');
    return;
  }
  hide('tips-empty');

  const filtered = ps.allTips.filter((t: any) => {
    const taskOk = ps.tipFilter === 'all' || t.task_type === ps.tipFilter;
    const typeOk = ps.tipTypeFilter === 'all' || (t.content_type || 'tip') === ps.tipTypeFilter;
    return taskOk && typeOk;
  });

  if (filtered.length === 0) {
    list.innerHTML = '<div class="wd-empty wd-empty--compact"><p class="wd-empty__hint">Không có nội dung nào cho bộ lọc này.</p></div>';
    show('tips-list');
    return;
  }

  list.innerHTML = filtered.map((t: any) => {
    const ctype = t.content_type || 'tip';
    const typePill = '<span class="tip-card__type tip-card__type--' + escapeHtml(ctype) + '">' +
      escapeHtml(TIP_TYPE_LABELS[ctype] || ctype) + '</span>';
    const taskPill = '<span class="pill pill-wait">' +
      escapeHtml(TIP_TASK_LABELS[t.task_type] || t.task_type) + '</span>';
    const catPill = t.category ? '<span class="tip-card__cat">' + escapeHtml(t.category) + '</span>' : '';
    return (
      '<div class="essay-card tip-card clickable" role="link" tabindex="0"' +
          ' data-tip-id="' + escapeHtml(t.id) + '">' +
        '<div class="flex items-center justify-between gap-3 mb-2">' +
          '<h3 class="tip-card__title font-semibold">' + escapeHtml(t.title || '(Mẹo viết)') + '</h3>' +
          '<div class="flex items-center gap-1 flex-shrink-0 flex-wrap justify-end">' + typePill + catPill + taskPill + '</div>' +
        '</div>' +
        '<p class="tip-card__preview text-sm text-gray-300 line-clamp-2">' + escapeHtml(_tipSnippet(t)) + '</p>' +
        '<div class="flex justify-end mt-2"><span class="essay-card__view">Đọc →</span></div>' +
      '</div>'
    );
  }).join('');
  show('tips-list');

  list.querySelectorAll<HTMLElement>('.tip-card').forEach((card) => {
    const go = () => {
      const id = card.getAttribute('data-tip-id');
      const tip = ps.allTips.find((t: any) => t.id === id);
      openTipModal(tip, ps);
    };
    card.addEventListener('click', go);
    card.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); }
    });
  });
}

function wireTipFilterTabs(ps: PageState, on: ListenerRegistrar) {
  [['[data-tip-filter]', 'data-tip-filter', 'task'],
   ['[data-tip-type-filter]', 'data-tip-type-filter', 'type']].forEach((g: any) => {
    const btns = document.querySelectorAll<HTMLElement>(g[0]);
    btns.forEach((btn) => {
      on(btn, 'click', () => {
        if (g[2] === 'task') ps.tipFilter = btn.getAttribute(g[1]) || 'all';
        else ps.tipTypeFilter = btn.getAttribute(g[1]) || 'all';
        btns.forEach((b) => b.classList.toggle('is-active', b === btn));
        renderTips(ps);
      });
    });
  });
}

function openTipModal(tip: any, ps: PageState) {
  if (!tip) return;
  const ctype = tip.content_type || 'tip';
  try {
    if (window.api && window.api.post) {
      window.api.post('/api/analytics/events', {
        event_name: 'writing_tip_view',
        event_data: { tip_id: tip.id, content_type: ctype, task_type: tip.task_type },
      }).catch(() => {});
    }
  } catch {}
  const titleEl = $('tip-modal-title');
  if (titleEl) titleEl.textContent = tip.title || '';
  const meta = [TIP_TYPE_LABELS[ctype] || ctype, TIP_TASK_LABELS[tip.task_type] || tip.task_type];
  if (tip.category) meta.push(tip.category);
  const metaEl = $('tip-modal-meta');
  if (metaEl) metaEl.textContent = meta.join(' · ');

  const td = tip.type_data || {};
  let head = '';
  if (ctype === 'sample') {
    const bits = [];
    if (td.target_band != null) bits.push('🎯 Band mục tiêu: <strong>' + escapeHtml(String(td.target_band)) + '</strong>');
    if (td.word_count != null) bits.push('✏️ Số từ: <strong>' + escapeHtml(String(td.word_count)) + '</strong>');
    if (bits.length) head = '<div class="tip-modal-meta-strip">' + bits.join(' &nbsp;·&nbsp; ') + '</div>';
  } else if (ctype === 'outline' && Array.isArray(td.structure) && td.structure.length) {
    head = '<div class="tip-modal-outline"><ol>' + td.structure.map((s: any) => {
      const pts = Array.isArray(s.points) && s.points.length
        ? '<ul>' + s.points.map((p: any) => '<li>' + escapeHtml(String(p)) + '</li>').join('') + '</ul>'
        : '';
      return '<li><strong>' + escapeHtml(String(s.heading || '')) + '</strong>' + pts + '</li>';
    }).join('') + '</ol></div>';
  }

  const bodyHtml = (window as any).renderMarkdown ? (window as any).renderMarkdown(tip.body_markdown) : '';
  const bodyEl = $('tip-modal-body');
  if (bodyEl) bodyEl.innerHTML = head + bodyHtml;
  const modal = $('tip-modal');
  if (modal) modal.classList.remove('hidden');
  if ((window as any).lucide && (window as any).lucide.createIcons) (window as any).lucide.createIcons();
}

function closeTipModal() {
  const modal = $('tip-modal');
  if (modal) modal.classList.add('hidden');
}

async function loadPromptBank(api: any, ps: PageState) {
  const generation = ps.generation;
  try {
    const data = await api.get('/api/writing/prompt-bank');
    if (ps.dead || ps.generation !== generation) return;
    if (!data || data.enabled !== true) return;
    ps.allPrompts = (data.prompts) || [];
    if (!ps.allPrompts.length) return;
    const btn = $('tab-prompt-bank');
    if (btn) btn.hidden = false;
  } catch {}
}

function renderPromptBank(ps: PageState) {
  ps.pbRendered = true;
  const list = $('pb-list');
  if (!list) return;
  const filtered = ps.pbFilter === 'all'
    ? ps.allPrompts
    : ps.allPrompts.filter((p: any) => p.task_type === ps.pbFilter);
  if (!filtered.length) {
    list.innerHTML = '<div class="wd-empty wd-empty--compact"><p class="wd-empty__hint">Không có đề nào trong nhóm này.</p></div>';
    return;
  }
  list.innerHTML = filtered.map((p: any) => {
    const taskPill = '<span class="pill pill-wait">' + escapeHtml(PB_TASK_LABELS[p.task_type] || p.task_type) + '</span>';
    const diff = p.difficulty ? '<span class="tip-card__cat">' + escapeHtml(p.difficulty) + '</span>' : '';
    const imgFlag = p.prompt_image_url ? ' 🖼️' : '';
    return (
      '<div class="essay-card tip-card clickable" role="link" tabindex="0"' +
          ' data-pb-id="' + escapeHtml(p.id) + '">' +
        '<div class="flex items-center justify-between gap-3 mb-2">' +
          '<h3 class="tip-card__title font-semibold">' + escapeHtml(p.title || '(Đề bài)') + imgFlag + '</h3>' +
          '<div class="flex items-center gap-1 flex-shrink-0 flex-wrap justify-end">' + diff + taskPill + '</div>' +
        '</div>' +
        '<p class="tip-card__preview text-sm text-gray-300 line-clamp-2">' + escapeHtml(p.prompt_text || '') + '</p>' +
        '<div class="flex justify-end mt-2"><span class="essay-card__view">Đọc đề →</span></div>' +
      '</div>'
    );
  }).join('');

  list.querySelectorAll<HTMLElement>('.tip-card').forEach((card) => {
    const go = () => {
      const id = card.getAttribute('data-pb-id');
      const p = ps.allPrompts.find((x: any) => String(x.id) === id);
      openPromptModal(p, ps);
    };
    card.addEventListener('click', go);
    card.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); }
    });
  });
}

function wirePromptFilterTabs(ps: PageState, on: ListenerRegistrar) {
  const btns = document.querySelectorAll<HTMLElement>('[data-pb-filter]');
  btns.forEach((btn) => {
    on(btn, 'click', () => {
      ps.pbFilter = btn.getAttribute('data-pb-filter') || 'all';
      btns.forEach((b) => b.classList.toggle('is-active', b === btn));
      renderPromptBank(ps);
    });
  });
}

function openPromptModal(p: any, ps: PageState) {
  if (!p) return;
  try {
    if (window.api && window.api.post) {
      window.api.post('/api/analytics/events', {
        event_name: 'prompt_bank_view',
        event_data: { prompt_id: p.id, task_type: p.task_type },
      }).catch(() => {});
    }
  } catch {}
  const titleEl = $('tip-modal-title');
  if (titleEl) titleEl.textContent = p.title || '(Đề bài)';
  const meta = [PB_TASK_LABELS[p.task_type] || p.task_type];
  if (p.difficulty) meta.push(p.difficulty);
  const metaEl = $('tip-modal-meta');
  if (metaEl) metaEl.textContent = meta.join(' · ');
  const img = p.prompt_image_url ? '<img src="' + escapeHtml(p.prompt_image_url) + '" alt="Đề Task 1" class="pb-modal-img" />' : '';
  const bodyEl = $('tip-modal-body');
  if (bodyEl) bodyEl.innerHTML = img + '<p class="pb-modal-text">' + escapeHtml(p.prompt_text || '') + '</p>';
  const modal = $('tip-modal');
  if (modal) modal.classList.remove('hidden');
}

function formatDeadline(iso: string | null | undefined): { urgency: string; label: string } | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  const diffHrs = (t - Date.now()) / 3600000;
  if (diffHrs < 0) {
    const od = Math.floor(-diffHrs / 24);
    return { urgency: 'overdue', label: od >= 1 ? 'Quá hạn ' + od + ' ngày' : 'Quá hạn hôm nay' };
  }
  if (diffHrs < 24) {
    const h = Math.max(1, Math.round(diffHrs));
    return { urgency: 'urgent', label: 'Còn ' + h + ' giờ' };
  }
  const days = Math.ceil(diffHrs / 24);
  return { urgency: diffHrs < 72 ? 'soon' : 'normal', label: 'Còn ' + days + ' ngày' };
}

function renderDeadlines(assignments: any[]) {
  const surface = $('deadlines-surface');
  const list = $('deadlines-list');
  if (!surface || !list) return;

  const withDeadline = (assignments || [])
    .filter((a: any) => a.deadline)
    .sort((a: any, b: any) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());

  if (withDeadline.length === 0) {
    surface.classList.add('hidden');
    list.innerHTML = '';
    return;
  }
  surface.classList.remove('hidden');

  list.innerHTML = withDeadline.map((a: any) => {
    const prompt = a.writing_prompts || {};
    const dl = formatDeadline(a.deadline) || { urgency: 'normal', label: '' };
    return (
      '<button type="button" class="wd-deadline-row wd-deadline-row--' + dl.urgency + '"' +
          ' data-assignment-id="' + escapeHtml(a.id) + '">' +
        '<span class="wd-deadline-row__dot" aria-hidden="true"></span>' +
        '<span class="wd-deadline-row__title">' + escapeHtml(prompt.title || '(Đề bài)') + '</span>' +
        '<span class="wd-deadline-row__when">' + escapeHtml(dl.label) + '</span>' +
      '</button>'
    );
  }).join('');

  list.querySelectorAll<HTMLElement>('.wd-deadline-row').forEach((row) => {
    row.addEventListener('click', () => {
      const id = row.getAttribute('data-assignment-id');
      if (id) openSubmitModal(id, window as any, (window as any).api);
    });
  });
}

function buildAssignmentCardHtml(a: any): string {
  const prompt = a.writing_prompts || {};
  const statusKey = a.status || 'pending';
  const statusCfg = ASSIGNMENT_STATUS[statusKey] || ASSIGNMENT_STATUS.pending;
  const taskLabel = TASK_LABELS[prompt.task_type] || 'Bài viết';

  let draftHint = '';
  if (a.has_draft) {
    const rel = a.draft_updated_at ? ' · ' + formatRelativeTime(a.draft_updated_at) : '';
    draftHint = '<p class="text-xs text-gray-400 mb-3">📝 Bản nháp: ' +
      (a.draft_word_count || 0) + ' từ' + escapeHtml(rel) + '</p>';
  }

  const deadlineLine = a.deadline
    ? '<span class="text-xs text-amber-300">Hạn: ' + formatDate(a.deadline) + '</span>'
    : '';

  const startLabel = a.has_draft ? 'Tiếp tục làm bài' : 'Làm bài';

  return (
    '<div class="assignment-card" data-assignment-id="' + escapeHtml(a.id) + '">' +
      '<div class="flex items-start justify-between gap-3 mb-2">' +
        '<div class="min-w-0">' +
          '<h3 class="font-semibold text-gray-100 truncate">' + escapeHtml(prompt.title || '(Đề bài đã xóa)') + '</h3>' +
          '<div class="flex items-center gap-2 mt-1 flex-wrap">' +
            '<span class="pill ' + statusCfg.pill + '">' + escapeHtml(statusCfg.text) + '</span>' +
            '<span class="text-xs text-gray-400">' + escapeHtml(taskLabel) + '</span>' +
            (a.is_timed && a.time_limit_minutes
              ? '<span class="pill pill-timed">⏱️ ' + a.time_limit_minutes + ' phút</span>'
              : '') +
          '</div>' +
        '</div>' +
        deadlineLine +
      '</div>' +
      draftHint +
      '<button type="button" class="btn-start-assignment text-sm px-4 py-2 rounded font-medium">' +
        escapeHtml(startLabel) + ' →' +
      '</button>' +
    '</div>'
  );
}

function renderAssignments(assignments: any[]) {
  const list = $('assignments-list');
  const empty = $('assignments-empty');

  if (!assignments || assignments.length === 0) {
    if (list) list.innerHTML = '';
    if (empty) show('assignments-empty');
    return;
  }
  if (empty) empty.classList.add('hidden');

  const groups: any[] = [];
  const byKey: Record<string, any> = {};
  assignments.forEach((a: any) => {
    const gid = a.assignment_group_id;
    const key = gid ? ('g:' + gid) : ('s:' + a.id);
    if (!byKey[key]) {
      byKey[key] = { grouped: !!gid, name: a.name || null, rows: [] };
      groups.push(byKey[key]);
    }
    byKey[key].rows.push(a);
  });

  if (list) {
    list.innerHTML = groups.map((g: any) => {
      const cards = g.rows.map(buildAssignmentCardHtml).join('');
      if (!g.grouped) return cards;
      const head = '<h3 class="font-semibold text-gray-200 mb-2 mt-1">📚 ' +
        escapeHtml(g.name || 'Bài giao') +
        ' <span class="text-xs text-gray-400">· ' + g.rows.length + ' bài</span></h3>';
      return '<div class="assignment-group">' + head +
        '<div class="space-y-3 pl-1">' + cards + '</div></div>';
    }).join('');

    list.querySelectorAll<HTMLElement>('.btn-start-assignment').forEach((btn) => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.assignment-card');
        if (!card) return;
        const assignmentId = card.getAttribute('data-assignment-id');
        if (assignmentId) openSubmitModal(assignmentId, window as any, (window as any).api);
      });
    });
  }
}

function updateModalWordCount() {
  const textarea = $('modal-essay-textarea') as HTMLTextAreaElement | null;
  const wc = countWords(textarea ? textarea.value : '');
  const counter = $('modal-word-counter');
  if (counter) counter.textContent = String(wc);
  const target = Number(textarea?.dataset.wordTarget || 0);
  const targetEl = $('modal-word-target');
  const progressEl = $('modal-word-progress') as HTMLElement | null;
  if (targetEl && target > 0) {
    const remaining = Math.max(0, target - wc);
    targetEl.textContent = remaining > 0
      ? 'Mục tiêu tối thiểu ' + target + ' từ · còn ' + remaining + ' từ'
      : 'Đã đạt mục tiêu tối thiểu ' + target + ' từ';
    targetEl.classList.toggle('is-met', remaining === 0);
  }
  if (progressEl) {
    const progress = target > 0 ? Math.min(100, Math.round((wc / target) * 100)) : 0;
    progressEl.style.width = progress + '%';
    progressEl.classList.toggle('is-met', target > 0 && wc >= target);
  }
}

function scheduleModalAutoSave(ms: ModalState) {
  if (ms.autoSaveTimer) clearTimeout(ms.autoSaveTimer);
  const pendingEl = $('modal-save-pending');
  if (pendingEl) pendingEl.classList.remove('hidden');
  const statusEl = $('modal-save-status');
  if (statusEl) statusEl.classList.add('hidden');
  ms.autoSaveTimer = setTimeout(() => saveDraft(ms), 3000);
}

async function saveDraft(ms: ModalState) {
  if (!ms.assignmentId) return;
  const pending = $('modal-save-pending');
  const saved = $('modal-save-status');
  const textarea = $('modal-essay-textarea') as HTMLTextAreaElement | null;

  if (pending) pending.classList.remove('hidden');
  if (saved) saved.classList.add('hidden');

  try {
    await (window as any).api.patch(
      '/api/writing/my-assignments/' + encodeURIComponent(ms.assignmentId) + '/draft',
      { draft_text: textarea ? textarea.value || '' : '' }
    );
    if (pending) pending.classList.add('hidden');
    if (saved) saved.classList.remove('hidden');
    setTimeout(() => { if (saved) saved.classList.add('hidden'); }, 2000);
  } catch (err: any) {
    if (pending) pending.classList.add('hidden');
    const msg = (err && err.message) || 'lỗi khi lưu';
    if (msg.indexOf('Hết giờ') !== -1) {
      showTimerToast('⏰ Hết giờ — đang nộp bài tự động.');
      await submitFromModal(ms, true);
      return;
    }
    alert('Không lưu được bản nháp: ' + msg);
  }
}

function startModalCountdown(ms: ModalState, initialSeconds: number) {
  if (ms.countdownInterval) {
    clearInterval(ms.countdownInterval);
  }

  let remaining = initialSeconds;
  let lastSync = Date.now();
  let warned5min = false;
  const displayEl = $('modal-timer-display') as HTMLElement | null;

  ms.countdownInterval = setInterval(async () => {
    remaining -= 1;
    if (displayEl) displayEl.textContent = formatTimer(remaining);

    if (remaining <= 300 && displayEl && !displayEl.classList.contains('text-red-500')) {
      displayEl.classList.remove('text-amber-400');
      displayEl.classList.add('text-red-500');
    }
    if (!warned5min && remaining <= 300 && remaining > 295) {
      warned5min = true;
      showTimerToast('⚠️ Còn 5 phút!');
    }

    if (remaining <= 0) {
      if (ms.countdownInterval) clearInterval(ms.countdownInterval);
      ms.countdownInterval = null;
      showTimerToast('⏰ Hết giờ! Đang nộp bài…');
      await submitFromModal(ms, true);
      return;
    }

    if (Date.now() - lastSync > 30000) {
      lastSync = Date.now();
      try {
        // Chụp id ra biến cục bộ TRƯỚC khi await. Hai lý do, và lý do thứ hai
        // mới là lý do thật: (1) TypeScript không thu hẹp được `string | null`
        // xuyên qua closure bất đồng bộ; (2) modal có thể ĐÃ ĐÓNG trong lúc chờ
        // — đọc `ms.assignmentId` sau await là đọc trạng thái của bài KHÁC.
        const aid = ms.assignmentId;
        if (!aid) return;
        const fresh = await (window as any).api.get(
          '/api/writing/my-assignments/' + encodeURIComponent(aid) + '/timer'
        );
        if (fresh && fresh.is_expired) {
          remaining = 0;
        } else if (fresh && typeof fresh.time_remaining_seconds === 'number') {
          if (Math.abs(fresh.time_remaining_seconds - remaining) > 10) {
            remaining = fresh.time_remaining_seconds;
          }
        }
      } catch (e) {
        console.warn('Timer sync failed:', e);
      }
    }
  }, 1000);
}

function setupAntiPaste(textarea: HTMLTextAreaElement, ms: ModalState, on: ListenerRegistrar) {
  on(textarea, 'paste', async (ev: ClipboardEvent) => {
    const clip = ev.clipboardData || (window as any).clipboardData;
    const pasted = clip ? clip.getData('text') : '';
    const len = (pasted || '').length;

    if (len > PASTE_BLOCK_THRESHOLD) {
      ev.preventDefault();
      alert('⚠ Không cho phép paste nội dung dài (' + len + ' ký tự). Vui lòng tự gõ bài.');
      if (ms.assignmentId) {
        try {
          await (window as any).api.post(
            '/api/writing/my-assignments/' + encodeURIComponent(ms.assignmentId) + '/paste-log',
            { char_count: len, blocked: true }
          );
        } catch (e) {
          console.warn('Paste log failed:', e);
        }
      }
      return;
    }

    if (len > PASTE_LOG_THRESHOLD && ms.assignmentId) {
      try {
        await (window as any).api.post(
          '/api/writing/my-assignments/' + encodeURIComponent(ms.assignmentId) + '/paste-log',
          { char_count: len, blocked: false }
        );
      } catch (e) {
        console.warn('Paste log failed:', e);
      }
    }
  });
}

let _spellInstance: any = null;
let _spellLoading: any = null;

function loadSpell() {
  if (_spellInstance) return Promise.resolve(_spellInstance);
  if (_spellLoading) return _spellLoading;
  _spellLoading = (async () => {
    // Đường dẫn đi qua BIẾN, không viết thẳng vào `import()`. Bản legacy nạp
    // bằng URL tuyệt đối tới một tệp trong `public/`; nếu viết nguyên văn thì
    // TypeScript đòi phân giải nó lúc biên dịch và báo TS2307 (nó không biết
    // `public/` được phục vụ ở gốc web). Biến giữ nguyên hành vi lúc chạy —
    // trình duyệt vẫn nạp đúng tệp đó — mà không bắt trình biên dịch đoán.
    const spellUrl = '/assets/vendor/nspell.bundle.js';
    const mod: any = await import(/* webpackIgnore: true */ spellUrl);
    const nspell = mod.default || mod;
    const pair = await Promise.all([
      fetch('/assets/dict/en.aff').then((r) => r.text()),
      fetch('/assets/dict/en.dic').then((r) => r.text()),
    ]);
    _spellInstance = nspell(pair[0], pair[1]);
    return _spellInstance;
  })();
  return _spellLoading;
}

async function runSpellCheck(text: string) {
  const spell = await loadSpell();
  const words = (text.match(/[A-Za-z][A-Za-z']*/g) || []);
  const seen: Record<string, boolean> = {};
  const issues: any[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const key = w.toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    if (!spell.correct(w)) {
      issues.push({ word: w, suggestions: spell.suggest(w).slice(0, 3) });
      if (issues.length >= 60) break;
    }
  }
  return issues;
}

function showSpellPanel(issues: any[]) {
  const countEl = $('spell-count');
  if (countEl) countEl.textContent = String(issues.length);
  const listEl = $('spell-list');
  if (listEl) {
    listEl.innerHTML = issues.map((it: any) => {
      const sug = (it.suggestions && it.suggestions.length)
        ? '<span class="wd-spell-sug"> → ' + it.suggestions.map(escapeHtml).join(', ') + '</span>'
        : '<span class="wd-spell-sug wd-spell-sug--none"> (không có gợi ý)</span>';
      return '<li class="wd-spell-item"><strong>' + escapeHtml(it.word) + '</strong>' + sug + '</li>';
    }).join('');
  }
  const panel = $('spell-panel');
  if (panel) panel.classList.remove('hidden');
}

function hideSpellPanel() {
  const panel = $('spell-panel');
  if (panel) panel.classList.add('hidden');
}

async function submitFromModal(ms: ModalState, force: boolean) {
  if (!ms.assignmentId || !ms.accountId) return;
  const assignmentId = ms.assignmentId;
  const accountId = ms.accountId;
  const isCurrent = () => ms.accountId === accountId && ms.assignmentId === assignmentId && !ms.dead;
  const textarea = $('modal-essay-textarea') as HTMLTextAreaElement | null;
  const text = textarea ? textarea.value : '';
  const wc = countWords(text);

  if (!force && ms.allowSoftCheck) {
    let spellIssues: any[] = [];
    try { spellIssues = await runSpellCheck(text); } catch (e) { spellIssues = []; }
    if (!isCurrent()) return;
    if (spellIssues.length) { showSpellPanel(spellIssues); return; }
  }

  if (!force) {
    if (wc < 100) {
      if (!confirm('Bài viết chỉ có ' + wc + ' từ.\nIELTS Task 2 yêu cầu tối thiểu 250 từ.\nEm chắc muốn nộp bài?')) return;
    }
    if (!confirm('Sau khi nộp em không thể chỉnh sửa. Em chắc muốn nộp bài?')) return;
  }

  const submitBtn = $('modal-btn-submit') as HTMLButtonElement | null;
  const saveBtn = $('modal-btn-save') as HTMLButtonElement | null;
  if (submitBtn) submitBtn.disabled = true;
  if (saveBtn) saveBtn.disabled = true;

  if (ms.autoSaveTimer) {
    clearTimeout(ms.autoSaveTimer);
    ms.autoSaveTimer = null;
  }

  const helper = (window as any).WritingSubmitReceipt;
  const receipt = helper.begin(accountId, assignmentId, text);
  if (receipt.essayText !== text) {
    showSubmissionNotice(
      'warning',
      'Đang có một lần nộp chưa xác nhận với nội dung trước đó. Hệ thống sẽ đối chiếu lần đó trước.'
    );
  }

  try {
    const raw = await (window as any).api.post(
      '/api/writing/my-assignments/' + encodeURIComponent(assignmentId) + '/submit',
      { essay_text: receipt.essayText, request_id: receipt.requestId }
    );
    if (!isCurrent()) return;
    const result = helper.normalizeAck(raw, assignmentId);
    if (!result) throw new Error('Phản hồi nộp bài không khớp assignment.');
    helper.remove(accountId, assignmentId);

    if (ms.countdownInterval) {
      clearInterval(ms.countdownInterval);
      ms.countdownInterval = null;
    }

    if (result.isFlagged) {
      showSubmissionNotice(
        'warning',
        (result.message || 'Bài đã nộp nhưng không được chấm.') +
        ' Nếu em nghĩ đây là lỗi, vui lòng liên hệ giảng viên.'
      );
    } else if (!force) {
      showSubmissionNotice('success', 'Đã gửi bài thành công! Giảng viên sẽ duyệt và trả bài trong 24–48 tiếng.');
    }

    closeModal(ms);
    await Promise.all([loadAssignments((window as any).api), loadEssays((window as any).api)]);
  } catch (err: any) {
    if (!isCurrent()) return;
    let ack = null;
    try { ack = await reconcileSubmission(receipt, (window as any).api); } catch (_) {}
    if (!isCurrent()) return;
    if (ack) {
      showSubmissionNotice('success', 'Đã đối chiếu: bài viết của em đã được nộp thành công.');
      closeModal(ms);
      await Promise.all([loadAssignments((window as any).api), loadEssays((window as any).api)]);
    } else if (statusCode(err) === 409) {
      helper.remove(accountId, assignmentId);
      showSubmissionNotice('warning', 'Bài đã đổi trạng thái hoặc được nộp ở tab khác. Danh sách đã được đồng bộ lại.');
      closeModal(ms);
      await Promise.all([loadAssignments((window as any).api), loadEssays((window as any).api)]);
    } else if (isDefinitiveSubmitRejection(err)) {
      helper.remove(accountId, assignmentId);
      showSubmissionNotice('error', 'Không nộp được bài: ' + ((err && err.message) || 'yêu cầu bị từ chối'));
    } else {
      showSubmissionNotice(
        'warning',
        'Chưa nhận được xác nhận nộp bài. Nội dung đã được giữ lại; em có thể thử lại an toàn hoặc tải lại để đối chiếu.'
      );
    }
  } finally {
    // A successful submit closes the modal and clears assignmentId before
    // finally runs. Re-enable only within the same account lifecycle: a stale
    // callback from the previous account must never mutate the new controls.
    if (ms.accountId === accountId && !ms.dead) {
      if (submitBtn) submitBtn.disabled = false;
      if (saveBtn) saveBtn.disabled = false;
    }
  }
}

function closeModal(ms: ModalState) {
  if (ms.countdownInterval) {
    clearInterval(ms.countdownInterval);
    ms.countdownInterval = null;
  }
  if (ms.autoSaveTimer) {
    clearTimeout(ms.autoSaveTimer);
    ms.autoSaveTimer = null;
  }
  const modal = $('submit-modal');
  if (modal) modal.classList.add('hidden');
  ms.assignmentId = null;
  const returnFocus = ms.returnFocus;
  ms.returnFocus = null;
  if (returnFocus?.isConnected) returnFocus.focus();
}

function trapSubmitModalFocus(ev: KeyboardEvent) {
  if (ev.key !== 'Tab') return;
  const modal = $('submit-modal');
  if (!modal || modal.classList.contains('hidden')) return;
  const focusable = Array.from(modal.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter((el) => el.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!modal.contains(document.activeElement)) {
    ev.preventDefault();
    (ev.shiftKey ? last : first).focus();
  } else if (ev.shiftKey && document.activeElement === first) {
    ev.preventDefault();
    last.focus();
  } else if (!ev.shiftKey && document.activeElement === last) {
    ev.preventDefault();
    first.focus();
  }
}

function renderModal(data: any, ms: ModalState, freshTimer: any) {
  const assignment = data.assignment || {};
  const prompt = assignment.writing_prompts || {};
  const draft = data.draft || {};
  const timer = freshTimer || data.timer || {};

  ms.allowSoftCheck = !!assignment.allow_soft_check;

  const titleEl = $('modal-title');
  if (titleEl) titleEl.textContent = prompt.title || 'Làm bài';
  const meta = (TASK_LABELS[prompt.task_type] || prompt.task_type || '—') +
    ' · ' + formatDate(assignment.created_at);
  const metaEl = $('modal-prompt-meta');
  if (metaEl) metaEl.textContent = meta;
  const promtTitleEl = $('modal-prompt-title');
  if (promtTitleEl) promtTitleEl.textContent = prompt.title || '';
  const promptTextEl = $('modal-prompt-text');
  if (promptTextEl) promptTextEl.textContent = prompt.prompt_text || '';

  const workspaceEl = $('modal-workspace');
  if (workspaceEl) workspaceEl.classList.toggle('has-prompt-image', !!prompt.prompt_image_url);
  const imgEl = $('modal-prompt-image') as HTMLImageElement | null;
  if (imgEl) {
    if (prompt.prompt_image_url) {
      imgEl.src = prompt.prompt_image_url;
      imgEl.classList.remove('hidden');
    } else {
      imgEl.src = '';
      imgEl.classList.add('hidden');
    }
  }

  const instrEl = $('modal-instructions');
  if (assignment.instructions) {
    if (instrEl) instrEl.classList.remove('hidden');
    const instrTextEl = $('modal-instructions-text');
    if (instrTextEl) instrTextEl.textContent = assignment.instructions;
  } else {
    if (instrEl) instrEl.classList.add('hidden');
  }

  const bannerEl = $('modal-timer');
  const totalEl = $('modal-timer-total');
  const displayEl = $('modal-timer-display') as HTMLElement | null;
  const isTimed = timer.is_timed && timer.time_limit_minutes;

  if (displayEl) {
    displayEl.classList.remove('text-red-500');
    displayEl.classList.add('text-amber-400');
  }

  if (isTimed) {
    if (bannerEl) bannerEl.classList.remove('hidden');
    if (totalEl) totalEl.textContent = 'Tổng thời gian: ' + timer.time_limit_minutes + ' phút';
    if (timer.is_expired) {
      if (displayEl) displayEl.textContent = 'Hết giờ';
      showTimerToast('⏰ Hết giờ — đang nộp bài tự động.');
      submitFromModal(ms, true);
    } else if (typeof timer.time_remaining_seconds === 'number') {
      if (displayEl) displayEl.textContent = formatTimer(timer.time_remaining_seconds);
      startModalCountdown(ms, timer.time_remaining_seconds);
    } else {
      if (displayEl) displayEl.textContent = '—';
    }
  } else {
    if (bannerEl) bannerEl.classList.add('hidden');
  }

  const textarea = $('modal-essay-textarea') as HTMLTextAreaElement | null;
  if (textarea) {
    textarea.value = (draft && draft.draft_text) || '';
    textarea.dataset.wordTarget = prompt.task_type === 'task2' ? '250' : '150';
  }
  updateModalWordCount();
}

async function openSubmitModal(assignmentId: string, win: any, api: any) {
  // GHI VÀO thực thể dùng chung, không tạo cái mới: mọi listener (Lưu, Nộp, tự
  // lưu, dán) đã đóng gói đúng object này từ lúc mount.
  const ms = modalState;
  ms.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  ms.assignmentId = assignmentId;
  ms.allowSoftCheck = false;
  ms.dead = false;
  const accountId = ms.accountId;
  if (!accountId) return;
  const isCurrent = () => ms.accountId === accountId && ms.assignmentId === assignmentId && !ms.dead;

  const modal = $('submit-modal');
  if (modal) modal.classList.remove('hidden');
  const initialFocus = $('modal-close') as HTMLButtonElement | null;
  initialFocus?.focus();
  const loadingEl = $('modal-loading');
  if (loadingEl) loadingEl.classList.remove('hidden');
  const contentEl = $('modal-content');
  if (contentEl) contentEl.classList.add('hidden');

  try {
    const pending = (window as any).WritingSubmitReceipt?.read(accountId, assignmentId);
    if (pending) {
      const ack = await reconcileSubmission(pending, api);
      if (!isCurrent()) return;
      if (ack) {
        showSubmissionNotice('success', 'Đã đối chiếu: bài viết của em đã được nộp thành công.');
        closeModal(ms);
        await Promise.all([loadAssignments(api), loadEssays(api)]);
        return;
      }
    }
    const startResult = await api.post(
      '/api/writing/my-assignments/' + encodeURIComponent(assignmentId) + '/start',
      {}
    );
    if (!isCurrent()) return;
    const data = await api.get(
      '/api/writing/my-assignments/' + encodeURIComponent(assignmentId)
    );
    if (!isCurrent()) return;
    if (loadingEl) loadingEl.classList.add('hidden');
    if (contentEl) contentEl.classList.remove('hidden');
    renderModal(data, ms, startResult ? startResult.timer : null);
    const textarea = $('modal-essay-textarea') as HTMLTextAreaElement | null;
    const pendingAfterLoad = (window as any).WritingSubmitReceipt?.read(accountId, assignmentId);
    if (textarea && pendingAfterLoad) textarea.value = pendingAfterLoad.essayText;
    updateModalWordCount();
    if (textarea) textarea.focus();
  } catch (err: any) {
    if (!isCurrent()) return;
    if (statusCode(err) === 409) {
      (window as any).WritingSubmitReceipt?.remove(accountId, assignmentId);
      showSubmissionNotice('warning', 'Bài đã được nộp ở một tab khác. Danh sách đã được đồng bộ lại.');
      await Promise.all([loadAssignments(api), loadEssays(api)]);
    } else {
      alert('Không tải được bài: ' + ((err && err.message) || 'không xác định'));
    }
    closeModal(ms);
  }
}

async function loadAssignments(api: any) {
  const ps = pageState;
  const generation = ps.generation;
  try {
    const data = await api.get('/api/writing/my-assignments');
    if (!data || ps.dead || ps.generation !== generation) return;
    if (data.student) renderStudent(data.student);

    const all = data.assignments || [];
    const active = all.filter((a: any) => ACTIVE_ASSIGNMENT_STATES.includes(a.status));

    const countEl = $('assignments-count');
    if (countEl) countEl.textContent = active.length ? '(' + active.length + ')' : '';

    renderDeadlines(active);
    renderAssignments(active);
  } catch (err: any) {
    if (ps.dead || ps.generation !== generation) return;
    const list = $('assignments-list');
    if (list) {
      list.innerHTML = '<div class="wd-inline-error">Không tải được bài giao: ' +
        escapeHtml((err && err.message) || 'lỗi không xác định') + '</div>';
    }
  }
}

async function loadEssays(api: any) {
  const ps = pageState;
  const generation = ps.generation;
  try {
    const data = await api.get('/api/writing/my-essays');
    if (!data || ps.dead || ps.generation !== generation) return;
    if (data.student) renderStudent(data.student);
    renderEssays(data.essays || [], ps);
    const countEl = $('essays-count');
    const n = (data.essays || []).length;
    if (countEl) countEl.textContent = n ? '(' + n + ')' : '';
  } catch (err: any) {
    if (ps.dead || ps.generation !== generation) return;
    const list = $('essays-list');
    if (list) {
      list.innerHTML = '<div class="wd-inline-error">Không tải được bài viết: ' +
        escapeHtml((err && err.message) || 'lỗi không xác định') + '</div>';
    }
  }
}

function setTabActive(tab: string, ps: PageState, api: any) {
  const assignBtn = $('tab-assignments');
  const essayBtn = $('tab-essays');
  const tipsBtn = $('tab-tips');
  const pbBtn = $('tab-prompt-bank');

  if (assignBtn) assignBtn.classList.toggle('active', tab === 'assignments');
  if (essayBtn) essayBtn.classList.toggle('active', tab === 'essays');
  if (tipsBtn) tipsBtn.classList.toggle('active', tab === 'tips');
  if (pbBtn) pbBtn.classList.toggle('active', tab === 'prompt-bank');

  const contAssignments = $('content-assignments');
  const contEssays = $('content-essays');
  const contTips = $('content-tips');
  const contPB = $('content-prompt-bank');

  if (contAssignments) contAssignments.classList.toggle('hidden', tab !== 'assignments');
  if (contEssays) contEssays.classList.toggle('hidden', tab !== 'essays');
  if (contTips) contTips.classList.toggle('hidden', tab !== 'tips');
  if (contPB) contPB.classList.toggle('hidden', tab !== 'prompt-bank');

  if (tab === 'tips' && !ps.tipsLoaded) { loadTips(api, ps); }
  if (tab === 'prompt-bank' && !ps.pbRendered) { renderPromptBank(ps); }
}

async function applyWritingPermissionGating(api: any, isCurrent: () => boolean) {
  try {
    const perms = await api.get('/api/student/permissions');
    if (!perms || !isCurrent()) return;
    const permitted = perms.writing === true;
    const banner = $('writing-preview-banner');
    const assignmentButtons = document.querySelectorAll<HTMLButtonElement>('.btn-start-assignment');
    const modalSubmit = $('modal-btn-submit') as HTMLButtonElement | null;

    if (permitted) {
      if (banner) banner.classList.add('hidden');
      assignmentButtons.forEach((btn) => {
        btn.disabled = false;
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
        btn.title = '';
      });
      if (modalSubmit) {
        modalSubmit.disabled = false;
        modalSubmit.classList.remove('opacity-50', 'cursor-not-allowed');
        modalSubmit.title = '';
      }
    } else {
      if (banner) banner.classList.remove('hidden');
      assignmentButtons.forEach((btn) => {
        btn.disabled = true;
        btn.classList.add('opacity-50', 'cursor-not-allowed');
        btn.title = 'Quyền Writing chưa được kích hoạt';
        btn.textContent = '🔒 Chưa kích hoạt';
      });
      if (modalSubmit) {
        modalSubmit.disabled = true;
        modalSubmit.classList.add('opacity-50', 'cursor-not-allowed');
        modalSubmit.title = 'Quyền Writing chưa được kích hoạt';
      }
    }
  } catch (err) {
    console.warn('[writing] permission fetch failed:', err);
  }
}

// Khớp bản legacy (dòng 605 của writing-dashboard.html) và khớp /speaking.
const LOGIN_URL = '/login.html';

export function WritingBehavior() {
  const { status, user } = useAuth();

  // Cổng fail-closed (ADR-011) — dùng replace() để nút Back không dựng lại trang
  // riêng tư từ lịch sử. Bản legacy tương ứng: kiểm `getSession()` rồi đá về
  // trang đăng nhập.
  useEffect(() => {
    if (status === 'signed-out') window.location.replace(LOGIN_URL);
  }, [status]);

  useEffect(() => {
    // CHỜ ĐĂNG NHẬP XONG rồi mới gọi API. Chỉ chờ `window.api` là KHÔNG ĐỦ:
    // `api.js` tạo `window.api` sớm hơn lúc `initSupabase()` của AuthedShell
    // điền xong client dùng chung, nên có một khoảng mà request đi ra KHÔNG kèm
    // bearer. `api.js` coi 401 là đã đăng xuất và đá về trang đăng nhập — tức
    // học viên hợp lệ bị văng khỏi trang. (Codex bắt ở #950 vòng 2.)
    if (status !== 'signed-in' || !user?.id) return;

    const ps = pageState;
    const generation = ps.generation + 1;
    ps.generation = generation;
    ps.dead = false;
    ps.allEssays = [];
    ps.allTips = [];
    ps.tipsLoaded = false;
    ps.allPrompts = [];
    ps.pbRendered = false;

    // Account switch must hide the previous learner synchronously, before the
    // new canonical reads resolve. Empty counts/lists are preferable to a
    // momentary cross-account disclosure.
    ['assignments-count', 'essays-count'].forEach((id) => {
      const el = $(id);
      if (el) el.textContent = '';
    });
    const assignmentsList = $('assignments-list');
    const essaysList = $('essays-list');
    if (assignmentsList) assignmentsList.innerHTML = '<p class="text-sm py-8 text-center" style="color:var(--av-text-muted)">Đang tải…</p>';
    if (essaysList) essaysList.innerHTML = '<p class="text-sm py-8 text-center" style="color:var(--av-text-muted)">Đang tải…</p>';
    hide('assignments-empty');
    hide('essays-empty');

    // Modal state dùng chung (khai ở phạm vi module). `dead` phải đặt lại ở
    // mỗi lần mount vì object sống lâu hơn component.
    const ms = modalState;
    ms.dead = false;
    ms.accountId = user.id;

    const cleanups: Array<() => void> = [];
    const on = (el: Element | Document | null, ev: string, fn: any) => {
      if (!el) return;
      el.addEventListener(ev, fn);
      cleanups.push(() => el.removeEventListener(ev, fn));
    };

    (async () => {
      // `whenGlobalReady` thay cho vòng thăm dò tự chế: nó có hạn giờ VÀ báo lỗi
      // ra console khi hết hạn. Vòng thăm dò im lặng thì trang chỉ đơn giản
      // không làm gì và không ai biết vì sao.
      const ok = await whenGlobalReady(
        () => typeof (window as any).api?.get === 'function' &&
          typeof (window as any).WritingSubmitReceipt?.begin === 'function',
        'window.api + WritingSubmitReceipt (writing)',
      );
      const isCurrent = () => !ps.dead && ps.generation === generation && ms.accountId === user.id;
      if (!isCurrent() || !ok) return;
      const api = (window as any).api;

      // GẮN LISTENER TRƯỚC ANY AWAIT
      const tabAssignments = $('tab-assignments');
      const tabEssays = $('tab-essays');
      const tabTips = $('tab-tips');
      const tabPromptBank = $('tab-prompt-bank');
      const tipModalClose = $('tip-modal-close');
      const tipModalBackdrop = $('tip-modal-backdrop');
      const spellBtnBack = $('spell-btn-back');
      const spellBtnSubmit = $('spell-btn-submit');
      const textarea = $('modal-essay-textarea') as HTMLTextAreaElement | null;
      const saveBtn = $('modal-btn-save') as HTMLButtonElement | null;
      const submitBtn = $('modal-btn-submit') as HTMLButtonElement | null;
      const modalClose = $('modal-close') as HTMLButtonElement | null;

      on(tabAssignments, 'click', () => setTabActive('assignments', ps, api));
      on(tabEssays, 'click', () => setTabActive('essays', ps, api));
      on(tabTips, 'click', () => setTabActive('tips', ps, api));
      on(tabPromptBank, 'click', () => setTabActive('prompt-bank', ps, api));

      wireEssayFilterTabs(ps, on);
      wirePromptFilterTabs(ps, on);
      wireTipFilterTabs(ps, on);

      on(tipModalClose, 'click', closeTipModal);
      on(tipModalBackdrop, 'click', closeTipModal);
      on(document, 'keydown', (ev: KeyboardEvent) => {
        trapSubmitModalFocus(ev);
        if (ev.key === 'Escape' && !$('tip-modal')?.classList.contains('hidden')) {
          closeTipModal();
          return;
        }
        if (ev.key === 'Escape' && !$('spell-panel')?.classList.contains('hidden')) {
          hideSpellPanel();
          textarea?.focus();
          return;
        }
        if (ev.key === 'Escape' && !$('submit-modal')?.classList.contains('hidden')) {
          if (textarea?.value) saveDraft(ms);
          closeModal(ms);
        }
      });

      // Modal wiring — dùng ms (modal state) duy nhất
      on(modalClose, 'click', () => {
        if (textarea && textarea.value) {
          saveDraft(ms);
        }
        closeModal(ms);
      });

      if (textarea) {
        on(textarea, 'input', () => {
          updateModalWordCount();
          scheduleModalAutoSave(ms);
        });
        setupAntiPaste(textarea, ms, on);
      }

      on(saveBtn, 'click', () => {
        saveDraft(ms);
      });

      on(submitBtn, 'click', () => {
        submitFromModal(ms, false);
      });

      on(spellBtnBack, 'click', () => {
        hideSpellPanel();
        if (textarea) textarea.focus();
      });

      on(spellBtnSubmit, 'click', () => {
        hideSpellPanel();
        submitFromModal(ms, true);
      });

      // ASYNC LOADS (now that listeners are attached)
      await Promise.all([loadAssignments(api), loadEssays(api)]);
      if (!isCurrent()) return;
      hideSubmissionNotice();
      if (ms.accountId) await reconcilePendingSubmissions(ms.accountId, api);
      if (!isCurrent()) return;
      await applyWritingPermissionGating(api, isCurrent);
      if (!isCurrent()) return;
      await loadPromptBank(api, ps);
    })();

    return () => {
      if (ps.generation === generation) ps.dead = true;
      ms.dead = true;
      if (ms.accountId === user.id) {
        closeModal(ms);
        ms.accountId = null;
      }
      if (ms.autoSaveTimer) clearTimeout(ms.autoSaveTimer);
      if (ms.countdownInterval) clearInterval(ms.countdownInterval);
      cleanups.forEach((fn) => fn());
    };
  }, [status, user?.id]);

  return null;
}
