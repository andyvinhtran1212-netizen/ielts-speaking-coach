'use client';

// SpeakingBehavior — PHẦN LÕI của tầng hành vi trang Speaking (PR 2/3).
//
// PHẠM VI: mọi thứ để học viên BẮT ĐẦU LUYỆN ĐƯỢC — quyền, lời chào, modal chủ
// đề, ba đường khởi động phiên (tự nhập câu hỏi / theo chủ đề / từng Part) và
// Full Test. NGOÀI phạm vi (PR 3): thống kê, lịch sử + phân trang + lọc, hai
// biểu đồ Chart.js, cache dashboard, cập nhật từ vựng, dashboard ngữ pháp.
//
// VÌ SAO VÁ THẲNG VÀO DOM: cùng lý do đã ghi ở `home-behavior.tsx` — vỏ là
// Server Component tĩnh (PPR), dữ liệu riêng tư chỉ tới phía client qua
// `window.api` (ADR-003 §3), và chính DOM là thứ cổng parity G1 so.
//
// HANDLER NỘI TUYẾN → LISTENER THEO ID. Bản legacy có 27 `onclick=...`. Vỏ đã
// bỏ chúng ra (PR 1); ở đây gắn lại bằng `addEventListener` theo id/selector,
// mỗi cái đều có hàm gỡ trong cleanup để StrictMode chạy hai lần vẫn đúng.
//
// KHÁC LEGACY CÓ CHỦ Ý:
//   1. Cổng đăng nhập qua `useAuth()` (ADR-011) thay vì `getSession()` thô.
//   2. Chờ `window.api` bằng `whenGlobalReady` (có hạn giờ, báo lỗi) thay vì
//      giả định script đã nạp.
//   3. `alert()` của `startPractice` giữ nguyên — nó là hành vi người dùng thấy;
//      đổi sang toast là thay đổi ngoài phạm vi port.
import { useEffect, useLayoutEffect, useRef } from 'react';

import type { AuthMeWire } from '@/lib/auth-api';
import { useAuth } from '@/lib/auth/auth-provider';
import { admitCorePlayer } from '@/lib/core-player-affinity.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';
import { isSpeakingApiReady } from '@/lib/speaking-api-readiness.mjs';
import { createSpeakingStartController, clearSpeakingStartIntents } from '@/lib/speaking-start-intent.mjs';
import { coreOperationHeaders } from '@/lib/core-operation-intent.mjs';
import { createLearnerTabDrafts, clearLearnerTabDraftAccount, type TabDraft } from '@/lib/learner-tab-drafts.mjs';
import {
  CUE_CARD_HINT_DEFAULT_HTML, CUE_CARD_HINT_PART2_HTML,
  CUE_CARD_PLACEHOLDER_DEFAULT, CUE_CARD_PLACEHOLDER_PART2,
  DEFAULT_PERMISSIONS, DEFAULT_TOPICS, TAB_DEFS,
  cueCardLengthWarning, greetingName, hasPermission,
} from '@/lib/speaking-copy.mjs';

const LOGIN_URL = '/login';

const $ = (id: string) => document.getElementById(id);
const val = (id: string) => ($(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? '';

/** Trạng thái trang — giữ trong một object thay vì biến module để cleanup dứt điểm. */
type State = {
  perms: string[];
  modalPart: number;
  modalMode: string;
  activeTopicTab: 'list' | 'custom' | 'myq';
  pracPart: number;
  pracTopicPart: number;
  pbpPart: number;
  mainTab: string;
  dead: boolean;
  starter: ReturnType<typeof createSpeakingStartController> | null;
  accountId: string | null;
  permissionsReady: boolean;
  permissionAccount: string | null;
  drafts: Map<string, TabDraft<any>>;
  wantedTopics: Record<string, string>;
  topicReads: Record<string, { part: number; request: number; titles: string[] }>;
  saveDraft: () => void;
  restoreMode: (scope: string) => void;
};

const PREPARATION_FIELDS = ['prac-custom-q', 'prac-topic-custom', 'pbp-topic-custom',
  'topic-custom-input', 'myq-input', 'ft-p1-topic-1', 'ft-p1-topic-2', 'ft-p1-topic-3', 'ft-p2-topic'];
const PREPARATION_SELECTS = ['prac-topic-select', 'pbp-topic-select', 'topic-select'];
const exactDraft = (value: any, fields: string[]) => value && typeof value === 'object'
  && !Array.isArray(value) && Object.keys(value).length === fields.length
  && fields.every(field => Object.hasOwn(value, field));
function validSpeakingPreparation(scope: string, value: any): boolean {
  const part = (v: unknown) => v === 1 || v === 2 || v === 3;
  const text = (v: unknown) => typeof v === 'string';
  if (scope === 'panel') return exactDraft(value, ['panel', 'modalOpen', 'part', 'mode'])
    && ['dashboard', 'practice', 'partbpart', 'fulltest'].includes(value.panel)
    && typeof value.modalOpen === 'boolean' && part(value.part) && ['practice', 'test_part'].includes(value.mode);
  if (scope === 'practice') return exactDraft(value, ['part', 'topicPart', 'questions', 'customTopic', 'topic'])
    && part(value.part) && part(value.topicPart) && [value.questions, value.customTopic, value.topic].every(text);
  if (scope === 'partbpart') return exactDraft(value, ['part', 'customTopic', 'topic'])
    && part(value.part) && [value.customTopic, value.topic].every(text);
  if (scope === 'fulltest') return exactDraft(value, ['topics']) && Array.isArray(value.topics)
    && value.topics.length === 4 && value.topics.every(text);
  return /^modal:(practice|test_part):[123]$/.test(scope)
    && exactDraft(value, ['tab', 'questions', 'customTopic', 'topic'])
    && ['list', 'custom', 'myq'].includes(value.tab) && [value.questions, value.customTopic, value.topic].every(text);
}

function draftNotice(status: string, restored = false) {
  for (const id of ['speaking-draft-notice', 'speaking-modal-draft-notice']) {
    const notice = $(id);
    if (!notice) continue;
    notice.textContent = status === 'unavailable'
      ? 'Nháp chưa được lưu trong tab này. Bạn vẫn có thể luyện tập; hãy giữ trang mở để tránh mất nội dung.'
      : status === 'topic-unavailable' ? 'Chủ đề đã lưu hiện không có trong danh sách. Hãy chọn hoặc nhập chủ đề để tiếp tục.'
      : restored ? 'Đã khôi phục nháp trong tab này.' : status === 'saved' ? 'Nháp đã được lưu trong tab này.'
        : status === 'discarded' ? 'Đã bỏ nháp của mode hiện tại.' : '';
  }
}

function selectedTopic(st: State, selectId: string, part: number) {
  const row = st.topicReads[selectId];
  const value = val(selectId);
  return row?.part === part && row.titles.includes(value) ? value : '';
}

function resetPreparation(st: State) {
  PREPARATION_FIELDS.forEach(id => { const input = $(id) as HTMLInputElement | null; if (input) input.value = ''; });
  PREPARATION_SELECTS.forEach(id => { const select = $(id) as HTMLSelectElement | null; if (select) { select.value = ''; select.disabled = true; } });
  st.pracPart = 1; st.pracTopicPart = 1; st.pbpPart = 1;
  st.modalPart = 1; st.modalMode = 'practice'; st.wantedTopics = {}; st.topicReads = {};
  [1, 2, 3].forEach(p => {
    $('prac-part-' + p)?.classList.toggle('selected', p === 1);
    $('prac-tp-part-' + p)?.classList.toggle('selected', p === 1);
    $('pbp-card-' + p)?.classList.remove('selected');
  });
  applyCueCardCopy('prac-custom-q', 1);
  applyCueCardCopy('myq-input', 1);
  evaluateCueCardWarning('prac-custom-q', 'prac-custom-q-length-warning', 1);
  evaluateCueCardWarning('myq-input', 'myq-input-length-warning', 1);
  switchTopicTab('list', st);
  const modal = $('topic-modal');
  if (modal) { modal.hidden = true; modal.inert = true; modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); }
  for (const id of ['speaking-draft-controls', 'speaking-modal-draft-controls']) { const bar = $(id); if (bar) bar.hidden = true; }
  document.body.style.overflow = '';
  const section = $('pbp-topic-section'); if (section) section.style.display = 'none';
  switchMainTab('dashboard', st, null, []);
  draftNotice('empty');
}

// ── Quyền ────────────────────────────────────────────────────────────────────

/**
 * Khoá tab + thẻ mode theo quyền, và CHÈN biểu ngữ khoá vào panel.
 *
 * Biểu ngữ là phòng-thủ-nhiều-lớp: chặn bằng giao diện (mờ + không bấm được)
 * có thể đi vòng, nên panel vẫn phải tự nói rõ khi người dùng lọt vào.
 */
function applyPermissions(st: State) {
  TAB_DEFS.forEach((def: any) => {
    const allowed = hasPermission(st.perms, def.scope);
    const btn = $('mtab-' + def.tab) as HTMLButtonElement | null;
    const panel = $('tab-' + def.tab);

    if (btn) {
      btn.disabled = !allowed;
      btn.title = allowed ? '' : 'Tài khoản không có quyền truy cập ' + def.label;
      btn.style.opacity = allowed ? '' : '0.4';
      btn.style.cursor = allowed ? '' : 'not-allowed';
    }

    if (panel && !allowed && !panel.querySelector('.perm-locked-banner')) {
      const banner = document.createElement('div');
      banner.className = 'perm-locked-banner';
      banner.style.cssText = 'margin:32px auto;max-width:400px;text-align:center;padding:28px 20px;border-radius:16px;background:rgba(248,113,113,0.08);border:1px solid rgba(248,113,113,0.25);';
      banner.innerHTML = '<div style="font-size:2rem;margin-bottom:8px;">🔒</div>'
        + '<p style="font-weight:700;margin-bottom:6px;">' + def.label + ' không khả dụng</p>'
        + '<p style="font-size:13px;color:var(--av-text-muted);">Gói truy cập của bạn không bao gồm tính năng này. Liên hệ admin để nâng cấp.</p>';
      panel.insertAdjacentElement('afterbegin', banner);
    }
  });

  // Thẻ mode trên dashboard. Bản legacy còn quét `[onclick*="practice"]` —
  // KHÔNG port được vì vỏ Next đã bỏ hết handler nội tuyến (PR 1). Thay bằng
  // `[data-mode]`, vốn là thứ chính bản legacy đã chuyển sang dùng ở Sprint 8.1.
  const lock = (sel: string) => document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
    el.style.pointerEvents = 'none';
    el.style.opacity = '0.4';
  });
  if (!hasPermission(st.perms, 'practice_single')) lock('.mode-card[data-mode="practice"]');
  if (!hasPermission(st.perms, 'practice_part')) lock('.mode-card[data-mode="partbpart"]');
  if (!hasPermission(st.perms, 'practice_full')) lock('.mode-card[data-mode="fulltest"], .btn-fulltest');
}

