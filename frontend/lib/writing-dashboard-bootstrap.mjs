// Khởi động trang Writing Dashboard dưới MỘT hạn giờ, kết thúc bằng trạng
// thái nhìn thấy được.
//
// VÌ SAO — #1696 chỉ bọc hạn giờ quanh hai GET danh sách. Trên staging trang
// vẫn thỉnh thoảng đứng mãi ở "Chào em 👋 / Mã học viên: — / Bài giao: Đang
// tải…" mà KHÔNG có lỗi, vì phần treo nằm TRƯỚC hai GET đó:
//   1. `AuthProvider` `await sb.auth.getSession()` không có hạn giờ. supabase-js
//      lấy khoá auth và có thể làm mới token qua mạng trước khi trả về; nếu
//      khoá bị giữ/lần làm mới treo thì `status` kẹt ở `initial-loading`, và
//      effect của trang `return` sớm mỗi lần render → không request nào đi ra.
//   2. `whenGlobalReady(...)` hết giờ trả `false` → effect `return` im lặng.
//   3. Một GET trả `null` (204 / thân rỗng) → `if (!data) return` để danh sách
//      giữ "Đang tải…" vĩnh viễn.
// Ở đây gom cả chuỗi phiên → chuẩn bị → dữ liệu vào một cuộc đua với hạn giờ;
// mọi nhánh thất bại/hết giờ đều gọi `view.error(...)` (hộp lỗi + "Thử lại"),
// còn "không có phiên thật" gọi `view.signedOut()` (về trang đăng nhập).
//
// Tách thành `.mjs` để `node --test` kiểm HÀNH VI thật (getSession không bao
// giờ trả về, GET hồ sơ không bao giờ trả về) — cùng lý do với
// `request-with-timeout.mjs`.

import { withDeadline } from './request-with-timeout.mjs';

/** Chờ AuthProvider ra kết luận về phiên. */
export const WRITING_SESSION_DEADLINE_MS = 15000;
/**
 * Toàn bộ bootstrap sau khi có phiên. Phải lớn hơn hạn chờ global (10s,
 * `whenGlobalReady`) + hạn mỗi GET (15s, `getWithTimeout`) để các lỗi riêng
 * của từng bước — chính xác hơn — kịp hiện trước khi hạn tổng chốt lại.
 */
export const WRITING_BOOTSTRAP_DEADLINE_MS = 30000;

export const WRITING_BOOTSTRAP_MESSAGES = Object.freeze({
  session: 'Không xác nhận được phiên đăng nhập (quá lâu). Vui lòng thử lại.',
  prepare: 'Trang chưa tải xong thành phần cần thiết. Vui lòng thử lại.',
  data: 'Tải dữ liệu bài viết quá lâu. Vui lòng thử lại.',
  failed: 'Không tải được dữ liệu bài viết. Vui lòng thử lại.',
});

/**
 * @typedef {'session' | 'prepare' | 'data'} WritingBootstrapStage
 * @typedef {{stage: WritingBootstrapStage, message: string, timeout: boolean}} WritingBootstrapError
 * @typedef {{
 *   error: (e: WritingBootstrapError) => void,
 *   signedOut: () => void,
 *   ready?: () => void,
 * }} WritingBootstrapView
 */

/**
 * @param {{
 *   getSession: () => any,
 *   prepare?: (session: any) => any,
 *   load: (session: any) => any,
 *   view: WritingBootstrapView,
 *   isCurrent?: () => boolean,
 *   sessionDeadlineMs?: number,
 *   deadlineMs?: number,
 *   setTimer?: (fn: () => void, ms: number) => any,
 *   clearTimer?: (id: any) => void,
 * }} opts
 *   `getSession` → phiên, hoặc `null` khi CHẮC CHẮN không có phiên.
 *   `prepare` / `load` → `false` nghĩa là thất bại có thể thử lại.
 * @returns {Promise<'ready' | 'error' | 'signed-out' | 'stale'>}
 */
export async function runWritingBootstrap(opts) {
  const {
    getSession, prepare, load, view,
    isCurrent = () => true,
    sessionDeadlineMs = WRITING_SESSION_DEADLINE_MS,
    deadlineMs = WRITING_BOOTSTRAP_DEADLINE_MS,
    setTimer, clearTimer,
  } = opts;

  /** @type {WritingBootstrapStage} */
  let stage = 'session';
  // Khi hạn giờ đã chốt lỗi, phần chuỗi còn treo có settle muộn cũng không được
  // đi tiếp (tải dữ liệu chồng lên hộp lỗi đang hiện).
  let settled = false;
  const live = () => !settled && isCurrent();
  const failure = () => Object.assign(new Error(WRITING_BOOTSTRAP_MESSAGES.failed), { retryable: true });

  const chain = (async () => {
    const session = await withDeadline(getSession(), {
      timeoutMs: sessionDeadlineMs, setTimer, clearTimer,
    });
    if (!live()) return 'stale';
    if (!session) return 'signed-out';
    stage = 'prepare';
    if (prepare && (await prepare(session)) === false) throw failure();
    if (!live()) return 'stale';
    stage = 'data';
    if ((await load(session)) === false) throw failure();
    if (!live()) return 'stale';
    return 'ready';
  })();

  try {
    const outcome = await withDeadline(chain, { timeoutMs: deadlineMs, setTimer, clearTimer });
    settled = true;
    if (!isCurrent()) return 'stale';
    if (outcome === 'signed-out') view.signedOut();
    else if (outcome === 'ready' && view.ready) view.ready();
    return outcome;
  } catch (err) {
    settled = true;
    if (!isCurrent()) return 'stale';
    const timeout = !!(err && /** @type {any} */ (err).timeout);
    const message = stage === 'data' && !timeout
      ? WRITING_BOOTSTRAP_MESSAGES.failed
      : WRITING_BOOTSTRAP_MESSAGES[stage];
    view.error({ stage, message, timeout });
    return 'error';
  }
}

/**
 * Hộp lỗi cấp trang (`#error` trong `page-shell.tsx`) + nút "Thử lại".
 * Lỗi ở bước phiên/chuẩn bị nghĩa là chưa có listener nào được gắn — các tab
 * là vỏ chết, nên ẩn `#content`. Lỗi ở bước dữ liệu giữ `#content`: phần đã
 * tải được (vd danh sách bài đã nộp) vẫn dùng được, kèm lỗi nội tuyến riêng.
 *
 * @param {{getElementById: (id: string) => any}} doc
 * @param {WritingBootstrapError} e
 */
export function showWritingBootstrapError(doc, e) {
  const msg = doc.getElementById('error-message');
  if (msg) msg.textContent = e.message;
  const box = doc.getElementById('error');
  if (box) {
    box.dataset.stage = e.stage;
    box.setAttribute('role', 'alert');
    box.classList.remove('hidden');
  }
  const retry = doc.getElementById('error-retry');
  if (retry) retry.classList.remove('hidden');
  if (e.stage !== 'data') doc.getElementById('content')?.classList.add('hidden');
}

/** @param {{getElementById: (id: string) => any}} doc */
export function clearWritingBootstrapError(doc) {
  const box = doc.getElementById('error');
  if (box) {
    box.classList.add('hidden');
    delete box.dataset.stage;
  }
  doc.getElementById('content')?.classList.remove('hidden');
}
