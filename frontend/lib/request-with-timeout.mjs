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
export const DEFAULT_TIMEOUT_MESSAGE = 'Tải dữ liệu quá lâu. Vui lòng tải lại trang.';

/**
 * Đua một lời hứa BẤT KỲ với một hạn giờ độc lập.
 *
 * Dùng cho những `await` không phải GET — chờ phiên đăng nhập, chờ cả chuỗi
 * khởi động trang — nơi không có `fetch` nào để hủy nhưng vẫn phải kết thúc.
 * Hết giờ thì REJECT bằng lỗi có cờ `timeout`, bất kể `work` có settle hay
 * không; `onTimeout` (nếu có) chạy SAU khi reject, như một nỗ lực hủy.
 *
 * @template T
 * @param {Promise<T> | T} work
 * @param {{timeoutMs?: number, message?: string, onTimeout?: () => void,
 *          setTimer?: (fn: () => void, ms: number) => any,
 *          clearTimer?: (id: any) => void}} [opts]
 * @returns {Promise<T>}
 */
export function withDeadline(work, opts = {}) {
  const {
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    message = DEFAULT_TIMEOUT_MESSAGE,
    onTimeout,
    setTimer = (typeof setTimeout !== 'undefined' ? setTimeout : null),
    clearTimer = (typeof clearTimeout !== 'undefined' ? clearTimeout : null),
  } = opts;

  const task = Promise.resolve(work);
  if (!setTimer) return task;

  let timer = null;
  const stop = () => {
    if (timer != null && clearTimer) { clearTimer(timer); }
    timer = null;
  };

  const deadline = new Promise((_resolve, reject) => {
    timer = setTimer(() => {
      // Reject TRƯỚC rồi mới hủy: nếu việc hủy làm `work` reject ngay (vd
      // AbortError), lỗi có cờ `timeout` vẫn phải thắng cuộc đua.
      const e = /** @type {any} */ (new Error(message));
      e.timeout = true;
      reject(e);
      if (onTimeout) {
        try { onTimeout(); } catch (_) { /* best-effort */ }
      }
    }, timeoutMs);
  });

  // Tránh "unhandled rejection" từ bên THUA cuộc đua: khi deadline thắng,
  // `work` vẫn có thể reject sau đó; khi `work` thắng, ta clear timer nên
  // deadline không bao giờ reject (nó treo vô hại).
  task.catch(() => {});
  deadline.catch(() => {});

  return Promise.race([task, deadline]).then(
    (data) => { stop(); return data; },
    (err) => { stop(); throw err; },
  );
}

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
    message = DEFAULT_TIMEOUT_MESSAGE,
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
  // giờ `withDeadline` REJECT thẳng bằng lỗi có cờ `timeout`, bất kể transport
  // có settle hay không. `abort()` giữ lại như nỗ lực-tốt-nhất để hủy request
  // đang bay (khi đã chạm tới `fetch`).
  return withDeadline(
    api.getWith(path, undefined, { signal: controller.signal }),
    { timeoutMs, message, setTimer, clearTimer, onTimeout: () => controller.abort() },
  );
}