/** Ví từ vựng cá nhân đã gỡ — giữ hàm để lời gọi cũ thành no-op, như legacy. */
function applyVocabBankFlag() {
  const c = $('vocab-bank-link-container');
  if (c) c.innerHTML = '';
}

/** Hiện tab Exercises khi d1 HOẶC d3 bật. Mặc-định-từ-chối: thiếu/false/lỗi ⇒ ẩn. */
function applyExercisesFlag(d1: unknown, d3: unknown) {
  const c = $('exercises-link-container');
  if (!c) return;
  c.innerHTML = (d1 === true || d3 === true)
    ? '<a href="/exercises" class="main-tab-btn" style="text-decoration:none;">'
      + '<span class="main-tab-label">🎯 Exercises</span>'
      + '<span class="main-tab-sub">Bài tập từ vựng ngắn</span>'
      + '</a>'
    : '';
}

/** So sánh `=== true` để một giá trị truthy-nhưng-không-phải-true không lọt qua. */
function applyFlashcardsFlag(enabled: unknown, api: any, st: State) {
  const c = $('flashcards-link-container');
  if (!c) return;
  if (enabled !== true) { c.innerHTML = ''; return; }
  c.innerHTML =
    '<a href="/flashcards" class="main-tab-btn" style="text-decoration:none;">'
    + '<span class="main-tab-label">📚 Flashcards</span>'
    + '<span class="main-tab-sub" id="flashcards-tab-sub">Ôn từ vựng theo lịch tự động</span>'
    + '</a>';
  refreshFlashcardsBadge(api, st);
}

/** Không có thẻ đến hạn thì GIỮ chữ tĩnh — fetch hỏng không được để lại huy hiệu cũ. */
function setFlashcardsBadgeCount(count: unknown) {
  const n = Number(count || 0);
  if (n <= 0) return;
  const sub = $('flashcards-tab-sub');
  if (!sub) return;
  sub.textContent = '🔥 ' + n + ' thẻ đến hạn';
  (sub as HTMLElement).style.color = 'var(--av-accent)';
}

async function refreshFlashcardsBadge(api: any, st: State) {
  try {
    const body = await api.get('/api/flashcards/due/count');
    if (st.dead) return;
    setFlashcardsBadgeCount(body && body.count);
  } catch {
    // Im lặng — huy hiệu thuần thông tin.
  }
}

/**
 * Lời chào + uỷ quyền pill cho `<aver-chrome>.setUser()`.
 *
 * Gọi từ trang là CÓ CHỦ Ý: nó chặn trước lần tự-fetch của component để
 * ngữ cảnh quyền từ `/auth/me` thắng.
 */
function renderUser(user: any, api: any, st: State) {
  const { display, short } = greetingName(user);
  const chrome = document.querySelector('aver-chrome') as any;
  if (chrome && typeof chrome.setUser === 'function') {
    chrome.setUser({ name: display, role: user?.role });
  }
  const g = $('greeting-name');
  if (g) g.textContent = short;

  if (Array.isArray(user?.permissions)) st.perms = user.permissions;
  applyPermissions(st);
  applyVocabBankFlag();
  applyExercisesFlag(user?.d1_enabled, user?.d3_enabled);
  applyFlashcardsFlag(user?.flashcard_enabled, api, st);
}

// ── Cue card ────────────────────────────────────────────────────────────────

function applyCueCardCopy(textareaId: string, partNum: number) {
  const ta = $(textareaId) as HTMLTextAreaElement | null;
  if (ta) {
    ta.placeholder = partNum === 2 ? CUE_CARD_PLACEHOLDER_PART2 : CUE_CARD_PLACEHOLDER_DEFAULT;
  }
  const hint = $(textareaId + '-hint');
  if (hint) {
    hint.innerHTML = partNum === 2 ? CUE_CARD_HINT_PART2_HTML : CUE_CARD_HINT_DEFAULT_HTML;
  }
}

