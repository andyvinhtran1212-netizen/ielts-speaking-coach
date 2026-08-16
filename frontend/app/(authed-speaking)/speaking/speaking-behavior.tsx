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
import { useEffect, useRef } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { admitCorePlayer } from '@/lib/core-player-affinity.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';
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
  dead: boolean;
};

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

function switchMainTab(tab: string, st: State, api: any, cleanups: Array<() => void>) {
  ['dashboard', 'practice', 'partbpart', 'fulltest'].forEach((t) => {
    const panel = $('tab-' + t);
    if (panel) panel.classList.toggle('active', t === tab);
  });
  if (tab === 'practice') loadTopicsInto('prac-topic-select', st.pracTopicPart, api, st);
  if (tab === 'partbpart') selectPbpPart(st.pbpPart, st, api);
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
  select.innerHTML = '<option value="" disabled selected>— Đang tải... —</option>';
  select.disabled = true;
  try {
    const topics = await api.get('/topics?part=' + part);
    if (st.dead) return;
    select.innerHTML = '';
    if (!topics || topics.length === 0) {
      select.innerHTML = '<option value="" disabled selected>— Không có chủ đề —</option>';
    } else {
      select.innerHTML = '<option value="" disabled selected>— Chọn chủ đề —</option>';
      topics.forEach((t: any) => {
        const o = document.createElement('option');
        o.value = t.title;
        o.textContent = t.title + (t.category ? ' · ' + t.category : '');
        select.appendChild(o);
      });
    }
    select.disabled = false;
  } catch {
    select.innerHTML = '<option value="" disabled selected>— Không thể tải —</option>';
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

/** `/sessions` trả `id` hoặc `session_id` tuỳ đường — legacy chấp nhận cả hai. */
function sessionIdOf(s: any): string | null {
  return (s && (s.id || s.session_id)) || null;
}

function goToPractice(sessionId: string) {
  window.location.href = admitCorePlayer('speaking', { session_id: sessionId });
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

function closeTopicModal() {
  $('topic-modal')?.classList.remove('open');
  document.body.style.overflow = '';
}

async function openTopicModal(part: number, mode: string, st: State, api: any) {
  st.modalPart = part;
  st.modalMode = mode || 'practice';

  const sub = $('modal-subtitle');
  if (sub) sub.textContent = 'Bạn muốn luyện tập Part ' + part + ' với chủ đề nào?';
  const err = $('modal-error');
  if (err) err.textContent = '';
  const custom = $('topic-custom-input') as HTMLInputElement | null;
  if (custom) custom.value = '';
  applyCueCardCopy('myq-input', part);
  evaluateCueCardWarning('myq-input', 'myq-input-length-warning', part);
  switchTopicTab('list', st);

  const select = $('topic-select') as HTMLSelectElement | null;
  if (select) {
    select.innerHTML = '<option value="" disabled selected>— Đang tải danh sách... —</option>';
    select.disabled = true;
  }
  $('topic-modal')?.classList.add('open');
  document.body.style.overflow = 'hidden';

  try {
    const topics = await api.get('/topics?part=' + part);
    if (st.dead || !select) return;
    select.innerHTML = '';
    if (!topics || topics.length === 0) {
      select.innerHTML = '<option value="" disabled selected>— Không có chủ đề nào —</option>';
      switchTopicTab('custom', st);   // không có chủ đề ⇒ đẩy thẳng sang tự nhập
    } else {
      select.innerHTML = '<option value="" disabled selected>— Chọn một chủ đề —</option>';
      topics.forEach((t: any) => {
        const opt = document.createElement('option');
        opt.value = t.title;
        opt.textContent = t.title + (t.category ? ' · ' + t.category : '');
        select.appendChild(opt);
      });
      select.disabled = false;
    }
  } catch {
    if (select) select.innerHTML = '<option value="" disabled selected>— Không thể tải danh sách —</option>';
    switchTopicTab('custom', st);
  }
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

  let questions: any;
  try {
    questions = await detector.parseCustomQuestionsByPart(raw, part);
  } catch (e: any) {
    if (errEl) errEl.textContent = 'Lỗi: ' + (e?.message || 'Không thể chuẩn bị câu hỏi.');
    reset(); return;
  }
  if (st.dead) return;
  if (!questions || !questions.length) {
    if (errEl) errEl.textContent = 'Không tìm thấy câu hỏi hợp lệ.';
    reset(); return;
  }
  const isCueCard = typeof questions[0] === 'object' && questions[0].type === 'cue_card';
  const sessionPart = isCueCard ? 2 : part;

  try {
    const session = await api.post('/sessions', { mode, part: sessionPart, topic: 'Custom questions' });
    const sid = sessionIdOf(session);
    if (!sid) throw new Error('Server không trả về session hợp lệ. Hãy thử lại.');
    await api.post('/sessions/' + sid + '/questions/custom', { questions });
    opts.onSuccess?.();
    goToPractice(sid);
  } catch (e: any) {
    if (errEl) errEl.textContent = 'Lỗi: ' + (e?.message || 'Không thể tạo session.');
    reset();
  }
}

/** Tạo phiên theo CHỦ ĐỀ — dùng chung cho modal, panel Luyện tập và từng Part. */
async function startFromTopic(opts: {
  topic: string; mode: string; part: number; errorId: string;
  btn: HTMLButtonElement | null; idleLabel: string; api: any; onSuccess?: () => void;
}) {
  const { topic, mode, part, errorId, btn, idleLabel, api } = opts;
  const errEl = $(errorId);
  if (btn) { btn.disabled = true; btn.textContent = 'Đang tạo session...'; }
  try {
    const session = await api.post('/sessions', { mode, part, topic });
    const sid = sessionIdOf(session);
    if (!sid) throw new Error('Server không trả về session hợp lệ. Hãy thử lại.');
    opts.onSuccess?.();
    goToPractice(sid);
  } catch (e: any) {
    if (errEl) errEl.textContent = 'Lỗi: ' + (e?.message || 'Không thể tạo session.');
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
  const { status } = useAuth();
  const ranRef = useRef(false);

  // Cổng fail-closed (ADR-011): rời trang bằng replace() để nút Back không dựng
  // lại trang riêng tư từ lịch sử. Bản legacy tương ứng: `requireAuth()` đẩy về
  // `../login` khi không có phiên.
  useEffect(() => {
    if (status === 'signed-out') window.location.replace(LOGIN_URL);
  }, [status]);

  useEffect(() => {
    if (status !== 'signed-in' || ranRef.current) return;
    ranRef.current = true;

    const st: State = {
      perms: [...DEFAULT_PERMISSIONS],
      modalPart: 1, modalMode: 'practice', activeTopicTab: 'list',
      pracPart: 1, pracTopicPart: 1, pbpPart: 1, dead: false,
    };
    const cleanups: Array<() => void> = [];
    // `document` không phải `Element` — uỷ quyền sự kiện ở cấp tài liệu là có
    // thật (nút "quay lại dashboard"), nên kiểu phải nhận cả hai.
    const on = (el: Element | Document | null, ev: string, fn: any) => {
      if (!el) return;
      el.addEventListener(ev, fn);
      cleanups.push(() => el.removeEventListener(ev, fn));
    };

    (async () => {
      const ok = await whenGlobalReady(
        () => typeof (window as any).api?.get === 'function',
        'window.api (speaking)',
      );
      if (st.dead) return;
      if (!ok) return;
      const api = (window as any).api;

      // ── Thẻ mode + nút quay lại dashboard ───────────────────────────────
      document.querySelectorAll<HTMLElement>('.mode-card[data-mode]').forEach((card) => {
        on(card, 'click', (e: Event) => {
          e.preventDefault();
          switchMainTab(card.dataset.mode || 'dashboard', st, api, cleanups);
        });
      });
      on(document, 'click', (e: any) => {
        const back = e.target?.closest?.('[data-action="back-to-dashboard"]');
        if (back && back.closest('#tab-practice, #tab-partbpart, #tab-fulltest')) {
          e.preventDefault();
          switchMainTab('dashboard', st, api, cleanups);
        }
      });

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
      on($('topic-modal'), 'click', (e: any) => {
        if (e.target === $('topic-modal')) closeTopicModal();
      });
      // Modal chỉ có MỘT nút đóng trong bản legacy — không có nút "Huỷ" riêng.
      // Bản đầu của tệp này gắn thêm `modal-cancel`, một id không tồn tại ở đâu
      // cả; chốt chặn `speaking-behavior-hooks.test.mjs` bắt được.
      on($('modal-close'), 'click', () => closeTopicModal());
      (['list', 'custom', 'myq'] as const).forEach((t) => {
        on($('tab-' + t), 'click', () => switchTopicTab(t, st));
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
          ? val('topic-select')
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
          btn, idleLabel: '🚀 Bắt đầu tạo câu hỏi', api, onSuccess: closeTopicModal,
        });
      });

      // ── Panel Luyện tập ─────────────────────────────────────────────────
      [1, 2, 3].forEach((p) => {
        on($('prac-part-' + p), 'click', () => {
          st.pracPart = p;
          [1, 2, 3].forEach((q) => $('prac-part-' + q)?.classList.toggle('selected', q === p));
          applyCueCardCopy('prac-custom-q', p);
          evaluateCueCardWarning('prac-custom-q', 'prac-custom-q-length-warning', p);
        });
        on($('prac-tp-part-' + p), 'click', () => {
          st.pracTopicPart = p;
          [1, 2, 3].forEach((q) => $('prac-tp-part-' + q)?.classList.toggle('selected', q === p));
          loadTopicsInto('prac-topic-select', p, api, st);
        });
        on($('pbp-card-' + p), 'click', () => selectPbpPart(p, st, api));
      });

      on($('prac-custom-q-start'), 'click', (e: any) => startFromCustomQuestions({
        textareaId: 'prac-custom-q', errorId: 'prac-custom-q-error', btn: e.currentTarget,
        part: st.pracPart, mode: 'practice', idleLabel: '✍️ Bắt đầu luyện tập', api, st,
      }));

      on($('prac-topic-start'), 'click', (e: any) => {
        const topic = val('prac-topic-custom').trim() || val('prac-topic-select');
        const err = $('prac-topic-error');
        if (err) err.textContent = '';
        if (!topic) {
          if (err) err.textContent = 'Vui lòng chọn hoặc nhập chủ đề.';
          return;
        }
        return startFromTopic({
          topic, mode: 'practice', part: st.pracTopicPart, errorId: 'prac-topic-error',
          btn: e.currentTarget, idleLabel: '🚀 Bắt đầu tạo câu hỏi', api,
        });
      });

      // ── Từng Part ───────────────────────────────────────────────────────
      on($('pbp-start'), 'click', (e: any) => {
        const topic = val('pbp-topic-custom').trim() || val('pbp-topic-select');
        const err = $('pbp-error');
        if (err) err.textContent = '';
        if (!topic) {
          if (err) err.textContent = 'Vui lòng chọn hoặc nhập chủ đề.';
          return;
        }
        return startFromTopic({
          topic, mode: 'test_part', part: st.pbpPart, errorId: 'pbp-error',
          btn: e.currentTarget, idleLabel: '🚀 Bắt đầu luyện tập', api,
        });
      });

      // ── Full Test ───────────────────────────────────────────────────────
      on($('ft-start'), 'click', async (e: any) => {
        const errEl = $('ft-error');
        if (errEl) errEl.textContent = '';
        const btn = e.currentTarget as HTMLButtonElement;
        btn.disabled = true; btn.textContent = 'Đang chuẩn bị...';
        try {
          const t1 = val('ft-p1-topic-1').trim() || await randomTopic(1, api);
          const t2 = val('ft-p1-topic-2').trim() || await randomTopic(1, api);
          const t3 = val('ft-p1-topic-3').trim() || await randomTopic(1, api);
          const p2Topic = val('ft-p2-topic').trim() || await randomTopic(2, api);
          if (st.dead) return;
          // practice.js đọc lại khoá này khi nối sang Part 2 — hợp đồng ngầm
          // giữa hai trang (đã ghi ở SPIKE 2).
          try { sessionStorage.setItem('ielts_ft_p2topic', p2Topic); } catch { /* riêng tư/đầy */ }
          const session = await api.post('/sessions', {
            mode: 'test_full', part: 1, topic: [t1, t2, t3].join('|||'),
          });
          const sid = sessionIdOf(session);
          if (!sid) throw new Error('Server không trả về session hợp lệ. Hãy thử lại.');
          goToPractice(sid);
        } catch (err: any) {
          if (errEl) errEl.textContent = 'Lỗi: ' + (err?.message || 'Không thể tạo session.');
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
      on($('dash-empty-start'), 'click', (e: Event) => {
        e.preventDefault();
        switchMainTab('practice', st, api, cleanups);
      });
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
      try {
        const user = await api.get('/auth/me');
        if (st.dead) return;
        renderUser(user || {}, api, st);
      } catch {
        if (!st.dead) renderUser({}, api, st);
      }
    })();

    return () => {
      st.dead = true;
      cleanups.forEach((fn) => fn());
    };
  }, [status]);

  return null;
}
