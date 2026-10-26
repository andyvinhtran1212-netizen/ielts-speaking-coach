// Thân modal "Mẹo viết": chờ `window.renderMarkdown` CÓ HẠN, rồi lùi về
// plaintext đã escape — không bao giờ để thân rỗng.
//
// VÌ SAO — layout nạp `writing-submit-receipt.js` ở chuỗi RIÊNG (để hai danh
// sách không chờ marked → purify → markdown nối tiếp). Hệ quả: trên hard load
// mà chuỗi markdown chậm hơn auth + API tips (rõ nhất với link thẳng
// `?tab=tips&tip=...`), modal mở TRƯỚC khi `window.renderMarkdown` tồn tại.
// Bản cũ thay bằng chuỗi rỗng rồi đánh dấu modal `ready`; không gì render lại
// khi script tới sau. Trước khi tách chuỗi, receipt sẵn sàng ngầm bảo đảm
// markdown cũng sẵn sàng.
//
// Tách thành `.mjs` để `node --test` kiểm HÀNH VI thật (chờ, hết giờ, nâng
// cấp), cùng lý do với `when-global-ready.mjs`.

import { whenGlobalReady } from './when-global-ready.mjs';

// Chờ trong lúc modal còn "Đang tải nội dung…": đủ cho ba script nhỏ tải xong
// trên mạng chậm, đủ ngắn để không giữ người dùng trước một modal trống.
export const TIP_RENDERER_WAIT_MS = 4000;
// Sau khi đã hiện plaintext: tiếp tục canh để nâng cấp lên Markdown.
export const TIP_RENDERER_UPGRADE_MS = 30000;

const RENDERER = 'window.renderMarkdown';

function escapeText(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Plaintext đã escape, giữ xuống dòng. Rỗng chỉ khi nguồn rỗng. */
export function plaintextTipBody(md) {
  const src = String(md == null ? '' : md);
  if (!src.trim()) return '';
  return '<div class="tip-modal-plaintext" style="white-space: pre-wrap">' + escapeText(src) + '</div>';
}

/**
 * Render đồng bộ với renderer hiện có (nếu có).
 * @param {unknown} md
 * @param {unknown} renderer  `window.renderMarkdown` (hoặc undefined)
 * @returns {{html: string, markdown: boolean}}
 */
export function renderTipBody(md, renderer) {
  if (typeof renderer === 'function') {
    try {
      return { html: String(renderer(md) ?? ''), markdown: true };
    } catch (_) { /* lùi về plaintext bên dưới */ }
  }
  return { html: plaintextTipBody(md), markdown: false };
}

/**
 * Chờ renderer CÓ HẠN. Không bao giờ reject; hết giờ thì báo lên (qua
 * `whenGlobalReady`) và trả `false`.
 * @param {() => unknown} getRenderer
 * @param {{timeoutMs?: number, stepMs?: number, now?: () => number,
 *          sleep?: (ms: number) => Promise<void>, report?: (m: string) => void}} [opts]
 * @returns {Promise<boolean>}
 */
export function waitForTipRenderer(getRenderer, opts = {}) {
  return whenGlobalReady(() => typeof getRenderer() === 'function', RENDERER,
    { timeoutMs: TIP_RENDERER_WAIT_MS, ...opts }).catch(() => false);
}

/**
 * Sau khi đã hiện plaintext: canh renderer thêm một khoảng; nếu nó tới VÀ
 * modal vẫn mở đúng mẹo đó (`stillShowing()`), gọi `apply()` để render lại.
 * Không báo lỗi lần hai khi hết giờ (lần chờ đầu đã báo).
 * @param {() => unknown} getRenderer
 * @param {() => boolean} stillShowing
 * @param {() => void} apply
 * @param {{timeoutMs?: number, stepMs?: number, now?: () => number,
 *          sleep?: (ms: number) => Promise<void>}} [opts]
 * @returns {Promise<boolean>}  true nếu đã nâng cấp
 */
export async function upgradeTipWhenRendererArrives(getRenderer, stillShowing, apply, opts = {}) {
  const ok = await waitForTipRenderer(getRenderer, {
    timeoutMs: TIP_RENDERER_UPGRADE_MS, stepMs: 250, ...opts, report: () => {},
  });
  if (!ok || !stillShowing()) return false;
  apply();
  return true;
}