function evaluateCueCardWarning(textareaId: string, warningId: string, partNum: number) {
  const warn = $(warningId) as HTMLElement | null;
  if (!warn) return;
  const ta = $(textareaId) as HTMLTextAreaElement | null;
  const { state, html } = cueCardLengthWarning(ta ? ta.value : '', ta ? partNum : -1);
  warn.dataset.state = state;
  warn.innerHTML = html;
}

// ── Điều hướng panel ────────────────────────────────────────────────────────

function loadMainTabData(tab: string, st: State, api: any) {
  if (tab === 'practice') loadTopicsInto('prac-topic-select', st.pracTopicPart, api, st);
  if (tab === 'partbpart') selectPbpPart(st.pbpPart, st, api);
}

function switchMainTab(tab: string, st: State, api: any | null, cleanups: Array<() => void>) {
  if (st.mainTab !== tab) st.restoreMode?.(tab);
  st.mainTab = tab;
  ['dashboard', 'practice', 'partbpart', 'fulltest'].forEach((t) => {
    const panel = $('tab-' + t);
    if (panel) panel.classList.toggle('active', t === tab);
  });
  const discard = $('speaking-draft-discard') as HTMLButtonElement | null;
  if (discard) discard.disabled = tab === 'dashboard';
  if (api) loadMainTabData(tab, st, api);
}

// ── Chủ đề ──────────────────────────────────────────────────────────────────

/**
 * Nạp danh sách chủ đề vào một `<select>`.
 *
 * Gộp `loadPracTopics` và `loadPbpTopics` của legacy: hai hàm đó GIỐNG NHAU
 * từng dòng, chỉ khác id của select. Giữ nguyên mọi chuỗi hiển thị.
 */
async function loadTopicsInto(selectId: string, part: number, api: any, st: State) {
  const select = $(selectId) as HTMLSelectElement | null;
  if (!select) return;
  const existing = selectedTopic(st, selectId, part);
  if (existing && st.wantedTopics[selectId] === undefined) st.wantedTopics[selectId] = existing;
  select.innerHTML = '<option value="" disabled selected>— Đang tải... —</option>';
  select.disabled = true;
  const request = (st.topicReads[selectId]?.request || 0) + 1;
  const pending = { part, request, titles: [] as string[] };
  st.topicReads[selectId] = pending;
  try {
    const topics = await api.get('/topics?part=' + part);
    if (st.dead || st.topicReads[selectId] !== pending) return;
    if (!Array.isArray(topics) || topics.some(t => typeof t?.title !== 'string' || !t.title.trim())) throw new Error('topics');
    select.innerHTML = '';
    if (!topics || topics.length === 0) {
      select.innerHTML = selectId === 'topic-select'
        ? '<option value="" disabled selected>— Không có chủ đề nào —</option>'
        : '<option value="" disabled selected>— Không có chủ đề —</option>';
    } else {
      select.innerHTML = selectId === 'topic-select'
        ? '<option value="" disabled selected>— Chọn một chủ đề —</option>'
        : '<option value="" disabled selected>— Chọn chủ đề —</option>';
      topics.forEach((t: any) => {
        const o = document.createElement('option');
        o.value = t.title;
        o.textContent = t.title + (t.category ? ' · ' + t.category : '');
        select.appendChild(o);
      });
    }
    pending.titles = topics.map(t => t.title);
    const wanted = st.wantedTopics[selectId];
    if (wanted) {
      if (pending.titles.includes(wanted)) select.value = wanted;
      else draftNotice('topic-unavailable');
      delete st.wantedTopics[selectId];
    }
    select.disabled = false;
  } catch {
    if (st.dead || st.topicReads[selectId] !== pending) return;
    select.innerHTML = selectId === 'topic-select'
      ? '<option value="" disabled selected>— Không thể tải danh sách —</option>'
      : '<option value="" disabled selected>— Không thể tải —</option>';
    if (st.wantedTopics[selectId]) draftNotice('topic-unavailable');
  }
}

async function randomTopic(part: number, api: any): Promise<string> {
  try {
    const topics = await api.get('/topics?part=' + part);
    if (topics && topics.length > 0) {
      return topics[Math.floor(Math.random() * topics.length)].title;
    }
  } catch { /* rơi xuống mặc định */ }
  return (DEFAULT_TOPICS as any)[part] || 'General';
}

// ── Tạo phiên ───────────────────────────────────────────────────────────────

function goToPractice(sessionId: string) {
  window.location.href = admitCorePlayer('speaking', { session_id: sessionId });
}

function getStarter(st: State, api: any) {
  if (!st.starter) {
    const identity = async () => {
      if (st.dead) throw new Error('Trang đã đóng.');
      const result = await (window as any).getSupabase().auth.getSession();
      if (result?.error || !result?.data?.session?.user?.id || st.dead) throw new Error('Vui lòng đăng nhập lại trước khi bắt đầu.');
      return result.data.session;
    };
    st.starter = createSpeakingStartController({
      getAccountId: async () => (await identity()).user.id,
      getStorage: () => window.sessionStorage,
      post: async (path: string, body: any, accountId: string, signal: AbortSignal) => {
        const session = await identity();
        if (session.user.id !== accountId || signal.aborted) throw new Error('Phiên đăng nhập đã thay đổi. Vui lòng tải lại trang.');
        // Pin the normal SDK token to the same account as the pending intent;
        // an account switch during api.js's auth await cannot send as another user.
        return api.postWith(path, body, {
          Authorization: `Bearer ${session.access_token}`,
          ...coreOperationHeaders(path === '/sessions' ? body.client_session_id : null),
        }, { signal });
      },
    });
  }
  return st.starter;
}

function showStartError(errEl: HTMLElement | null, error: any, st: State, slot: string) {
  if (!errEl || st.dead) return;
  errEl.textContent = 'Lỗi: ' + (error?.message || 'Không thể tạo session.');
  if (!error?.canDiscardStart || !st.starter) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-secondary';
  button.textContent = 'Bỏ mã gửi lại để bắt đầu lượt mới';
  button.onclick = async () => {
    if (st.dead) return;
    button.disabled = true;
    try {
      await st.starter!.discard(slot);
      if (!st.dead) errEl.textContent = 'Đã bỏ mã gửi lại, không xóa bài đã lưu. Bấm Bắt đầu khi bạn muốn tạo lượt mới.';
    } catch (failure: any) {
      if (!st.dead) {
        errEl.textContent = 'Lỗi: ' + (failure?.message || 'Không thể bỏ mã gửi lại.');
        button.disabled = false;
        errEl.appendChild(button);
      }
    }
  };
  errEl.appendChild(button);
}

// ── Modal chủ đề ────────────────────────────────────────────────────────────

function switchTopicTab(tab: State['activeTopicTab'], st: State) {
  st.activeTopicTab = tab;
  (['list', 'custom', 'myq'] as const).forEach((t) => {
    $('tab-' + t)?.classList.toggle('active', t === tab);
    $('panel-' + t)?.classList.toggle('hidden', t !== tab);
  });
  const btn = $('btn-confirm');
  if (btn) btn.textContent = tab === 'myq' ? '✍️ Bắt đầu luyện tập' : '🚀 Bắt đầu tạo câu hỏi';
  const err = $('modal-error');
  if (err) err.textContent = '';
}

