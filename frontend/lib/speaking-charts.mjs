// Phần THUẦN của hai biểu đồ trang Speaking — chọn dữ liệu và tính trung bình.
//
// VÌ SAO TÁCH: cổng parity G1 KHÔNG thấy gì bên trong `<canvas>`, nên biểu đồ
// nằm ngoài tầm nó VĨNH VIỄN. Lớp che duy nhất là test — và test chỉ chạy được
// nếu logic không nằm chung với lời gọi Chart.js. Đây là chỗ duy nhất trong
// trang mà "tách để test được" không phải sở thích mà là điều kiện cần.

/** Số điểm tối đa trên biểu đồ đường (bản legacy: 20 phiên gần nhất). */
export const LINE_MAX_POINTS = 20;
/** Số phiên gộp cho biểu đồ radar (bản legacy: 5 phiên gần nhất CÓ tiêu chí). */
export const RADAR_WINDOW = 5;
/** Dưới ngưỡng này thì biểu đồ đường không có nghĩa — legacy hiện khối rỗng. */
export const LINE_MIN_POINTS = 2;

export const CRITERIA_KEYS = ['band_fc', 'band_lr', 'band_gra', 'band_p'];

export const RADAR_LABELS = [
  'Fluency &\nCoherence', 'Lexical\nResource', 'Grammatical\nRange', 'Pronunciation',
];

/**
 * Phiên đủ điều kiện lên biểu đồ: ĐÃ hoàn thành VÀ có band tổng.
 *
 * `submitted` / `analysis_failed` bị loại — vẽ chúng thành điểm 0 hay bỏ trống
 * đều nói dối: một bài đang chờ chấm không phải một bài điểm thấp.
 * Sắp xếp CŨ → MỚI rồi lấy phần đuôi, để trục thời gian đọc xuôi.
 */
export function chartSessions(sessions) {
  return (sessions || [])
    .filter((s) => s.status === 'completed' && s.overall_band != null)
    .slice()
    .sort((a, b) => +new Date(a.started_at) - +new Date(b.started_at))
    .slice(-LINE_MAX_POINTS);
}

/** Nhãn trục X: `dd/mm`, có đệm số 0 — giữ nguyên định dạng legacy. */
export function chartLabels(completed) {
  return (completed || []).map((s) => {
    const d = new Date(s.started_at);
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
  });
}

/**
 * Có phiên nào mang điểm theo tiêu chí không.
 *
 * Quyết định việc VẼ 4 đường đứt nét. Không có thì chỉ vẽ đường Tổng — thêm bốn
 * đường toàn `null` chỉ làm chú giải rối mà không thêm thông tin nào.
 */
export function hasCriteria(completed) {
  return (completed || []).some((s) => CRITERIA_KEYS.some((k) => s[k] != null));
}

/** Năm phiên gần nhất CÓ ít nhất một tiêu chí — nguồn của biểu đồ radar. */
export function radarSessions(completed) {
  return (completed || [])
    .filter((s) => CRITERIA_KEYS.some((k) => s[k] != null))
    .slice(-RADAR_WINDOW);
}

/**
 * Trung bình một tiêu chí, làm tròn 1 chữ số thập phân.
 *
 * Bỏ QUA giá trị `null` thay vì coi là 0: một phiên không chấm Pronunciation
 * không có nghĩa là phát âm 0 điểm. Không có giá trị nào ⇒ 0 (đúng bản legacy —
 * radar cần một số để vẽ được hình).
 */
export function avgCriterion(sessions, key) {
  const vals = (sessions || []).map((s) => s[key]).filter((v) => v != null);
  if (!vals.length) return 0;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}
