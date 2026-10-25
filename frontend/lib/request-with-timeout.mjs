// GET qua transport dùng chung VỚI hạn giờ phía client.
//
// VÌ SAO — `fetch()` KHÔNG có timeout mặc định. Trang Writing Dashboard gọi
// `api.get('/api/writing/my-assignments')` (và `/my-essays`) rồi `await`; lời
// chào + mã học viên chỉ được điền trong nhánh THÀNH CÔNG của hai lời gọi đó
// (`renderStudent`). Nếu backend treo/không phản hồi, `await` không bao giờ
// kết thúc: tab "Bài giao" đứng ở "Đang tải…" mãi mãi và lời chào kẹt ở chữ
// giữ chỗ. Quan sát trên staging sau #1691: 25s+ vẫn không tải.
//
// Bọc lời gọi bằng một AbortController + hạn giờ. Hết giờ thì HỦY request đang
// bay và REJECT bằng một lỗi có cờ `timeout` + thông điệp rõ ràng, để caller
// hiện trạng thái lỗi (có thể thử lại) thay vì quay mãi.
//
// Tách thành `.mjs` để `node --test` kiểm được HÀNH VI thật (hẹn giờ + hủy),
// cùng lý do với `when-global-ready.mjs` — chốt chặn bằng regex trên mã nguồn
// là yếu.

export const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

/**
 * @template T
 * @param {{get: (p: string) => Promise<T>, getWith?: (p: string, h: any, o: any) => Promise<T>}} api
 * @param {string} path
 * @param {{timeoutMs?: number, message?: string, AbortCtor?: any,
 *          setTimer?: (fn: () => void, ms: number) => any,
 *          clearTimer?: (id: any) => void}} [opts]
 * @returns {Promise<T>}
 */
export function getWithTimeout(api, path, opts = {}) {
  const {
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    message = 'Tải dữ liệu quá lâu. Vui lòng tải lại trang.',
    AbortCtor = (typeof AbortController !== 'undefined' ? AbortController : null),
    setTimer = (typeof setTimeout !== 'undefined' ? setTimeout : null),
    clearTimer = (typeof clearTimeout !== 'undefined' ? clearTimeout : null),
  } = opts;

  // Không có AbortController hoặc không có getWith → không hủy được; lùi về
  // lời gọi trần. Vẫn tốt hơn là ép một lối đi không tồn tại.
  const canAbort = !!AbortCtor && typeof api.getWith === 'function' && !!setTimer;
  if (!canAbort) {
    return Promise.resolve(api.get(path));
  }

  const controller = new AbortCtor();

  // VÌ SAO phải đua một lời hứa HẠN GIỜ ĐỘC LẬP thay vì chỉ `abort()`:
  // `api.getWith` (xem `api.js`) `await _getAuthToken()` → `auth.getSession()`
  // TRƯỚC khi tạo `fetch`. Nếu lấy phiên Supabase bị treo, `fetch` chưa bao giờ
  // ra đời nên tín hiệu `abort` không có gì để hủy, và transport KHÔNG BAO GIỜ
  // settle. Nếu lỗi timeout chỉ được tạo trong nhánh reject của transport thì
  // wrapper treo mãi — đúng cái bug "Bài giao" đứng "Đang tải…". Vì vậy khi hết
  // giờ ta REJECT thẳng lời hứa `deadline` bằng lỗi có cờ `timeout`, bất kể
  // transport có settle hay không. `abort()` giữ lại như nỗ lực-tốt-nhất để hủy
  // request đang bay (khi đã chạm tới `fetch`).
  let timer = null;
  const stop = () => {
    if (timer != null && clearTimer) { clearTimer(timer); }
    timer = null;
  };

  const deadline = new Promise((_resolve, reject) => {
    timer = setTimer(() => {
      // Reject TRƯỚC rồi mới abort: nếu abort làm transport reject (AbortError)
      // ngay lập tức, ta vẫn muốn lỗi có cờ `timeout` thắng cuộc đua.
      const e = /** @type {any} */ (new Error(message));
      e.timeout = true;
      reject(e);
      try { controller.abort(); } catch (_) { /* best-effort */ }
    }, timeoutMs);
  });

  const transport = Promise.resolve(api.getWith(path, undefined, { signal: controller.signal }));

  // Tránh "unhandled rejection" từ bên THUA cuộc đua: khi deadline thắng,
  // transport vẫn có thể reject sau đó (vd AbortError); khi transport thắng,
  // ta clear timer nên deadline không bao giờ reject (nó treo vô hại).
  transport.catch(() => {});
  deadline.catch(() => {});

  return Promise.race([transport, deadline]).then(
    (data) => { stop(); return data; },
    (err) => { stop(); throw err; },
  );
}