let topicModalTrigger: HTMLElement | null = null;

function syncTopicModalViewport() {
  const modal = $('topic-modal');
  if (!modal?.classList.contains('open')) return;
  const viewport = window.visualViewport;
  const height = viewport && Number.isFinite(viewport.height) && viewport.height > 0
    ? viewport.height : window.innerHeight;
  const top = viewport && Number.isFinite(viewport.offsetTop) ? Math.max(0, viewport.offsetTop) : 0;
  // A keyboard can shrink/pan only the visual viewport while the layout stays
  // tall. Fit the backdrop there; the dialog scrolls within its padded height.
  modal.style.top = `${top}px`;
  modal.style.bottom = 'auto';
  modal.style.height = `${height}px`;
}

function closeTopicModal() {
  const modal = $('topic-modal');
  modal?.classList.remove('open');
  modal?.setAttribute('aria-hidden', 'true');
  if (modal) {
    modal.inert = true;
    modal.hidden = true;
  }
  document.body.style.overflow = '';
  topicModalTrigger?.focus();
  topicModalTrigger = null;
}

async function openTopicModal(part: number, mode: string, st: State, api: any) {
  topicModalTrigger = document.activeElement instanceof HTMLElement
    ? document.activeElement : null;
  st.modalPart = part;
  st.modalMode = mode || 'practice';

  const sub = $('modal-subtitle');
  if (sub) sub.textContent = 'Bạn muốn luyện tập Part ' + part + ' với chủ đề nào?';
  const err = $('modal-error');
  if (err) err.textContent = '';
  const custom = $('topic-custom-input') as HTMLInputElement | null;
  if (custom) custom.value = '';
  const myQuestions = $('myq-input') as HTMLTextAreaElement | null;
  if (myQuestions) myQuestions.value = '';
  applyCueCardCopy('myq-input', part);
  evaluateCueCardWarning('myq-input', 'myq-input-length-warning', part);
  switchTopicTab('list', st);
  st.restoreMode(`modal:${st.modalMode}:${part}`);

  const select = $('topic-select') as HTMLSelectElement | null;
  if (select) {
    select.innerHTML = '<option value="" disabled selected>— Đang tải danh sách... —</option>';
    select.disabled = true;
  }
  const modal = $('topic-modal');
  if (modal) {
    modal.hidden = false;
    modal.inert = false;
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('open');
  }
  syncTopicModalViewport();
  document.body.style.overflow = 'hidden';
  ($('modal-close') as HTMLButtonElement | null)?.focus();
  st.saveDraft();
  await loadTopicsInto('topic-select', part, api, st);
}

/**
 * Chuẩn bị câu hỏi tự nhập rồi tạo phiên.
 *
 * Dùng chung cho modal (`myq-input`) và panel Luyện tập (`prac-custom-q`) — hai
 * đường này ở legacy là hai hàm gần trùng nhau từng dòng.
 *
 * L9: cue card LUÔN thuộc Part 2. Nút Part đã ràng buộc hình dạng đầu vào,
 * nhưng vẫn phòng ca heuristic nhận ra cue card dù người dùng chọn Part 1/3.
 */
async function startFromCustomQuestions(opts: {
  textareaId: string; errorId: string; btn: HTMLButtonElement | null;
  part: number; mode: string; idleLabel: string; api: any; st: State; onSuccess?: () => void;
}) {
  const { textareaId, errorId, btn, part, mode, idleLabel, api, st } = opts;
  const errEl = $(errorId);
  if (errEl) errEl.textContent = '';
  const raw = val(textareaId);
  if (!raw || !raw.trim()) {
    if (errEl) errEl.textContent = 'Vui lòng nhập ít nhất một câu hỏi.';
    return;
  }
  const detector = (window as any).CueCardDetector;
  // Part 2 + đoạn dán KHÔNG phải cue card ⇒ gọi endpoint sinh cue card ở
  // backend; spinner "Đang tạo cue card..." là tín hiệu cho người dùng biết
  // đang có một vòng đi-về mạng.
  let aiGenLikely = false;
  if (part === 2 && detector?.detectCueCard) {
    aiGenLikely = !detector.detectCueCard(raw).isCueCard;
  }
  const reset = () => {
    if (btn) { btn.disabled = false; btn.textContent = idleLabel; }
  };
  if (btn) {
    btn.disabled = true;
    btn.textContent = aiGenLikely ? 'Đang tạo cue card...' : 'Đang tạo session...';
  }

  try {
    const { sessionId: sid } = await getStarter(st, api).start({
      slot: 'custom', intent: { mode, part, raw },
      prepare: async () => {
        const questions = await detector.parseCustomQuestionsByPart(raw, part);
        if (!questions?.length) throw new Error('Không tìm thấy câu hỏi hợp lệ.');
        const isCueCard = typeof questions[0] === 'object' && questions[0].type === 'cue_card';
        return { body: { mode, part: isCueCard ? 2 : part, topic: 'Custom questions' }, questions };
      },
    });
    if (st.dead) return;
    opts.onSuccess?.();
    goToPractice(sid);
  } catch (e: any) {
    if (st.dead) return;
    showStartError(errEl, e, st, 'custom');
    reset();
  }
}

/** Tạo phiên theo CHỦ ĐỀ — dùng chung cho modal, panel Luyện tập và từng Part. */
async function startFromTopic(opts: {
  topic: string; mode: string; part: number; errorId: string;
  btn: HTMLButtonElement | null; idleLabel: string; api: any; st: State; onSuccess?: () => void;
}) {
  const { topic, mode, part, errorId, btn, idleLabel, api, st } = opts;
  const errEl = $(errorId);
  if (btn) { btn.disabled = true; btn.textContent = 'Đang tạo session...'; }
  try {
    const { sessionId: sid } = await getStarter(st, api).start({
      slot: 'topic', intent: { mode, part, topic: topic.trim() },
      prepare: async () => ({ body: { mode, part, topic } }),
    });
    if (st.dead) return;
    opts.onSuccess?.();
    goToPractice(sid);
  } catch (e: any) {
    if (st.dead) return;
    showStartError(errEl, e, st, 'topic');
    if (btn) { btn.disabled = false; btn.textContent = idleLabel; }
  }
}

// ── Từng Part ───────────────────────────────────────────────────────────────

function selectPbpPart(part: number, st: State, api: any) {
  st.pbpPart = part;
  [1, 2, 3].forEach((p) => $('pbp-card-' + p)?.classList.toggle('selected', p === part));
  const section = $('pbp-topic-section') as HTMLElement | null;
  if (section) section.style.display = 'block';
  const label = $('pbp-part-label');
  if (label) label.textContent = 'Chủ đề cho Part ' + part;
  loadTopicsInto('pbp-topic-select', part, api, st);
}

// ── Component ───────────────────────────────────────────────────────────────

