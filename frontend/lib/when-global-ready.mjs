// Chờ một global của lớp legacy xuất hiện, thay vì kiểm một lần rồi bỏ.
//
// VÌ SAO CẦN — đo trên production 2026-08-03, 20 lần tải ẩn danh trang bài
// Grammar: `window.api` và `window.getSupabase` có mặt **20/20** SAU khi trang
// lắng, nhưng nút "Lưu bài" chỉ có **11/20**, và thanh CTA khách còn `hidden` ở
// ĐÚNG 9 lần thiếu đó. Global CÓ, chỉ là tới MUỘN hơn lúc effect chạy — mà các
// effect kiểm đúng một lần rồi `return` im lặng.
//
// Vì sao tới muộn: `/js/api.js` là `<script defer>` xếp SAU script Supabase UMD
// tải từ CDN jsdelivr, nên nó chỉ CHẠY sau khi CDN đó xong. Đo được: api.js tải
// xong ~300–355ms nhưng `window.api` mãi 375–534ms mới có, bám sát mốc CDN hoàn
// tất (337–484ms). React hydrate độc lập với chuỗi đó nên bên nào thắng là may
// rủi — 45% số lượt là effect thắng, và người dùng mất tính năng.
//
// Hết giờ chờ thì BÁO LÊN, không nuốt: một tính năng biến mất im lặng đúng là
// thứ đã giúp lỗi này sống sót qua cả cửa sổ soak 48h của pilot 2.
//
// Tách thành module riêng (và là `.mjs`) để `node --test` kiểm được HÀNH VI
// thật — vòng review trước đã chỉ ra chốt chặn bằng regex trên mã nguồn là yếu.

/**
 * @param {() => boolean} ready   điều kiện sẵn sàng
 * @param {string} what           tên global, dùng khi báo lỗi
 * @param {{timeoutMs?: number, stepMs?: number, now?: () => number,
 *          sleep?: (ms: number) => Promise<void>, report?: (m: string) => void}} [opts]
 * @returns {Promise<boolean>}
 */
export async function whenGlobalReady(ready, what, opts = {}) {
  const {
    timeoutMs = 10000,
    stepMs = 50,
    now = () => Date.now(),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    report,
  } = opts;

  if (ready()) return true;
  const started = now();
  while (now() - started < timeoutMs) {
    await sleep(stepMs);
    if (ready()) return true;
  }

  const msg = `[when-global-ready] ${what} không xuất hiện sau ${timeoutMs}ms`;
  if (report) { report(msg); return false; }
  try {
    // Bề mặt THẬT là `window.aver.reportError(message, extra)` —
    // `error-reporter.js:321`, nhận CHUỖI chứ không nhận `Error`. Bản đầu của
    // tôi gọi `window.averReportError(new Error(...))`, một cái tên KHÔNG TỒN
    // TẠI ở đâu trong repo, nên nhánh "báo lên" chưa bao giờ tới telemetry mà
    // chỉ rơi xuống `console.error` — đúng kiểu hỏng im lặng mà chính bản vá
    // này tuyên bố chữa. Bắt được ở review PR #908.
    const reporter = /** @type {any} */ (globalThis).window?.aver?.reportError;
    if (typeof reporter === 'function') reporter(msg, { what, timeoutMs });
    else console.error(msg);
  } catch (_) {
    console.error(msg);
  }
  return false;
}