export function SpeakingBehavior() {
  const { status, user } = useAuth();
  const account = status === 'signed-in' ? user?.id || null : null;
  const statusRef = useRef(status);
  statusRef.current = status;
  const accountRef = useRef(account);
  accountRef.current = account;
  const syncDraftRef = useRef<((account: string | null) => void) | null>(null);
  useLayoutEffect(() => {
    if (syncDraftRef.current) syncDraftRef.current(account);
    else PREPARATION_FIELDS.forEach(id => { const input = $(id) as HTMLInputElement | null; if (input) input.value = ''; });
  }, [account, status]);

  // Cổng fail-closed (ADR-011): rời trang bằng replace() để nút Back không dựng
  // lại trang riêng tư từ lịch sử. Bản legacy tương ứng: `requireAuth()` đẩy về
  // `../login` khi không có phiên.
  useEffect(() => {
    if (status === 'signed-out') {
      try { clearSpeakingStartIntents(window.sessionStorage); } catch { /* logout must continue */ }
      window.location.replace(LOGIN_URL);
    } else if (status === 'signed-in' && user?.id) {
      try { clearSpeakingStartIntents(window.sessionStorage, user.id); } catch { /* storage may be unavailable */ }
    }
  }, [status, user?.id]);

  useEffect(() => {
    const st: State = {
      perms: [...DEFAULT_PERMISSIONS],
      modalPart: 1, modalMode: 'practice', activeTopicTab: 'list',
      pracPart: 1, pracTopicPart: 1, pbpPart: 1, mainTab: 'dashboard', dead: false, starter: null,
      accountId: null, permissionsReady: false, permissionAccount: null, drafts: new Map(), wantedTopics: {}, topicReads: {}, saveDraft: () => {}, restoreMode: () => {},
    };
    const cleanups: Array<() => void> = [];
    let runtimeApi: any | null = null;
    let runtimeApiPromise: Promise<any | null> | null = null;
    let edited = false;
    let initialConfirmation = true;
    let profileRead = 0;
    const pendingEdits = new Map<string, { base: any; patch: Record<string, any> }>();
    const syncDraftControls = () => {
      const modalOpen = Boolean($('topic-modal')?.classList.contains('open'));
      const visible = Boolean(st.accountId) || edited;
      const pageBar = $('speaking-draft-controls');
      const modalBar = $('speaking-modal-draft-controls');
      if (pageBar) pageBar.hidden = !visible || modalOpen;
      if (modalBar) modalBar.hidden = !visible || !modalOpen;
      const discard = $('speaking-draft-discard') as HTMLButtonElement | null;
      if (discard) discard.disabled = modalOpen || st.mainTab === 'dashboard';
    };
    const draft = (scope: string) => {
      if (!st.accountId || st.accountId !== accountRef.current) return null;
      if (!st.drafts.has(scope)) st.drafts.set(scope, createLearnerTabDrafts({
        accountId: st.accountId, scope: 'speaking:' + scope, version: 'preparation-v1',
        getAccountId: () => st.accountId === accountRef.current ? st.accountId : null,
        validate: value => validSpeakingPreparation(scope, value),
      }));
      return st.drafts.get(scope)!;
    };
    const preparation = (scope: string): any => {
      if (scope.startsWith('modal:')) return { tab: st.activeTopicTab,
        questions: val('myq-input'), customTopic: val('topic-custom-input'),
        topic: st.wantedTopics['topic-select'] ?? selectedTopic(st, 'topic-select', st.modalPart) };
      if (scope === 'practice') return { part: st.pracPart, topicPart: st.pracTopicPart,
        questions: val('prac-custom-q'), customTopic: val('prac-topic-custom'),
        topic: st.wantedTopics['prac-topic-select'] ?? selectedTopic(st, 'prac-topic-select', st.pracTopicPart) };
      if (scope === 'partbpart') return { part: st.pbpPart, customTopic: val('pbp-topic-custom'),
        topic: st.wantedTopics['pbp-topic-select'] ?? selectedTopic(st, 'pbp-topic-select', st.pbpPart) };
      return { topics: ['ft-p1-topic-1', 'ft-p1-topic-2', 'ft-p1-topic-3', 'ft-p2-topic'].map(val) };
    };
    const markEdit = (scope: string, ...keys: string[]) => {
      if (st.permissionsReady) return;
      const value = preparation(scope);
      const pending = pendingEdits.get(scope) ?? { base: value, patch: {} };
      for (const key of keys) pending.patch[key] = key.startsWith('topics:') ? value.topics[Number(key.slice(7))] : value[key];
      pendingEdits.set(scope, pending);
    };
    const savePreparation = (scope: string) => {
      const handle = draft(scope);
      let value = preparation(scope);
      if (!st.permissionsReady) {
        // Blank controls awaiting identity/permissions are not empty edits.
        // Preserve the validated account draft and apply only actual actions;
        // old values become visible only through the permission-gated restore.
        const saved = handle?.read();
        const pending = pendingEdits.get(scope);
        value = { ...(saved?.restored ? saved.value : pending?.base ?? value) };
        if (Array.isArray(value.topics)) value.topics = [...value.topics];
        for (const [key, text] of Object.entries(pending?.patch ?? {})) {
          if (key.startsWith('topics:')) value.topics[Number(key.slice(7))] = text;
          else value[key] = text;
        }
      }
      return handle?.save(value);
    };
    st.saveDraft = () => {
      if (st.dead) return;
      edited = true;
      syncDraftControls();
      if (!st.accountId) { draftNotice('unavailable'); return; }
      const modalOpen = Boolean($('topic-modal')?.classList.contains('open'));
      const panel = draft('panel')?.save({ panel: st.mainTab, modalOpen, part: st.modalPart, mode: st.modalMode });
      const scopes = new Set(st.permissionsReady ? [] : pendingEdits.keys());
      const scope = modalOpen ? `modal:${st.modalMode}:${st.modalPart}` : st.mainTab;
      if (scope !== 'dashboard') scopes.add(scope);
      const saved = [...scopes].map(savePreparation);
      draftNotice(panel?.status === 'unavailable' || saved.some(result => result?.status === 'unavailable') ? 'unavailable' : 'saved');
    };
    st.restoreMode = (scope: string) => {
      if (!st.accountId || !st.permissionsReady || st.permissionAccount !== st.accountId || st.dead) return;
      const permission = scope === 'practice' || scope.startsWith('modal:practice:') ? 'practice_single'
        : scope === 'partbpart' || scope.startsWith('modal:test_part:') ? 'practice_part' : scope === 'fulltest' ? 'practice_full' : null;
      if (permission && !hasPermission(st.perms, permission)) return;
      const saved = draft(scope)?.read();
      if (saved?.restored) {
        const v = saved.value;
        const set = (id: string, text: string) => { const input = $(id) as HTMLInputElement | null; if (input) input.value = text; };
        if (scope === 'practice') {
          st.pracPart = v.part; st.pracTopicPart = v.topicPart;
          [1, 2, 3].forEach(p => { $('prac-part-' + p)?.classList.toggle('selected', p === v.part); $('prac-tp-part-' + p)?.classList.toggle('selected', p === v.topicPart); });
          set('prac-custom-q', v.questions); set('prac-topic-custom', v.customTopic);
          st.wantedTopics['prac-topic-select'] = v.topic;
          applyCueCardCopy('prac-custom-q', v.part); evaluateCueCardWarning('prac-custom-q', 'prac-custom-q-length-warning', v.part);
        } else if (scope === 'partbpart') { st.pbpPart = v.part; set('pbp-topic-custom', v.customTopic); st.wantedTopics['pbp-topic-select'] = v.topic; }
        else if (scope === 'fulltest') ['ft-p1-topic-1', 'ft-p1-topic-2', 'ft-p1-topic-3', 'ft-p2-topic'].forEach((id, i) => set(id, v.topics[i]));
        else if (scope.startsWith('modal:')) {
          set('myq-input', v.questions); set('topic-custom-input', v.customTopic);
          switchTopicTab(v.tab, st); st.wantedTopics['topic-select'] = v.topic;
          evaluateCueCardWarning('myq-input', 'myq-input-length-warning', st.modalPart);
        }
        draftNotice('ready', true);
      }
    };
    const restoreDraft = () => {
      if (edited || !st.accountId || !st.permissionsReady || st.permissionAccount !== st.accountId || st.dead) return;
      const panel = draft('panel')?.read();
      if (panel?.status === 'unavailable') { draftNotice('unavailable'); return; }
      if (!panel?.restored) return;
      const value = panel.value;
      const scope = value.panel;
      const permission = scope === 'practice' ? 'practice_single' : scope === 'partbpart' ? 'practice_part' : scope === 'fulltest' ? 'practice_full' : null;
      if (permission && !hasPermission(st.perms, permission)) return;
      st.restoreMode(scope);
      switchMainTab(scope, st, runtimeApi, cleanups);
      draftNotice('ready', true);
      if (value.modalOpen && runtimeApi && hasPermission(st.perms, value.mode === 'practice' ? 'practice_single' : 'practice_part')) {
        // Create the guarded modal handle before opening; topic restore awaits its list.
        draft(`modal:${value.mode}:${value.part}`);
        void openTopicModal(value.part, value.mode, st, runtimeApi);
      }
    };
    const syncDraftIdentity = (next: string | null) => {
      const previous = st.accountId;
      if (!next && statusRef.current === 'signed-out') {
        initialConfirmation = false;
        if (!previous) { pendingEdits.clear(); resetPreparation(st); edited = false; const bar = $('speaking-draft-controls'); if (bar) bar.hidden = true; }
      }
      if (previous === next) return;
      // Initial mount already cleared browser-filled values before wiring any
      // input handlers. Keep preparation entered since then when that document
      // first confirms its account; later account/return boundaries still clear.
      const keepFreshPreparation = initialConfirmation && !previous && Boolean(next) && edited;
      if (next) initialConfirmation = false;
      profileRead++; st.permissionsReady = false; st.permissionAccount = null;
      st.drafts.forEach(handle => handle.dispose()); st.drafts.clear();
      st.accountId = null;
      if (!keepFreshPreparation) { pendingEdits.clear(); resetPreparation(st); edited = false; }
      if (previous && previous !== next && (next || statusRef.current === 'signed-out')) clearLearnerTabDraftAccount(previous);
      st.accountId = next;
      syncDraftControls();
      if (next) {
        ['panel', 'practice', 'partbpart', 'fulltest', ...['practice', 'test_part'].flatMap(mode => [1, 2, 3].map(part => `modal:${mode}:${part}`))].forEach(draft);
        if (keepFreshPreparation) st.saveDraft();
        else restoreDraft();
        if (runtimeApi && st.permissionAccount !== next) void loadProfile(runtimeApi);
      }
    };
    syncDraftRef.current = syncDraftIdentity;
    // Clear browser-filled values before any optional draft reads.
    resetPreparation(st);
    syncDraftIdentity(accountRef.current);
    const loadProfile = async (api: any) => {
      const account = st.accountId;
      if (!account) return;
      const read = ++profileRead;
      st.permissionsReady = false; st.permissionAccount = null;
      try {
        const profile = await api.get('/auth/me') as AuthMeWire;
        if (st.dead || read !== profileRead || st.accountId !== account
            || profile?.id !== account || profile.id !== accountRef.current) return;
        renderUser(profile, api, st);
        st.permissionAccount = profile.id;
        st.permissionsReady = Array.isArray(profile.permissions);
        if (edited) {
          st.restoreMode(st.mainTab);
          loadMainTabData(st.mainTab, st, api);
          if ($('topic-modal')?.classList.contains('open')) {
            st.restoreMode(`modal:${st.modalMode}:${st.modalPart}`);
            void loadTopicsInto('topic-select', st.modalPart, api, st);
          }
        } else restoreDraft();
        if (st.permissionsReady) pendingEdits.clear();
      } catch { if (!st.dead && read === profileRead && st.accountId === account) { st.permissionsReady = false; draftNotice('unavailable'); } }
    };
    const resolveRuntimeApi = () => {
      if (runtimeApi) return Promise.resolve(runtimeApi);
      if (!runtimeApiPromise) {
        runtimeApiPromise = whenGlobalReady(
          () => isSpeakingApiReady(window),
          'window.api + Supabase client (speaking)',
        ).then((ok) => {
          if (st.dead) return null;
          if (!ok) {
            // A later user action may retry after the runtime recovers;
            // concurrent callers still share this single readiness attempt.
            runtimeApiPromise = null;
            return null;
          }
          runtimeApi = (window as any).api;
          return runtimeApi;
        });
      }
      return runtimeApiPromise;
    };
    // `document` không phải `Element` — uỷ quyền sự kiện ở cấp tài liệu là có
    // thật (nút "quay lại dashboard"), nên kiểu phải nhận cả hai.
    const on = (el: Element | Document | Window | VisualViewport | null, ev: string, fn: any) => {
      if (!el) return;
      el.addEventListener(ev, fn);
      cleanups.push(() => el.removeEventListener(ev, fn));
    };
    const inputEdit = (id: string) => {
      const field = id === 'prac-custom-q' || id === 'myq-input' ? 'questions'
        : id.endsWith('-select') ? 'topic' : 'customTopic';
      const scope = id.startsWith('prac-') ? 'practice' : id.startsWith('pbp-') ? 'partbpart'
        : id.startsWith('ft-') ? 'fulltest' : `modal:${st.modalMode}:${st.modalPart}`;
      const fullIndex = ['ft-p1-topic-1', 'ft-p1-topic-2', 'ft-p1-topic-3', 'ft-p2-topic'].indexOf(id);
      markEdit(scope, fullIndex < 0 ? field : `topics:${fullIndex}`);
      st.saveDraft();
    };
    for (const id of PREPARATION_FIELDS) on($(id), 'input', () => inputEdit(id));
    for (const id of PREPARATION_SELECTS) on($(id), 'change', () => inputEdit(id));
    const discardPreparation = () => {
      const modalOpen = Boolean($('topic-modal')?.classList.contains('open'));
      const scope = modalOpen ? `modal:${st.modalMode}:${st.modalPart}` : st.mainTab;
      pendingEdits.delete(scope);
      const discarded = draft(scope)?.discard();
      const clear = (ids: string[]) => ids.forEach(id => { const input = $(id) as HTMLInputElement | null; if (input) input.value = ''; });
      if (modalOpen) { clear(['myq-input', 'topic-custom-input', 'topic-select']); delete st.wantedTopics['topic-select']; switchTopicTab('list', st); }
      else if (scope === 'practice') {
        clear(['prac-custom-q', 'prac-topic-custom', 'prac-topic-select']); delete st.wantedTopics['prac-topic-select'];
        st.pracPart = 1; st.pracTopicPart = 1;
        [1, 2, 3].forEach(p => { $('prac-part-' + p)?.classList.toggle('selected', p === 1); $('prac-tp-part-' + p)?.classList.toggle('selected', p === 1); });
        applyCueCardCopy('prac-custom-q', 1); evaluateCueCardWarning('prac-custom-q', 'prac-custom-q-length-warning', 1);
        if (runtimeApi) void loadTopicsInto('prac-topic-select', 1, runtimeApi, st);
      } else if (scope === 'partbpart') { clear(['pbp-topic-custom', 'pbp-topic-select']); delete st.wantedTopics['pbp-topic-select']; st.pbpPart = 1; if (runtimeApi) selectPbpPart(1, st, runtimeApi); }
      else if (scope === 'fulltest') clear(['ft-p1-topic-1', 'ft-p1-topic-2', 'ft-p1-topic-3', 'ft-p2-topic']);
      edited = true;
      draft('panel')?.save({ panel: st.mainTab, modalOpen, part: st.modalPart, mode: st.modalMode });
      draftNotice(discarded?.status === 'unavailable' ? 'unavailable' : 'discarded');
    };
    on($('speaking-draft-discard'), 'click', discardPreparation);
    on($('speaking-modal-draft-discard'), 'click', discardPreparation);
    const conceal = () => { initialConfirmation = false; pendingEdits.clear(); profileRead++; st.permissionsReady = false; st.permissionAccount = null; st.accountId = null; resetPreparation(st); const bar = $('speaking-draft-controls'); if (bar) bar.hidden = true; };
    on(window, 'pagehide', conceal);
    const resume = async (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      conceal();
      try {
        const result = await (window as any).getSupabase()?.auth.getSession();
        if (st.dead) return;
        const current = result?.error ? null : result?.data?.session?.user?.id;
        if (current && current === accountRef.current) { edited = false; syncDraftIdentity(current); }
        else { st.drafts.forEach(handle => handle.dispose()); st.drafts.clear(); }
      } catch { /* Concealed until a confirmed session is available. */ }
    };
    on(window, 'pageshow', resume);

    // Bind the route's primary navigation synchronously with the effect. It
    // must not wait for afterInteractive globals or `/auth/me`: these actions
    // only switch visible panels and can safely defer their data request.
    document.querySelectorAll<HTMLElement>('.mode-card[data-mode]').forEach((card) => {
      on(card, 'click', (e: Event) => {
        e.preventDefault();
        switchMainTab(card.dataset.mode || 'dashboard', st, runtimeApi, cleanups);
        st.saveDraft();
      });
    });
    on(document, 'click', (e: any) => {
      const back = e.target?.closest?.('[data-action="back-to-dashboard"]');
      if (back && back.closest('#tab-practice, #tab-partbpart, #tab-fulltest')) {
        e.preventDefault();
        switchMainTab('dashboard', st, runtimeApi, cleanups);
        st.saveDraft();
      }
    });
    on($('dash-empty-start'), 'click', (e: Event) => {
      e.preventDefault();
      switchMainTab('practice', st, runtimeApi, cleanups);
      st.saveDraft();
    });
    // Part selection is local UI state and must not wait for window.api. A
    // staging journey exposed the race: the learner selected Part 2 while the
    // runtime script was still loading, the click was dropped, and the later
    // session POST silently used Part 1. When API is already ready we refresh
    // topics immediately; otherwise the shared readiness continuation below
    // hydrates the currently selected Part once.
    [1, 2, 3].forEach((p) => {
      on($('prac-part-' + p), 'click', () => {
        st.pracPart = p;
        [1, 2, 3].forEach((q) => $('prac-part-' + q)?.classList.toggle('selected', q === p));
        applyCueCardCopy('prac-custom-q', p);
        evaluateCueCardWarning('prac-custom-q', 'prac-custom-q-length-warning', p);
        markEdit('practice', 'part');
        st.saveDraft();
      });
      on($('prac-tp-part-' + p), 'click', () => {
        st.pracTopicPart = p;
        delete st.wantedTopics['prac-topic-select'];
        [1, 2, 3].forEach((q) => $('prac-tp-part-' + q)?.classList.toggle('selected', q === p));
        if (runtimeApi) void loadTopicsInto('prac-topic-select', p, runtimeApi, st);
        markEdit('practice', 'topicPart', 'topic');
        st.saveDraft();
      });
    });
    // Validation must exist as soon as the panel can be opened. Keeping this
    // handler behind the API readiness wait created a dead interval where an
    // immediate click silently did nothing. A valid early submission waits on
    // the shared readiness promise; an invalid one is rejected synchronously.
    on($('prac-topic-start'), 'click', async (e: any) => {
      e.preventDefault();
      const btn = e.currentTarget as HTMLButtonElement;
      const topic = val('prac-topic-custom').trim() || selectedTopic(st, 'prac-topic-select', st.pracTopicPart);
      // Submit the selection made at this click. Auth readiness may reset the
      // preparation UI while the runtime is loading; it must not change Part.
      const part = st.pracTopicPart;
      const err = $('prac-topic-error');
      if (err) err.textContent = '';
      if (!topic) {
        if (err) err.textContent = 'Vui lòng chọn hoặc nhập chủ đề.';
        return;
      }
      const idleLabel = '🚀 Bắt đầu tạo câu hỏi';
      // Lock synchronously, before the readiness await. Native button clicks
      // are then suppressed while the shared promise is pending, so two quick
      // clicks cannot wake up into two independent session POSTs.
      btn.disabled = true;
      btn.textContent = 'Đang chuẩn bị...';
      const api = await resolveRuntimeApi();
      if (!api) {
        if (!st.dead) {
          if (err) err.textContent = 'Lỗi: Không thể tải kết nối. Hãy thử lại.';
          btn.disabled = false;
          btn.textContent = idleLabel;
        }
        return;
      }
      return startFromTopic({
        topic, mode: 'practice', part, errorId: 'prac-topic-error',
        btn, idleLabel, api, st,
      });
    });

    (async () => {
      const api = await resolveRuntimeApi();
      if (!api || st.dead) return;
      // A user may already have entered a mode while the legacy API global was
      // loading. Hydrate that active panel now instead of discarding the click.
      loadMainTabData(st.mainTab, st, api);

      // ── Cue card: theo dõi độ dài, gộp phím trong 300ms ─────────────────
      const bindWatcher = (taId: string, warnId: string, getPart: () => number) => {
        const ta = $(taId);
        if (!ta) return;
        let timer: any = null;
        const fn = () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => evaluateCueCardWarning(taId, warnId, getPart()), 300);
        };
        on(ta, 'input', fn);
        cleanups.push(() => { if (timer) clearTimeout(timer); });
      };
      bindWatcher('prac-custom-q', 'prac-custom-q-length-warning', () => st.pracPart);
      bindWatcher('myq-input', 'myq-input-length-warning', () => st.modalPart);

      // ── Modal chủ đề ────────────────────────────────────────────────────
      on(window, 'resize', syncTopicModalViewport);
      on(window.visualViewport, 'resize', syncTopicModalViewport);
      on(window.visualViewport, 'scroll', syncTopicModalViewport);
      on($('topic-modal'), 'click', (e: any) => {
        if (e.target === $('topic-modal')) { closeTopicModal(); st.saveDraft(); }
      });
      on(document, 'keydown', (e: KeyboardEvent) => {
        const modal = $('topic-modal');
        if (!modal || !modal.classList.contains('open')) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          closeTopicModal();
          st.saveDraft();
          return;
        }
        if (e.key !== 'Tab') return;
        const focusable = Array.from(modal.querySelectorAll<HTMLElement>(
          'button:not([disabled]), select:not([disabled]), input:not([disabled]), '
          + 'textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        )).filter((el) => !el.hidden && el.getAttribute('aria-hidden') !== 'true'
          && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden');
        if (!focusable.length) {
          e.preventDefault();
          modal.querySelector<HTMLElement>('[role="dialog"]')?.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      });
      // Modal chỉ có MỘT nút đóng trong bản legacy — không có nút "Huỷ" riêng.
      // Bản đầu của tệp này gắn thêm `modal-cancel`, một id không tồn tại ở đâu
      // cả; chốt chặn `speaking-behavior-hooks.test.mjs` bắt được.
      on($('modal-close'), 'click', () => { closeTopicModal(); st.saveDraft(); });
      (['list', 'custom', 'myq'] as const).forEach((t) => {
        on($('tab-' + t), 'click', () => { switchTopicTab(t, st); markEdit(`modal:${st.modalMode}:${st.modalPart}`, 'tab'); st.saveDraft(); });
      });
      on($('btn-confirm'), 'click', async () => {
        const btn = $('btn-confirm') as HTMLButtonElement | null;
        if (st.activeTopicTab === 'myq') {
          await startFromCustomQuestions({
            textareaId: 'myq-input', errorId: 'modal-error', btn,
            part: st.modalPart, mode: st.modalMode, idleLabel: '✍️ Bắt đầu luyện tập',
            api, st, onSuccess: closeTopicModal,
          });
          return;
        }
        const topic = st.activeTopicTab === 'list'
          ? selectedTopic(st, 'topic-select', st.modalPart)
          : val('topic-custom-input').trim();
        if (!topic) {
          const err = $('modal-error');
          if (err) {
            err.textContent = st.activeTopicTab === 'list'
              ? 'Vui lòng chọn một chủ đề từ danh sách.'
              : 'Vui lòng nhập chủ đề trước khi bắt đầu.';
          }
          return;
        }
        await startFromTopic({
          topic, mode: st.modalMode, part: st.modalPart, errorId: 'modal-error',
          btn, idleLabel: '🚀 Bắt đầu tạo câu hỏi', api, st, onSuccess: closeTopicModal,
        });
      });

      // ── Panel Luyện tập ─────────────────────────────────────────────────
      [1, 2, 3].forEach((p) => {
        on($('pbp-card-' + p), 'click', () => { delete st.wantedTopics['pbp-topic-select']; selectPbpPart(p, st, api); markEdit('partbpart', 'part', 'topic'); st.saveDraft(); });
      });

      on($('prac-custom-q-start'), 'click', (e: any) => startFromCustomQuestions({
        textareaId: 'prac-custom-q', errorId: 'prac-custom-q-error', btn: e.currentTarget,
        part: st.pracPart, mode: 'practice', idleLabel: '✍️ Bắt đầu luyện tập', api, st,
      }));

      // ── Từng Part ───────────────────────────────────────────────────────
      on($('pbp-start'), 'click', (e: any) => {
        const topic = val('pbp-topic-custom').trim() || selectedTopic(st, 'pbp-topic-select', st.pbpPart);
        const err = $('pbp-error');
        if (err) err.textContent = '';
        if (!topic) {
          if (err) err.textContent = 'Vui lòng chọn hoặc nhập chủ đề.';
          return;
        }
        return startFromTopic({
          topic, mode: 'test_part', part: st.pbpPart, errorId: 'pbp-error',
          btn: e.currentTarget, idleLabel: '🚀 Bắt đầu luyện tập', api, st,
        });
      });

      // ── Full Test ───────────────────────────────────────────────────────
      on($('ft-start'), 'click', async (e: any) => {
        const errEl = $('ft-error');
        if (errEl) errEl.textContent = '';
        const btn = e.currentTarget as HTMLButtonElement;
        btn.disabled = true; btn.textContent = 'Đang chuẩn bị...';
        try {
          const selected = [val('ft-p1-topic-1').trim(), val('ft-p1-topic-2').trim(), val('ft-p1-topic-3').trim(), val('ft-p2-topic').trim()];
          const { sessionId: sid, nextPartTopic: p2Topic } = await getStarter(st, api).start({
            slot: 'full', intent: selected,
            prepare: async () => {
              const t1 = selected[0] || await randomTopic(1, api);
              const t2 = selected[1] || await randomTopic(1, api);
              const t3 = selected[2] || await randomTopic(1, api);
              const nextPartTopic = selected[3] || await randomTopic(2, api);
              return { body: { mode: 'test_full', part: 1, topic: [t1, t2, t3].join('|||') }, nextPartTopic };
            },
          });
          if (st.dead) return;
          // practice.js đọc lại khoá này khi nối sang Part 2 — hợp đồng ngầm
          // giữa hai trang (đã ghi ở SPIKE 2).
          try { sessionStorage.setItem('ielts_ft_p2topic', p2Topic); } catch { /* riêng tư/đầy */ }
          goToPractice(sid);
        } catch (err: any) {
          if (st.dead) return;
          showStartError(errEl, err, st, 'full');
          btn.disabled = false; btn.textContent = '🏆 Bắt đầu Full Test';
        }
      });

      // ── Hai nút còn lại của bản legacy ──────────────────────────────────
      // `switchMainTab('practice')` ở trạng thái rỗng của dashboard, và
      // `openTopicModal(1, 'practice')` ở CTA của khu ngữ pháp. Cả hai vốn là
      // handler nội tuyến không có id; vỏ nay gắn id cho chúng.
      //
      // KHÔNG port `startPractice()`: quét toàn bộ markup legacy thì KHÔNG nút
      // nào gọi nó (0 handler). Bản đầu của tệp này tự nghĩ ra một móc
      // `[data-start-part]` cho nó — tức là dựng giao diện chưa từng tồn tại.
      // Đã bỏ. Nếu sau này có đường gọi thật thì thêm cùng với nút thật.
      on($('grammar-cta-start'), 'click', () => openTopicModal(1, 'practice', st, api));
      // ── Quyền + lời chào — SAU KHI đã gắn listener ──────────────────────
      // THỨ TỰ QUAN TRỌNG. Bản đầu `await api.get('/auth/me')` TRƯỚC khi gắn
      // listener, nên trong suốt vòng đi-về đó mọi cú bấm rơi vào hư không —
      // bản legacy gắn ở `DOMContentLoaded`, độc lập với auth, nên nó không có
      // cửa sổ chết này. Bộ e2e staging bắt đúng chỗ: `#tab-practice` không bao
      // giờ `active` sau khi bấm thẻ mode.
      //
      // Kiểm cục bộ của tôi LỌT vì nó chờ 2.5s rồi mới bấm — đã siết lại để
      // bấm ngay, đúng như người dùng thật.
      //
      // An toàn khi gắn trước: quyền chỉ ẨN/KHOÁ giao diện, còn backend vẫn gác
      // thật. Người không có quyền bấm được nút trong vài trăm ms đầu thì cũng
      // chỉ nhận 403 — khác hẳn với việc người CÓ quyền bấm mà không có gì xảy ra.
      await loadProfile(api);
    })();

    return () => {
      st.dead = true;
      st.starter?.dispose();
      st.drafts.forEach(handle => handle.dispose());
      syncDraftRef.current = null;
      cleanups.forEach((fn) => fn());
    };
  // Listener wiring is intentionally independent of the asynchronous auth
  // state. The protected route still redirects signed-out users above and the
  // backend remains authoritative, while a signed-in user's first click can
  // no longer land before React has attached the dashboard controls.
  }, []);

  return null;
}
